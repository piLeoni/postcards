//! Map data from OpenStreetMap vector tiles, read by terramask: whatever a
//! document picks with `tiles_select` (buildings, roads, parks, ocean…).
//!
//! Overpass answers with every tag but is slow and often busy; the tiles are
//! static files on a CDN, a handful per output, with the OpenMapTiles schema's
//! layers and classes instead of raw tags. The host downloads them (the
//! command line through terramask's fetcher, the page with `fetch`); this
//! says which, and reads them.

use crate::output::Output;
use crate::osm::{needs_ocean, Element, Feature, Tags};
use geo::{BoundingRect, Coord, Geometry, LineString, MultiPolygon, Polygon};
use terramask::{merc_to_lonlat, tiles_touching, Features, Filter, TileId};

/// OpenFreeMap's planet tiles, as a TileJSON: no key, CORS open, weekly builds.
/// Attribution: "© OpenMapTiles © OpenStreetMap contributors".
pub const TILES: &str = "https://tiles.openfreemap.org/planet";

/// The tag holding a tile feature's layer (`building`, `transportation`…).
/// The other tags are the tile's own: `class`, `subclass`, `brunnel`…
pub const LAYER_TAG: &str = "tiles:layer";

/// Features are cut this much (a fraction of the output's size, on each side)
/// beyond the output: the outline of a park cut at the box would otherwise be
/// drawn along the output's edge.
const PAD: f64 = 0.05;

/// Features come from the deepest zoom, where every building is; past this
/// many tiles the output is big enough to step out a zoom at a time.
///
/// Buildings live deeper still: OpenFreeMap has none at z12 and below, so a
/// document that reads them pads out the cap rather than losing them. Tiles
/// are small (tens of KB) and the host fetches them eight at a time, so a
/// few hundred is a few seconds, not a memory problem.
const MAX_FEATURE_TILES: usize = 64;
const MAX_BUILDING_TILES: usize = 1024;

/// Whether a selector asks for buildings specifically: only those pay for the
/// deeper zoom, since the shallower layers (roads, water, landcover) read as
/// well from fewer tiles.
fn wants_buildings(selectors: &[String]) -> bool {
    selectors.iter().any(|s| s.split(&[',', ' '][..]).any(|part| part.trim().split(':').next() == Some("building") || part.trim() == "buildings"))
}

fn selectors_mention_ocean(selectors: &[String]) -> bool {
    selectors.iter().any(|s| s.split(&[',', ' '][..]).any(|part| part.trim() == "ocean" || part.trim().starts_with("water:") && part.contains("ocean")))
}

/// Filter items for the tile download: drop `ocean` inland when Overpass shows
/// no coastline, and ensure it is present when the profile asks and the coast
/// may show.
fn filter_selectors(selectors: &[String], osm: Option<&[Feature]>) -> Vec<String> {
    let mut out = selectors.to_vec();
    if !selectors_mention_ocean(&out) {
        return out;
    }
    let fetch = osm.is_none_or(needs_ocean);
    if fetch {
        if !out.iter().any(|s| s.trim() == "ocean") {
            out.push("ocean".into());
        }
    } else {
        out.retain(|s| s.trim() != "ocean");
    }
    out
}

/// What a document reads from the tiles, decided once Overpass (if the
/// document asks it anything) has answered. `None` when nothing is needed.
pub fn plan(output: &Output, selectors: &[String], osm: Option<&[Feature]>) -> Result<Option<Tiles>, String> {
    if selectors.is_empty() {
        return Ok(None);
    }
    let mut tiles = Tiles::new(&output.query_polygon(), selectors, osm)?;
    tiles.set_zoom(output.tile_zoom);
    Ok(Some(tiles))
}

/// Past this many tiles a download is worth a word to whoever waits for it.
const LARGE_DOWNLOAD: usize = 300;

/// The tiles under one output, gathered one by one.
pub struct Tiles {
    bounds: [f64; 4],
    /// The area itself (lon/lat), padded like `bounds`: only the tiles it
    /// touches are read, a fraction of the box's when the output is turned.
    ring: Vec<[f64; 2]>,
    /// The zoom the document asks for, if it does.
    zoom: Option<u8>,
    /// Whether the selections read buildings, which only the deepest zooms hold.
    buildings: bool,
    /// How many tiles the deepest zoom may need before stepping out: the
    /// larger cap when buildings are read, the smaller one otherwise.
    max_tiles: usize,
    /// Everything read from each tile.
    filter: Filter,
    data: Features,
}

impl Tiles {
    /// The tiles inside `area` (lon/lat), usually the output's query polygon.
    /// `selectors` are terramask's: presets (`buildings`, `roads`) and
    /// `layer:class` rules.
    pub fn new(area: &Polygon<f64>, selectors: &[String], osm: Option<&[Feature]>) -> Result<Tiles, String> {
        let bounds = area
            .bounding_rect()
            .map(|r| {
                let (dx, dy) = (r.width() * PAD, r.height() * PAD);
                [r.min().x - dx, r.min().y - dy, r.max().x + dx, r.max().y + dy]
            })
            .unwrap_or_default();
        let ring = {
            let points = &area.exterior().0;
            let n = points.len().saturating_sub(1).max(1) as f64;
            let c = points.iter().take(points.len().saturating_sub(1).max(1)).fold(Coord { x: 0.0, y: 0.0 }, |c, p| c + *p) / n;
            points.iter().map(|p| [c.x + (p.x - c.x) * (1.0 + 2.0 * PAD), c.y + (p.y - c.y) * (1.0 + 2.0 * PAD)]).collect()
        };
        let filter_items = filter_selectors(selectors, osm);
        let filter = Filter::parse(&filter_items).map_err(|e| e.to_string())?;
        let buildings = wants_buildings(selectors);
        let max_tiles = if buildings { MAX_BUILDING_TILES } else { MAX_FEATURE_TILES };
        Ok(Tiles { bounds, ring, zoom: None, buildings, max_tiles, filter, data: Features::new() })
    }

    /// Read the tiles at this zoom (capped by the source's), not the deepest
    /// that fits: `None` goes back to choosing.
    pub fn set_zoom(&mut self, zoom: Option<u8>) {
        self.zoom = zoom;
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
        if let Some(z) = self.zoom {
            return z.min(max_zoom);
        }
        let mut z = max_zoom;
        while z > 0 && self.tiles_at(z).len() > self.max_tiles {
            z -= 1;
        }
        z
    }

    /// The tiles to download, for a source whose deepest zoom is `max_zoom`.
    pub fn tiles(&self, max_zoom: u8) -> Vec<TileId> {
        self.tiles_at(self.zoom(max_zoom))
    }

    fn tiles_at(&self, z: u8) -> Vec<TileId> {
        tiles_touching(&self.ring, z)
    }

    /// What the download will be, in a line for whoever waits for it, and
    /// whether it deserves a warning: detail given up (buildings lost, or
    /// any zoom short of the deepest), or a long download.
    pub fn note(&self, max_zoom: u8) -> (String, bool) {
        let z = self.zoom(max_zoom);
        let n = self.tiles_at(z).len();
        let mut text = format!("zoom {z}, {n} tiles");
        let mut warn = false;
        if z < max_zoom && self.zoom.is_none() {
            warn = true;
            let deepest = self.tiles_at(max_zoom).len();
            text += &format!(" — zoom {max_zoom} would be {deepest}, past the {} allowed", self.max_tiles);
            if z <= 12 && self.buildings {
                text += "; there are no buildings below zoom 13";
            }
            text += &format!(". Set output({{ tileZoom: {max_zoom} }}) to read it anyway");
        } else if let Some(asked) = self.zoom.filter(|&a| a > max_zoom) {
            warn = true;
            text += &format!(" — tileZoom {asked} is deeper than the source's {max_zoom}");
        }
        if n > LARGE_DOWNLOAD {
            warn = true;
            text += &format!(" — a large download (~{} MB)", (n * 40).div_ceil(1000).max(1));
        }
        (text, warn)
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

    /// What `tiles_select` can pick from, in lon/lat: each feature whole
    /// (mended across tile edges, cut to the bounds), its layer in
    /// [`LAYER_TAG`] and the tile's attributes as tags.
    pub fn features(&self) -> Vec<Feature> {
        let joined = self.data.joined(Some(self.bounds));
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
    fn no_tiles_without_selectors() {
        assert!(plan(&Output {
            center: (-122.45, 37.85),
            width_mm: 100.0,
            height_mm: 100.0,
            scale: 10_000.0,
            bearing: 0.0,
            projection: crate::profile::ProjectionMode::Webmercator,
            tile_zoom: None,
        }, &[], None).unwrap().is_none());
    }

    #[test]
    fn selections_read_at_the_deepest_zoom_that_fits() {
        let small = polygon![(x: -122.26, y: 37.87), (x: -122.25, y: 37.87), (x: -122.25, y: 37.88), (x: -122.26, y: 37.88)];
        let t = Tiles::new(&small, &["buildings".into(), "roads".into()], None).unwrap();
        assert_eq!(t.zoom(14), 14);
        assert_eq!(t.filter().layers(), ["building", "transportation"]);
        let wide = polygon![(x: -124.0, y: 36.0), (x: -120.0, y: 36.0), (x: -120.0, y: 39.0), (x: -124.0, y: 39.0)];
        let big = Tiles::new(&wide, &["buildings".into()], None).unwrap();
        assert!(big.zoom(14) < 14 && big.tiles(14).len() <= MAX_BUILDING_TILES);
        let strip = polygon![(x: 8.88, y: 45.33), (x: 9.47, y: 45.33), (x: 9.47, y: 45.61), (x: 8.88, y: 45.61)];
        let with = Tiles::new(&strip, &["buildings".into()], None).unwrap();
        let without = Tiles::new(&strip, &["roads".into()], None).unwrap();
        assert_eq!(with.zoom(14), 14);
        assert!(without.zoom(14) < 14);
        assert!(Tiles::new(&small, &["forrest".into()], None).is_err());
    }

    /// The 50 km strip over Milan, turned 34°.
    fn milan_strip() -> Output {
        Output {
            center: (9.1716726, 45.4684961),
            width_mm: 5000.0,
            height_mm: 100.0,
            scale: 10000.0,
            bearing: -34.0,
            projection: crate::profile::ProjectionMode::Webmercator,
            tile_zoom: None,
        }
    }

    #[test]
    fn a_turned_output_reads_only_the_tiles_under_it() {
        let output = milan_strip();
        let t = plan(&output, &["buildings".into()], None).unwrap().unwrap();
        let box_tiles = terramask::tiles_for(&t.bounds(), 14).len();
        let read = t.tiles(14);
        assert_eq!(read[0].z, 14);
        assert!(read.len() * 3 < box_tiles, "{} of {box_tiles}", read.len());
        assert!(!t.note(14).1, "{}", t.note(14).0);
    }

    #[test]
    fn the_document_can_set_the_zoom_and_hears_when_detail_is_lost() {
        let mut output = milan_strip();
        output.height_mm = 8000.0;
        output.width_mm = 8000.0;
        let auto = plan(&output, &["buildings".into()], None).unwrap().unwrap();
        let (text, warn) = auto.note(14);
        assert!(warn && text.contains("tileZoom: 14"), "{text}");
        output.tile_zoom = Some(11);
        let set = plan(&output, &["buildings".into()], None).unwrap().unwrap();
        assert_eq!(set.zoom(14), 11);
        output.tile_zoom = Some(16);
        let deep = plan(&output, &["buildings".into()], None).unwrap().unwrap();
        assert_eq!(deep.zoom(14), 14);
        assert!(deep.note(14).0.contains("deeper than the source's"));
    }

    /// Open water across two tiles (Martha's Vineyard fixtures): ocean features
    /// must span the query west–east.
    #[test]
    fn ocean_tile_features_span_the_query() {
        use geo::polygon;
        const WEST: &[u8] = include_bytes!("../../../../terramask/crates/terramask/tests/fixtures/12-1243-1528.pbf");
        const EAST: &[u8] = include_bytes!("../../../../terramask/crates/terramask/tests/fixtures/12-1244-1528.pbf");
        let (a, b) = (
            TileId::new(12, 1243, 1528).merc_bounds(),
            TileId::new(12, 1244, 1528).merc_bounds(),
        );
        let [w, s] = merc_to_lonlat(a[0], a[1]);
        let [e, n] = merc_to_lonlat(b[2], b[3]);
        let area = polygon![(x: w, y: s), (x: e, y: s), (x: e, y: n), (x: w, y: n)];
        let mut tiles = Tiles::new(&area, &["ocean".into()], None).unwrap();
        tiles.add_tile(TileId::new(12, 1243, 1528), WEST).unwrap();
        tiles.add_tile(TileId::new(12, 1244, 1528), EAST).unwrap();
        let ocean = Filter::parse(&["ocean"]).unwrap();
        let feats = tiles.features();
        let parts: Vec<MultiPolygon<f64>> = feats
            .iter()
            .filter(|f| keeps(&ocean, f))
            .map(|f| MultiPolygon::new(crate::geom::polygons(&f.geometry)))
            .collect();
        let sea = crate::geom::union_multi(&parts);
        let q = area.bounding_rect().expect("query");
        let r = sea.bounding_rect().expect("sea");
        let eps = q.width() * 0.02;
        assert!(
            (r.min().x - q.min().x).abs() < eps && (r.max().x - q.max().x).abs() < eps,
            "ocean features should span the query ({:?}), got {:?}",
            q,
            r
        );
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
