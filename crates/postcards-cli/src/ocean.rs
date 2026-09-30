//! Sea polygons for a card from OpenStreetMap vector tiles (watermask).

use geo::{Coord, LineString, MultiPolygon, Polygon};
use watermask::{merc_to_lonlat, Fetcher, Filter, Grid, ZoomLimits};

/// Ocean inside `bounds` (`[west, south, east, north]`), lon/lat. Detail is
/// picked as if drawing 2048 px across, like the Python pipeline.
pub fn ocean(bounds: [f64; 4]) -> Result<MultiPolygon<f64>, String> {
    let grid = Grid::with_width(bounds, 2048);
    let filter = Filter { areas: vec!["ocean".into()], lines: vec![], intermittent: false, tunnels: false };
    let water = Fetcher::new()
        .water_for(&grid, &filter, &ZoomLimits::default(), |_, _| {})
        .map_err(|e| format!("ocean tiles: {e}"))?
        .merged(Some(bounds));

    let ring = |pts: &[[f64; 2]]| -> LineString<f64> {
        pts.iter()
            .map(|p| {
                let [x, y] = merc_to_lonlat(p[0], p[1]);
                Coord { x, y }
            })
            .collect()
    };
    let mut polys: Vec<Polygon<f64>> = Vec::new();
    for area in water.areas.iter().filter(|a| a.class == "ocean") {
        for r in &area.rings {
            if r.exterior {
                polys.push(Polygon::new(ring(&r.points), vec![]));
            } else if let Some(last) = polys.last_mut() {
                last.interiors_push(ring(&r.points));
            }
        }
    }
    Ok(MultiPolygon::new(polys))
}
