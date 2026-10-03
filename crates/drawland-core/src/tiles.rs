//! Map data from OpenStreetMap vector tiles, read by terramask: the sea, and
//! whatever a document picks with `tiles_select` (buildings, roads, parks…).
//!
//! Overpass answers with every tag but is slow and often busy; the tiles are
//! static files on a CDN, a handful per card, with the OpenMapTiles schema's
//! layers and classes instead of raw tags. The host downloads them (the
//! command line through terramask's fetcher, the page with `fetch`); this
//! says which, and reads them.

use crate::card::Card;
use crate::osm::{needs_ocean, Element, Feature, Tags};
use geo::{BoundingRect, Coord, Geometry, LineString, MultiPolygon, Polygon};
use terramask::{merc_to_lonlat, tiles_for, zoom_for, Features, Filter, TileId, ZoomLimits};

/// OpenFreeMap's planet tiles, as a TileJSON: no key, CORS open, weekly builds.
/// Attribution: "© OpenMapTiles © OpenStreetMap contributors".
pub const TILES: &str = "https://tiles.openfreemap.org/planet";

/// The tag holding a tile feature's layer (`building`, `transportation`…).
/// The other tags are the tile's own: `class`, `subclass`, `brunnel`…
pub const LAYER_TAG: &str = "tiles:layer";

/// Features are cut this much (a fraction of the card's size, on each side)
/// beyond the card: the outline of a park cut at the box would otherwise be
/// drawn along the card's edge.
const PAD: f64 = 0.05;

/// For the sea alone, detail is picked as if drawing this many pixels across.
const WIDTH_PX: usize = 2048;

/// Features come from the deepest zoom, where every building is; past this
/// many tiles the card is big enough to step out a zoom at a time.
const MAX_FEATURE_TILES: usize = 64;

/// What a document reads from the tiles, decided once Overpass (if the
/// document asks it anything) has answered: the `tiles_select` selections,
/// and the sea when the document draws it — with OSM features, only where
/// they show a coastline. `None` when nothing is needed.
pub fn plan(card: &Card, selectors: &[String], ocean: bool, osm: Option<&[Feature]>) -> Result<Option<Tiles>, String> {
    let sea = ocean && osm.is_none_or(needs_ocean);
    if selectors.is_empty() && !sea {
        return Ok(None);
    }
    Tiles::new(&card.query_polygon(), selectors, sea).map(Some)
}

/// The tiles under one card, gathered one by one.
pub struct Tiles {
    bounds: [f64; 4],
    /// What `tiles_select` picks; `None` when the sea is all.
    select: Option<Filter>,
    ocean: bool,
    /// Everything read: the selections and the sea.
    filter: Filter,
    data: Features,
}

impl Tiles {
    /// The tiles inside `area` (lon/lat), usually the card's query polygon.
    /// `selectors` are terramask's: presets (`buildings`, `roads`) and
    /// `layer:class` rules.
    pub fn new(area: &Polygon<f64>, selectors: &[String], ocean: bool) -> Result<Tiles, String> {
        let bounds = area
            .bounding_rect()
            .map(|r| {
                let (dx, dy) = (r.width() * PAD, r.height() * PAD);
                [r.min().x - dx, r.min().y - dy, r.max().x + dx, r.max().y + dy]
            })
            .unwrap_or_default();
        let select = (!selectors.is_empty()).then(|| Filter::parse(selectors)).transpose().map_err(|e| e.to_string())?;
        let mut all: Vec<String> = selectors.to_vec();
        if ocean {
            all.push("ocean".into());
        }
        let filter = Filter::parse(&all).map_err(|e| e.to_string())?;
        Ok(Tiles { bounds, select, ocean, filter, data: Features::new() })
    }

    /// `[west, south, east, north]`.
    pub fn bounds(&self) -> [f64; 4] {
        self.bounds
    }

    /// What to read from each tile.
    pub fn filter(&self) -> &Filter {
        &self.filter
    }

    /// The tile zoom, no deeper than `max_zoom` (the tile source's).
    pub fn zoom(&self, max_zoom: u8) -> u8 {
        if self.select.is_none() {
            return zoom_for(&self.bounds, WIDTH_PX, &ZoomLimits { max_zoom, ..ZoomLimits::default() });
        }
        let mut z = max_zoom;
        while z > 0 && tiles_for(&self.bounds, z).len() > MAX_FEATURE_TILES {
            z -= 1;
        }
        z
    }

    /// The tiles to download, for a source whose deepest zoom is `max_zoom`.
    pub fn tiles(&self, max_zoom: u8) -> Vec<TileId> {
        tiles_for(&self.bounds, self.zoom(max_zoom))
    }

    /// One downloaded tile (raw or gzipped protobuf).
    pub fn add_tile(&mut self, id: TileId, bytes: &[u8]) -> Result<(), String> {
        self.data.add_tile(id, bytes, &self.filter).map_err(|e| e.to_string())
    }

    /// Tiles read elsewhere, by terramask's fetcher with [`Tiles::filter`].
    pub fn add_features(&mut self, features: Features) {
        self.data.areas.extend(features.areas);
        self.data.lines.extend(features.lines);
    }

    /// The sea joined across tile edges and cut to the bounds, in lon/lat;
    /// `None` when it was not asked for.
    pub fn ocean(&self) -> Option<MultiPolygon<f64>> {
        if !self.ocean {
            return None;
        }
        let sea = Filter::parse(&["ocean"]).expect("a preset");
        let mut polys: Vec<Polygon<f64>> = Vec::new();
        for area in self.data.subset(&sea).merged(Some(self.bounds)).areas {
            polys.extend(polygons(&area.rings));
        }
        Some(MultiPolygon::new(polys))
    }

    /// What `tiles_select` can pick from, in lon/lat: each feature whole
    /// (mended across tile edges, cut to the bounds), its layer in
    /// [`LAYER_TAG`] and the tile's attributes as tags.
    pub fn features(&self) -> Vec<Feature> {
        let Some(select) = &self.select else { return Vec::new() };
        let joined = self.data.subset(select).joined(Some(self.bounds));
        let tags = |layer: &str, class: &str, subclass: &str, attrs: &[(String, String)]| -> Tags {
            let mut t: Tags = attrs.iter().cloned().collect();
            t.insert(LAYER_TAG.into(), layer.into());
            for (k, v) in [("class", class), ("subclass", subclass)] {
                if !v.is_empty() {
                    t.insert(k.into(), v.into());
                }
            }
            t
        };
        let areas = joined.areas.iter().filter_map(|a| {
            let mut p = polygons(&a.rings);
            let geometry = match p.len() {
                0 => return None,
                1 => Geometry::Polygon(p.remove(0)),
                _ => Geometry::MultiPolygon(MultiPolygon::new(p)),
            };
            Some((tags(&a.layer, &a.class, &a.subclass, &a.tags), geometry))
        });
        let lines = joined
            .lines
            .iter()
            .map(|l| (tags(&l.layer, &l.class, &l.subclass, &l.tags), Geometry::LineString(line(&l.points))));
        areas
            .chain(lines)
            .enumerate()
            .map(|(i, (tags, geometry))| Feature { element: Element::Tile, id: i as i64, tags, geometry })
            .collect()
    }
}

fn line(pts: &[[f64; 2]]) -> LineString<f64> {
    pts.iter()
        .map(|p| {
            let [x, y] = merc_to_lonlat(p[0], p[1]);
            Coord { x, y }
        })
        .collect()
}

/// Each exterior ring with the holes that follow it, in lon/lat.
fn polygons(rings: &[terramask::Ring]) -> Vec<Polygon<f64>> {
    let mut out: Vec<Polygon<f64>> = Vec::new();
    for r in rings {
        if r.exterior {
            out.push(Polygon::new(line(&r.points), vec![]));
        } else if let Some(last) = out.last_mut() {
            last.interiors_push(line(&r.points));
        }
    }
    out
}

/// Whether a tile feature (see [`Tiles::features`]) passes `filter`.
pub fn keeps(filter: &Filter, f: &Feature) -> bool {
    let tag = |k: &str| f.tag(k).unwrap_or("");
    f.element == Element::Tile && filter.keeps(tag(LAYER_TAG), tag("class"), tag("subclass"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::{polygon, Area};

    fn area() -> Polygon<f64> {
        polygon![(x: -122.5, y: 37.7), (x: -122.4, y: 37.7), (x: -122.4, y: 37.8), (x: -122.5, y: 37.8)]
    }

    #[test]
    fn no_tiles_no_sea() {
        let tiles = Tiles::new(&area(), &[], true).unwrap();
        let z = tiles.zoom(14);
        assert!((10..=14).contains(&z), "zoom {z}");
        assert!(!tiles.tiles(14).is_empty());
        assert_eq!(tiles.ocean().unwrap().unsigned_area(), 0.0);
        assert!(tiles.features().is_empty());
    }

    #[test]
    fn selections_read_at_the_deepest_zoom_that_fits() {
        let small = polygon![(x: -122.26, y: 37.87), (x: -122.25, y: 37.87), (x: -122.25, y: 37.88), (x: -122.26, y: 37.88)];
        let t = Tiles::new(&small, &["buildings".into(), "roads".into()], false).unwrap();
        assert_eq!(t.zoom(14), 14);
        assert!(t.ocean().is_none());
        assert_eq!(t.filter().layers(), ["building", "transportation"]);
        // A third of a degree is too many z14 tiles: a zoom out.
        let wide = polygon![(x: -122.6, y: 37.6), (x: -122.3, y: 37.6), (x: -122.3, y: 37.9), (x: -122.6, y: 37.9)];
        let big = Tiles::new(&wide, &["buildings".into()], false).unwrap();
        assert!(big.zoom(14) < 14 && big.tiles(14).len() <= MAX_FEATURE_TILES);
        assert!(Tiles::new(&small, &["forrest".into()], false).is_err());
    }

    #[test]
    fn tile_features_match_by_layer_class_and_subclass() {
        let f = |layer: &str, class: &str, subclass: &str| Feature {
            element: Element::Tile,
            id: 0,
            tags: [(LAYER_TAG, layer), ("class", class), ("subclass", subclass)].into_iter().map(|(k, v)| (k.into(), v.into())).collect(),
            geometry: Geometry::Point(geo::Point::new(0.0, 0.0)),
        };
        let parks = Filter::parse(&["landcover:park,garden"]).unwrap();
        assert!(keeps(&parks, &f("landcover", "grass", "park")));
        assert!(!keeps(&parks, &f("landcover", "grass", "grass")));
        assert!(!keeps(&parks, &f("landuse", "grass", "park")));
    }
}
