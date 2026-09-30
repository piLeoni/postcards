//! Roads: the carriageway as an area. Each way is buffered by half its
//! ground width; bridges stack above what they cross, and the seams where a
//! deck crosses a road below become detail strokes.

use super::{below_ground, layer_stroke, Context, LayerParts};
use crate::fill::{self, FillError};
use crate::geom::{self, Lines};
use crate::osm::Feature;
use crate::profile::{LayerSpec, StrokeSpec};
use geo::algorithm::buffer::Buffer;
use geo::{Coord, Geometry, LineString, MultiLineString, MultiPolygon};
use std::collections::{BTreeMap, HashMap};

/// Typical carriageway width, metres, when OSM says nothing better.
fn width_by_type(highway: &str) -> Option<f64> {
    Some(match highway {
        "motorway" => 15.0,
        "motorway_link" => 7.0,
        "trunk" => 10.0,
        "trunk_link" => 6.0,
        "primary" => 7.0,
        "primary_link" => 6.0,
        "secondary" => 6.0,
        "secondary_link" | "tertiary" | "tertiary_link" | "construction" => 5.0,
        "residential" | "unclassified" => 4.0,
        "living_street" | "service" | "pedestrian" => 3.0,
        "footway" | "path" | "steps" => 1.0,
        "cycleway" | "elevator" => 1.5,
        "bridleway" => 2.0,
        _ => return None,
    })
}

/// Soft upper bounds, metres: tags like `width=200` on a residential happen.
fn max_width_by_type(highway: &str) -> f64 {
    match highway {
        "motorway" => 50.0,
        "motorway_link" => 25.0,
        "trunk" => 40.0,
        "trunk_link" => 20.0,
        "primary" => 30.0,
        "primary_link" => 18.0,
        "secondary" => 24.0,
        "secondary_link" | "residential" | "unclassified" => 15.0,
        "tertiary" | "pedestrian" => 20.0,
        "tertiary_link" | "living_street" | "service" => 12.0,
        "footway" | "cycleway" | "path" => 6.0,
        _ => 40.0,
    }
}

const DEFAULT_WIDTH_M: f64 = 6.0;
const LANE_WIDTH_M: f64 = 3.0;
const BUFFER_FUDGE: f64 = 1.25;
/// Gaps narrower than this on the ground are closed after buffering (flat-cap
/// wedges at joints) without gluing dual carriageways together.
const JOINT_CLOSE_M: f64 = 2.5;
/// Grid (card mm) endpoints snap to when looking for shared nodes.
const NODE_SNAP_MM: f64 = 0.05;
const CENTERLINE_MIN_WIDTH_M: f64 = 6.0;
const CENTERLINE_DASH_MM: f64 = 0.3;
const CENTERLINE_GAP_MM: f64 = 0.35;

fn unit_to_metres(unit: &str) -> Option<f64> {
    Some(match unit {
        "m" | "metre" | "metres" | "meter" | "meters" => 1.0,
        "km" => 1000.0,
        "ft" | "feet" | "foot" | "'" => 0.3048,
        "in" | "inch" | "inches" => 0.0254,
        _ => return None,
    })
}

/// An OSM `width` in metres: bare numbers are metres; units and feet-inches
/// (`12'6"`) are converted; `a;b` takes the larger.
fn parse_width_m(value: &str) -> Option<f64> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }
    if v.contains(';') && !v.contains('|') {
        return v.split(';').filter_map(parse_width_m).reduce(f64::max);
    }
    if let Some(m) = feet_inches(v) {
        return Some(m);
    }
    let num_end = v.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(v.len());
    if num_end == 0 {
        return None;
    }
    let (number, rest) = v.split_at(num_end);
    let unit = rest.trim_start();
    if !unit.chars().all(|c| c.is_ascii_alphabetic() || c == '\'' || c == '"') {
        return None;
    }
    let number: f64 = number.parse().ok()?;
    let unit = if unit.is_empty() { "m".to_string() } else { unit.to_ascii_lowercase() };
    Some(number * unit_to_metres(unit.trim())?)
}

fn feet_inches(v: &str) -> Option<f64> {
    let digits = |s: &str| -> Option<(u32, usize)> {
        let n = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
        (n > 0).then(|| s[..n].parse().ok().map(|d| (d, n)))?
    };
    let (feet, n) = digits(v)?;
    let rest = v[n..].trim_start().strip_prefix('\'')?.trim_start();
    if rest.is_empty() {
        return Some(feet as f64 * 0.3048);
    }
    let (inches, n) = digits(rest)?;
    let tail = rest[n..].trim_start().strip_prefix('"')?;
    tail.is_empty().then(|| (feet as f64 + inches as f64 / 12.0) * 0.3048)
}

fn width_lanes_m(value: &str) -> Option<f64> {
    let widths: Vec<f64> = value.trim().split(['|', ';']).filter_map(parse_width_m).filter(|w| *w > 0.0).collect();
    (!widths.is_empty()).then(|| widths.iter().sum())
}

fn road_width_m(f: &Feature) -> f64 {
    let highway = f.tag("highway").unwrap_or("");
    let clamp = |w: f64| w.max(0.5).min(max_width_by_type(highway));
    if let Some(w) = f.tag("width").and_then(parse_width_m).filter(|w| *w > 0.0) {
        return clamp(w);
    }
    for key in ["width:lanes", "width:lanes:forward", "width:lanes:backward"] {
        if let Some(w) = f.tag(key).and_then(width_lanes_m) {
            return clamp(w);
        }
    }
    if let Some(lanes) = f.tag("lanes") {
        if let Ok(n) = lanes.replace('|', ";").split(';').next().unwrap_or("").trim().parse::<f64>() {
            return clamp(n * LANE_WIDTH_M);
        }
    }
    width_by_type(highway).unwrap_or(DEFAULT_WIDTH_M)
}

fn truthy(v: Option<&str>) -> bool {
    v.is_some_and(|t| !matches!(t.trim().to_ascii_lowercase().as_str(), "" | "no" | "false" | "0"))
}

/// Stacking index: `layer`, with bridges lifted to at least 1 (a bridge
/// tagged `layer=0` is a common mistake) and tunnels pushed below ground.
fn road_layer(f: &Feature) -> i64 {
    let explicit = f
        .tag("layer")
        .filter(|l| !l.trim().is_empty())
        .and_then(|l| l.split(';').next().unwrap_or("").trim().parse::<f64>().ok())
        .map(|l| l.trunc() as i64);
    if let Some(t) = f.tag("tunnel") {
        if !matches!(t.trim().to_ascii_lowercase().as_str(), "" | "no" | "false" | "0" | "building_passage") {
            return explicit.filter(|e| *e < 0).unwrap_or(-1);
        }
    }
    let bridge = truthy(f.tag("bridge"));
    match explicit {
        Some(0) if bridge => 1,
        Some(e) => e,
        None if bridge => 1,
        None => 0,
    }
}

fn merge(polys: &[MultiPolygon<f64>]) -> MultiPolygon<f64> {
    geom::union_multi(polys)
}

fn close_gaps(mp: &MultiPolygon<f64>, c: f64) -> MultiPolygon<f64> {
    geom::buffer(&geom::buffer(mp, c), -c)
}

fn keep_longer(lines: Lines, min: f64) -> Lines {
    geom::linemerge(&lines).into_iter().filter(|l| geom::line_length(l) > min).collect()
}

/// Dashes for a lane divider; pieces shorter than 0.05 mm are dropped.
fn dashed_centerline(line: &LineString<f64>) -> Lines {
    let length = geom::line_length(line);
    if length < CENTERLINE_DASH_MM * 0.5 {
        return vec![];
    }
    let mut out = Vec::new();
    let mut t = 0.0;
    while t < length - 1e-9 {
        let b = (t + CENTERLINE_DASH_MM).min(length);
        if b - t > 0.05 {
            if let Some(piece) = geom::substring(line, t, b).filter(|p| geom::line_length(p) > 0.05) {
                out.push(piece);
            }
        }
        t += CENTERLINE_DASH_MM + CENTERLINE_GAP_MM;
    }
    out
}

fn node_key(layer: i64, c: Coord<f64>) -> (i64, u64, u64) {
    let snap = |v: f64| ((v / NODE_SNAP_MM).round_ties_even() * NODE_SNAP_MM + 0.0).to_bits();
    (layer, snap(c.x), snap(c.y))
}

pub(super) fn render(layer: &LayerSpec, ctx: &Context) -> Result<LayerParts, FillError> {
    let feats: Vec<(&Feature, i64)> = ctx
        .features
        .iter()
        .filter(|f| f.has("highway") && !matches!(f.tag("footway"), Some("crossing" | "sidewalk")) && !f.is_point())
        .map(|f| (f, road_layer(f)))
        .filter(|(f, l)| *l >= 0 && !below_ground(f, &["layer"]))
        .collect();
    if feats.is_empty() {
        return Ok(LayerParts::default());
    }

    let scale_ratio = 1.0 / (ctx.card.scale / 1000.0) * BUFFER_FUDGE;

    let mut buffered: Vec<MultiPolygon<f64>> = Vec::new();
    // Keyed by (layer, radius as 1e-4 mm steps), in first-seen order.
    let mut key_order: Vec<(i64, i64)> = Vec::new();
    let mut lines_by_key: HashMap<(i64, i64), Lines> = HashMap::new();
    // Snapped node → (its position, the radii of the ways ending there).
    type NodeKey = (i64, u64, u64);
    let mut node_radii: HashMap<NodeKey, (Coord<f64>, Vec<f64>)> = HashMap::new();

    for (f, lyr) in &feats {
        match &f.geometry {
            Geometry::LineString(_) | Geometry::MultiLineString(_) => {
                let radius = road_width_m(f) / 2.0 * scale_ratio;
                let key = (*lyr, (radius * 1e4).round_ties_even() as i64);
                for part in geom::lines_of(&f.geometry) {
                    if part.0.len() < 2 || geom::line_length(&part) == 0.0 {
                        continue;
                    }
                    for c in [part.0[0], *part.0.last().unwrap()] {
                        let k = node_key(*lyr, c);
                        let snapped = Coord { x: f64::from_bits(k.1), y: f64::from_bits(k.2) };
                        node_radii.entry(k).or_insert_with(|| (snapped, vec![])).1.push(radius);
                    }
                    if !lines_by_key.contains_key(&key) {
                        key_order.push(key);
                    }
                    lines_by_key.entry(key).or_default().push(part);
                }
            }
            Geometry::Polygon(_) | Geometry::MultiPolygon(_) => {
                buffered.push(MultiPolygon::new(geom::polygons(&f.geometry)));
            }
            _ => {}
        }
    }

    let mut by_layer: BTreeMap<i64, Vec<MultiPolygon<f64>>> = BTreeMap::new();
    let mut endpoints_by_layer: BTreeMap<i64, Vec<MultiPolygon<f64>>> = BTreeMap::new();
    let mut centerlines_by_layer: BTreeMap<i64, Lines> = BTreeMap::new();

    for key in &key_order {
        let (lyr, r_steps) = *key;
        let radius = r_steps as f64 / 1e4;
        let width_m = 2.0 * radius / scale_ratio;
        for part in geom::linemerge(&lines_by_key[key]) {
            if geom::line_length(&part) == 0.0 {
                continue;
            }
            let piece = geom::buffer_line_flat(&part, radius);
            buffered.push(piece.clone());
            if width_m >= CENTERLINE_MIN_WIDTH_M {
                centerlines_by_layer.entry(lyr).or_default().push(part.clone());
            }
            if lyr >= 1 {
                by_layer.entry(lyr).or_default().push(piece);
                let ends = endpoints_by_layer.entry(lyr).or_default();
                ends.push(geom::disk(part.0[0], radius));
                ends.push(geom::disk(*part.0.last().unwrap(), radius));
            }
        }
    }

    // Where ways of different widths meet, a disk of the wider one fills the joint.
    for ((lyr, _, _), (centre, radii)) in &node_radii {
        if radii.len() < 2 {
            continue;
        }
        let disk = geom::disk(*centre, radii.iter().copied().fold(f64::MIN, f64::max));
        buffered.push(disk.clone());
        if *lyr >= 1 {
            by_layer.entry(*lyr).or_default().push(disk);
        }
    }

    if buffered.is_empty() {
        return Ok(LayerParts::default());
    }
    let mut mask = merge(&buffered);
    let close = JOINT_CLOSE_M * scale_ratio;
    if close > 0.0 {
        mask = close_gaps(&mask, close);
        for decks in by_layer.values_mut() {
            let merged = merge(decks);
            *decks = if merged.0.is_empty() { vec![] } else { vec![close_gaps(&merged, close)] };
        }
    }
    if mask.0.is_empty() {
        return Ok(LayerParts::default());
    }
    let outer = MultiLineString::new(geom::rings(&mask));

    let mut details: Lines = Vec::new();

    // Higher decks erase the centre-lines underneath, then what is left is dashed.
    let elevated_union = merge(&by_layer.values().flatten().cloned().collect::<Vec<_>>());
    let mut higher_deck: BTreeMap<i64, MultiPolygon<f64>> = BTreeMap::new();
    let mut above = geom::empty();
    for (lyr, decks) in by_layer.iter().rev() {
        higher_deck.insert(*lyr, above.clone());
        let deck = merge(decks);
        if !deck.0.is_empty() {
            above = geom::union_multi([&above, &deck]);
        }
    }
    for (lyr, lines) in &centerlines_by_layer {
        let empty = geom::empty();
        let cutter = if *lyr <= 0 { &elevated_union } else { higher_deck.get(lyr).unwrap_or(&empty) };
        for piece in geom::clip_lines(lines, cutter, true) {
            details.extend(dashed_centerline(&piece));
        }
    }

    // Bridge seams: each deck minus everything above it; only edges that are
    // not the outer silhouette are drawn.
    let ids: Vec<i64> = by_layer.keys().copied().filter(|l| *l >= 1).collect();
    let originals: Vec<MultiPolygon<f64>> = ids.iter().map(|l| merge(&by_layer[l])).collect();
    let endpoints: Vec<MultiPolygon<f64>> =
        ids.iter().map(|l| merge(endpoints_by_layer.get(l).map_or(&[][..], |v| v))).collect();
    for i in 0..ids.len() {
        let above: Vec<&MultiPolygon<f64>> = originals[i + 1..].iter().collect();
        let deck = geom::difference(&originals[i], &geom::union_multi(above));
        if deck.0.is_empty() {
            continue;
        }
        // A hair of band around the silhouette, built only near this deck:
        // buffering the whole outline costs seconds.
        let near = geom::clip_lines(&outer.0, &geom::buffer(&deck, 0.05), false);
        let band = if near.is_empty() { geom::empty() } else { MultiLineString::new(near).buffer(0.02) };
        let mut seams = keep_longer(geom::clip_lines(&geom::rings(&deck), &band, true), 0.05);
        if !endpoints[i].0.is_empty() {
            let cap = geom::buffer(&endpoints[i], 0.005);
            seams = keep_longer(geom::clip_lines(&seams, &cap, true), 0.05);
        }
        details.extend(seams);
    }

    Ok(LayerParts {
        outlines: fill::stroke(geom::rings(&mask), &layer_stroke(StrokeSpec::default(), layer)),
        details,
        filling: vec![],
        mask,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osm::{Element, Tags};
    use geo::Point;

    fn feature(tags: &[(&str, &str)]) -> Feature {
        let tags: Tags = tags.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Feature { element: Element::Way, id: 1, tags, geometry: Geometry::Point(Point::new(0.0, 0.0)) }
    }

    #[test]
    fn widths_follow_osm_priority() {
        assert_eq!(road_width_m(&feature(&[("highway", "residential"), ("width", "8")])), 8.0);
        assert_eq!(road_width_m(&feature(&[("highway", "residential"), ("width", "200")])), 15.0);
        assert!((road_width_m(&feature(&[("highway", "primary"), ("width", "20'")])) - 6.096).abs() < 1e-9);
        assert!((road_width_m(&feature(&[("highway", "primary"), ("width", "12'6\"")])) - 3.81).abs() < 1e-9);
        assert_eq!(road_width_m(&feature(&[("highway", "primary"), ("width:lanes", "3.5|3.5")])), 7.0);
        assert_eq!(road_width_m(&feature(&[("highway", "primary"), ("lanes", "3")])), 9.0);
        assert_eq!(road_width_m(&feature(&[("highway", "motorway")])), 15.0);
        assert_eq!(road_width_m(&feature(&[("highway", "raceway")])), 6.0);
        assert_eq!(parse_width_m("3 m;5"), Some(5.0));
        assert_eq!(parse_width_m("2 furlongs"), None);
    }

    #[test]
    fn layers_lift_bridges_and_sink_tunnels() {
        assert_eq!(road_layer(&feature(&[("bridge", "yes")])), 1);
        assert_eq!(road_layer(&feature(&[("bridge", "yes"), ("layer", "0")])), 1);
        assert_eq!(road_layer(&feature(&[("bridge", "yes"), ("layer", "2")])), 2);
        assert_eq!(road_layer(&feature(&[("tunnel", "yes")])), -1);
        assert_eq!(road_layer(&feature(&[("tunnel", "yes"), ("layer", "-2")])), -2);
        assert_eq!(road_layer(&feature(&[("tunnel", "building_passage")])), 0);
        assert_eq!(road_layer(&feature(&[("layer", "1;2")])), 1);
    }
}
