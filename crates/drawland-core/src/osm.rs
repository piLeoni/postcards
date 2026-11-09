//! Overpass JSON → features, following `osmnx.features` (2.0) rule for rule:
//! which closed ways are areas, how multipolygon relations are assembled,
//! and which features survive the area and tag filters.

use crate::geom;
use geo::{BoundingRect, Contains, Coord, Geometry, Intersects, LineString, MultiPolygon, Point, Polygon};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};

pub type Tags = BTreeMap<String, String>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Element {
    // Declared in osmnx's sort order ("node" < "relation" < "way").
    Node,
    Relation,
    Way,
    /// A feature of a vector tile (see [`crate::tiles`]), not an OSM element.
    Tile,
    /// A feature of a GeoJSON dataset (see [`crate::geojson`]).
    Data,
}

#[derive(Debug, Clone)]
pub struct Feature {
    pub element: Element,
    pub id: i64,
    pub tags: Tags,
    /// lon/lat until projected, output mm after.
    pub geometry: Geometry<f64>,
}

impl Feature {
    pub fn tag(&self, key: &str) -> Option<&str> {
        self.tags.get(key).map(String::as_str)
    }

    pub fn has(&self, key: &str) -> bool {
        self.tags.contains_key(key)
    }

    pub fn is_point(&self) -> bool {
        matches!(self.geometry, Geometry::Point(_) | Geometry::MultiPoint(_))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum OsmError {
    #[error("Overpass response: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Deserialize)]
struct Response {
    elements: Vec<Raw>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Raw {
    Node {
        id: i64,
        lat: f64,
        lon: f64,
        #[serde(default)]
        tags: Tags,
    },
    Way {
        id: i64,
        #[serde(default)]
        nodes: Vec<i64>,
        #[serde(default)]
        tags: Tags,
    },
    Relation {
        id: i64,
        #[serde(default)]
        members: Vec<Member>,
        #[serde(default)]
        tags: Tags,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct Member {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "ref")]
    id: i64,
    #[serde(default)]
    role: String,
}

const RELATION_TYPES: &[&str] = &["boundary", "multipolygon"];

enum Rule {
    All,
    Pass(&'static [&'static str]),
    Block(&'static [&'static str]),
}

/// osmnx `_POLYGON_FEATURES`: tags that make a closed way an area.
fn polygon_rule(key: &str) -> Option<Rule> {
    Some(match key {
        "aeroway" => Rule::Block(&["taxiway"]),
        "amenity" | "area" | "area:highway" | "boundary" | "building" | "building:part" | "craft" | "golf"
        | "historic" | "indoor" | "landuse" | "leisure" | "military" | "office" | "place"
        | "public_transport" | "ruins" | "shop" | "tourism" => Rule::All,
        "barrier" => Rule::Pass(&["city_wall", "ditch", "hedge", "retaining_wall", "spikes"]),
        "highway" => Rule::Pass(&["elevator", "escape", "rest_area", "services"]),
        "man_made" => Rule::Block(&["cutline", "embankment", "pipeline"]),
        "natural" => Rule::Block(&["arete", "cliff", "coastline", "ridge", "tree_row"]),
        "power" => Rule::Pass(&["generator", "plant", "substation", "transformer"]),
        "railway" => Rule::Pass(&["platform", "roundhouse", "station", "turntable"]),
        "waterway" => Rule::Pass(&["boatyard", "dam", "dock", "riverbank"]),
        _ => return None,
    })
}

fn way_is_area(nodes: &[i64], tags: &Tags) -> bool {
    if nodes.first() != nodes.last() || tags.get("area").map(String::as_str) == Some("no") {
        return false;
    }
    tags.iter().any(|(k, v)| match polygon_rule(k) {
        Some(Rule::All) => true,
        Some(Rule::Pass(values)) => values.contains(&v.as_str()),
        Some(Rule::Block(values)) => !values.contains(&v.as_str()),
        None => false,
    })
}

#[derive(Clone)]
enum WayGeom {
    Line(LineString<f64>),
    Area(Polygon<f64>),
    Empty,
}

fn build_way(nodes: &[i64], tags: &Tags, coords: &HashMap<i64, Coord<f64>>) -> WayGeom {
    let pts: Option<Vec<Coord<f64>>> = nodes.iter().map(|n| coords.get(n).copied()).collect();
    let Some(pts) = pts else { return WayGeom::Empty };
    if way_is_area(nodes, tags) {
        if pts.len() < 4 {
            return WayGeom::Empty;
        }
        WayGeom::Area(Polygon::new(LineString::new(pts), vec![]))
    } else if pts.len() < 2 {
        WayGeom::Empty
    } else {
        WayGeom::Line(LineString::new(pts))
    }
}

fn polygonize(line: &LineString<f64>) -> Option<Polygon<f64>> {
    (line.is_closed() && line.0.len() >= 4).then(|| Polygon::new(line.clone(), vec![]))
}

fn build_relation(members: &[Member], ways: &HashMap<i64, WayGeom>) -> MultiPolygon<f64> {
    let (mut outer_lines, mut inner_lines) = (Vec::new(), Vec::new());
    let (mut outers, mut inners) = (Vec::new(), Vec::new());
    for m in members.iter().filter(|m| m.kind == "way") {
        match (m.role.as_str(), ways.get(&m.id)) {
            ("outer", Some(WayGeom::Line(l))) => outer_lines.push(l.clone()),
            ("outer", Some(WayGeom::Area(p))) => outers.push(p.clone()),
            ("inner", Some(WayGeom::Line(l))) => inner_lines.push(l.clone()),
            ("inner", Some(WayGeom::Area(p))) => inners.push(p.clone()),
            _ => {}
        }
    }
    outers.extend(geom::linemerge(&outer_lines).iter().filter_map(polygonize));
    inners.extend(geom::linemerge(&inner_lines).iter().filter_map(polygonize));

    if inners.is_empty() {
        return geom::union_all(&outers);
    }
    let inner_boxes: Vec<Option<geo::Rect<f64>>> = inners.iter().map(|i| i.bounding_rect()).collect();
    let with_holes: Vec<MultiPolygon<f64>> = outers
        .iter()
        .map(|outer| {
            let outer_box = outer.bounding_rect();
            let holes: Vec<&Polygon<f64>> = inners
                .iter()
                .zip(&inner_boxes)
                .filter(|(i, ib)| {
                    match (outer_box, ib) {
                        (Some(ob), Some(ib)) if !ob.intersects(ib) => false,
                        _ => outer.contains(*i),
                    }
                })
                .map(|(i, _)| i)
                .collect();
            let shell = geom::union_all(std::iter::once(outer));
            if holes.is_empty() {
                shell
            } else {
                geom::difference(&shell, &geom::union_all(holes))
            }
        })
        .collect();
    geom::union_multi(&with_holes)
}

fn area_geometry(mp: MultiPolygon<f64>) -> Geometry<f64> {
    let mut mp = mp;
    if mp.0.len() == 1 {
        Geometry::Polygon(mp.0.pop().unwrap())
    } else {
        Geometry::MultiPolygon(mp)
    }
}

fn is_empty(g: &Geometry<f64>) -> bool {
    match g {
        Geometry::LineString(l) => l.0.is_empty(),
        Geometry::Polygon(p) => p.exterior().0.is_empty(),
        Geometry::MultiPolygon(mp) => mp.0.is_empty(),
        _ => false,
    }
}

fn make_valid(g: Geometry<f64>) -> Geometry<f64> {
    match g {
        Geometry::Polygon(p) => area_geometry(geom::make_valid(&p)),
        Geometry::MultiPolygon(mp) => {
            use geo::Validation;
            if mp.is_valid() {
                Geometry::MultiPolygon(mp)
            } else {
                area_geometry(geom::union_multi(&mp.0.iter().map(geom::make_valid).collect::<Vec<_>>()))
            }
        }
        other => other,
    }
}

/// Features of an Overpass response that intersect `area` (lon/lat) and
/// carry at least one of `tags`, sorted like osmnx (element, then id).
pub fn features_from_overpass(json: &str, area: &Polygon<f64>, tags: &[&str]) -> Result<Vec<Feature>, OsmError> {
    let response: Response = serde_json::from_str(json)?;
    let wanted = |t: &Tags| tags.iter().any(|k| t.contains_key(*k));
    let area_box = area.bounding_rect();

    let mut coords: HashMap<i64, Coord<f64>> = HashMap::new();
    let mut relation_ways: HashSet<i64> = HashSet::new();
    for e in &response.elements {
        match e {
            Raw::Node { id, lat, lon, .. } => {
                coords.insert(*id, Coord { x: *lon, y: *lat });
            }
            Raw::Relation { members, tags, .. } => {
                if tags.get("type").is_some_and(|t| RELATION_TYPES.contains(&t.as_str())) && wanted(tags) {
                    for m in members {
                        if m.kind == "way" {
                            relation_ways.insert(m.id);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let mut features = Vec::new();
    let mut way_geoms: HashMap<i64, WayGeom> = HashMap::with_capacity(relation_ways.len());
    for e in &response.elements {
        match e {
            Raw::Node { id, lat, lon, tags } if wanted(tags) => features.push(Feature {
                element: Element::Node,
                id: *id,
                tags: tags.clone(),
                geometry: Geometry::Point(Point::new(*lon, *lat)),
            }),
            Raw::Way { id, nodes, tags } => {
                let is_wanted = wanted(tags);
                let in_rel = relation_ways.contains(id);
                if !is_wanted && !in_rel {
                    continue;
                }
                let g = build_way(nodes, tags, &coords);
                if is_wanted {
                    let geometry = match &g {
                        WayGeom::Line(l) => Geometry::LineString(l.clone()),
                        WayGeom::Area(p) => Geometry::Polygon(p.clone()),
                        WayGeom::Empty => Geometry::LineString(LineString::new(vec![])),
                    };
                    features.push(Feature { element: Element::Way, id: *id, tags: tags.clone(), geometry });
                }
                if in_rel {
                    way_geoms.insert(*id, g);
                }
            }
            _ => {}
        }
    }
    for e in &response.elements {
        if let Raw::Relation { id, members, tags } = e {
            if !tags.get("type").is_some_and(|t| RELATION_TYPES.contains(&t.as_str())) || !wanted(tags) {
                continue;
            }
            let geometry = area_geometry(build_relation(members, &way_geoms));
            features.push(Feature { element: Element::Relation, id: *id, tags: tags.clone(), geometry });
        }
    }

    let bbox_hits = |g: &Geometry<f64>| match (area_box, g.bounding_rect()) {
        (Some(ab), Some(gb)) => ab.intersects(&gb),
        _ => true,
    };

    let mut out: Vec<Feature> = features
        .into_iter()
        .filter(|f| !is_empty(&f.geometry) && bbox_hits(&f.geometry))
        .map(|mut f| {
            f.geometry = make_valid(f.geometry);
            f
        })
        .filter(|f| !is_empty(&f.geometry) && bbox_hits(&f.geometry) && f.geometry.intersects(area))
        .collect();
    out.sort_by_key(|f| (f.element, f.id));
    Ok(out)
}

/// Whether the output shows a coastline, i.e. needs the ocean polygons.
pub fn needs_ocean(features: &[Feature]) -> bool {
    features.iter().any(|f| f.tag("natural") == Some("coastline"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::polygon;

    fn area() -> Polygon<f64> {
        polygon![(x: -1.0, y: -1.0), (x: 10.0, y: -1.0), (x: 10.0, y: 10.0), (x: -1.0, y: 10.0)]
    }

    #[test]
    fn closed_ways_become_areas_by_tag() {
        let json = r#"{"elements":[
            {"type":"node","id":1,"lat":0,"lon":0},{"type":"node","id":2,"lat":0,"lon":1},
            {"type":"node","id":3,"lat":1,"lon":1},{"type":"node","id":4,"lat":1,"lon":0},
            {"type":"way","id":10,"nodes":[1,2,3,4,1],"tags":{"building":"yes"}},
            {"type":"way","id":11,"nodes":[1,2,3,4,1],"tags":{"highway":"footway"}},
            {"type":"way","id":12,"nodes":[1,2,3,4,1],"tags":{"building":"yes","area":"no"}},
            {"type":"way","id":13,"nodes":[1,2,3,4,1],"tags":{"natural":"coastline"}}
        ]}"#;
        let f = features_from_overpass(json, &area(), &["building", "highway", "natural"]).unwrap();
        let kinds: Vec<(i64, bool)> = f.iter().map(|f| (f.id, matches!(f.geometry, Geometry::Polygon(_)))).collect();
        assert_eq!(kinds, vec![(10, true), (11, false), (12, false), (13, false)]);
        assert!(needs_ocean(&f));
    }

    #[test]
    fn multipolygon_relation_with_hole() {
        let json = r#"{"elements":[
            {"type":"node","id":1,"lat":0,"lon":0},{"type":"node","id":2,"lat":0,"lon":4},
            {"type":"node","id":3,"lat":4,"lon":4},{"type":"node","id":4,"lat":4,"lon":0},
            {"type":"node","id":5,"lat":1,"lon":1},{"type":"node","id":6,"lat":1,"lon":2},
            {"type":"node","id":7,"lat":2,"lon":2},{"type":"node","id":8,"lat":2,"lon":1},
            {"type":"way","id":20,"nodes":[1,2,3]},{"type":"way","id":21,"nodes":[3,4,1]},
            {"type":"way","id":22,"nodes":[5,6,7,8,5]},
            {"type":"relation","id":30,"members":[
                {"type":"way","ref":20,"role":"outer"},{"type":"way","ref":21,"role":"outer"},
                {"type":"way","ref":22,"role":"inner"}],
             "tags":{"type":"multipolygon","leisure":"park"}}
        ]}"#;
        let f = features_from_overpass(json, &area(), &["leisure"]).unwrap();
        assert_eq!(f.len(), 1);
        use geo::Area;
        assert!((f[0].geometry.unsigned_area() - 15.0).abs() < 1e-9);
    }
}
