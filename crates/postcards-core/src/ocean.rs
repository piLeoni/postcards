//! The sea for a card, from OpenStreetMap vector tiles read by terramask.
//!
//! Overpass has the coastline but not the sea: the polygons come from the
//! `water` layer of OpenMapTiles tiles instead. The host downloads them (the
//! command line through terramask's fetcher, the page with `fetch`); this
//! says which tiles, and reads them.

use geo::{BoundingRect, Coord, LineString, MultiPolygon, Polygon};
use terramask::{merc_to_lonlat, tiles_for, zoom_for, Features, Filter, TileId, ZoomLimits};

/// OpenFreeMap's planet tiles, as a TileJSON: no key, CORS open, weekly builds.
/// Attribution: "© OpenMapTiles © OpenStreetMap contributors".
pub const TILES: &str = "https://tiles.openfreemap.org/planet";

/// Detail is picked as if drawing this many pixels across, like the Python
/// pipeline.
const WIDTH_PX: usize = 2048;

/// The sea under one card, gathered tile by tile.
pub struct Ocean {
    bounds: [f64; 4],
    filter: Filter,
    features: Features,
}

impl Ocean {
    /// The sea inside `area` (lon/lat), usually the card's query polygon.
    pub fn new(area: &Polygon<f64>) -> Ocean {
        let b = area.bounding_rect().map(|r| [r.min().x, r.min().y, r.max().x, r.max().y]).unwrap_or_default();
        Ocean { bounds: b, filter: filter(), features: Features::new() }
    }

    /// `[west, south, east, north]`.
    pub fn bounds(&self) -> [f64; 4] {
        self.bounds
    }

    /// The tile zoom, no deeper than `max_zoom` (the tile source's).
    pub fn zoom(&self, max_zoom: u8) -> u8 {
        zoom_for(&self.bounds, WIDTH_PX, &ZoomLimits { max_zoom, ..ZoomLimits::default() })
    }

    /// The tiles to download, for a source whose deepest zoom is `max_zoom`.
    pub fn tiles(&self, max_zoom: u8) -> Vec<TileId> {
        tiles_for(&self.bounds, self.zoom(max_zoom))
    }

    /// One downloaded tile (raw or gzipped protobuf).
    pub fn add_tile(&mut self, id: TileId, bytes: &[u8]) -> Result<(), String> {
        self.features.add_tile(id, bytes, &self.filter).map_err(|e| e.to_string())
    }

    /// Tiles read elsewhere, by terramask's fetcher with [`filter`].
    pub fn add_features(&mut self, features: Features) {
        self.features.areas.extend(features.areas);
        self.features.lines.extend(features.lines);
    }

    /// The sea joined across tile edges and cut to the bounds, in lon/lat.
    pub fn polygons(&self) -> MultiPolygon<f64> {
        let ring = |pts: &[[f64; 2]]| -> LineString<f64> {
            pts.iter()
                .map(|p| {
                    let [x, y] = merc_to_lonlat(p[0], p[1]);
                    Coord { x, y }
                })
                .collect()
        };
        let mut polys: Vec<Polygon<f64>> = Vec::new();
        let merged = self.features.merged(Some(self.bounds));
        for area in merged.areas.iter().filter(|a| a.class == "ocean") {
            // Each exterior ring is followed by its holes.
            for r in &area.rings {
                if r.exterior {
                    polys.push(Polygon::new(ring(&r.points), vec![]));
                } else if let Some(last) = polys.last_mut() {
                    last.interiors_push(ring(&r.points));
                }
            }
        }
        MultiPolygon::new(polys)
    }
}

/// What to read from the tiles: the `ocean` class of the `water` layer.
pub fn filter() -> Filter {
    Filter::water(&["ocean"], &[] as &[&str])
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::{polygon, Area};

    #[test]
    fn no_tiles_no_sea() {
        let area = polygon![(x: -122.5, y: 37.7), (x: -122.4, y: 37.7), (x: -122.4, y: 37.8), (x: -122.5, y: 37.8)];
        let ocean = Ocean::new(&area);
        let z = ocean.zoom(14);
        assert!((10..=14).contains(&z), "zoom {z}");
        assert!(!ocean.tiles(14).is_empty());
        assert_eq!(ocean.polygons().unsigned_area(), 0.0);
    }
}
