//! The card: where it is, how big, at what scale — and the ground area and
//! Overpass query that follow from it.

use crate::profile::{MapSpec, ProjectionMode};
use geo::{Coord, LineString, Polygon};
use geographiclib_rs::{DirectGeodesic, Geodesic};

#[derive(Debug, Clone, PartialEq)]
pub struct Card {
    /// Centre `(lon, lat)` in degrees.
    pub center: (f64, f64),
    pub width_mm: f64,
    pub height_mm: f64,
    /// Scale denominator (`1:10000` → `10000`).
    pub scale: f64,
    pub bearing: f64,
    pub projection: ProjectionMode,
}

impl Card {
    pub fn new(map: &MapSpec, center: (f64, f64)) -> Card {
        Card {
            center,
            width_mm: map.width.0,
            height_mm: map.height.0,
            scale: map.scale.0,
            bearing: map.bearing,
            projection: map.projection,
        }
    }

    /// Card size on the ground, metres.
    pub fn ground_size_m(&self) -> (f64, f64) {
        (self.width_mm / 1000.0 * self.scale, self.height_mm / 1000.0 * self.scale)
    }

    /// Millimetres on the card per metre on the ground.
    pub fn mm_per_m(&self) -> f64 {
        1000.0 / self.scale
    }

    /// The card's ground rectangle in lon/lat, rotated by the bearing. Corners
    /// are found by walking geodesics from the centre, so the sides are the
    /// requested ground distance apart at any latitude.
    pub fn query_polygon(&self) -> Polygon<f64> {
        let g = Geodesic::wgs84();
        let (lon, lat) = self.center;
        let (w, h) = self.ground_size_m();
        let walk = |from: (f64, f64), azimuth: f64, dist: f64| -> (f64, f64) {
            let (lat2, lon2): (f64, f64) = g.direct(from.1, from.0, azimuth, dist);
            (lon2, lat2)
        };
        let b = self.bearing;
        let north = walk((lon, lat), b, h / 2.0);
        let south = walk((lon, lat), (b + 180.0) % 360.0, h / 2.0);
        let east = (b + 90.0) % 360.0;
        let west = (b + 270.0) % 360.0;
        let ne = walk(north, east, w / 2.0);
        let nw = walk(north, west, w / 2.0);
        let se = walk(south, east, w / 2.0);
        let sw = walk(south, west, w / 2.0);
        let ring: Vec<Coord<f64>> = [ne, nw, sw, se, ne].iter().map(|&(x, y)| Coord { x, y }).collect();
        Polygon::new(LineString::new(ring), vec![])
    }

    /// `[west, south, east, north]` of the unrotated card area.
    pub fn bounds(&self) -> [f64; 4] {
        let g = Geodesic::wgs84();
        let (lon, lat) = self.center;
        let (w, h) = self.ground_size_m();
        let at = |azimuth: f64, dist: f64| -> (f64, f64) {
            let (lat2, lon2): (f64, f64) = g.direct(lat, lon, azimuth, dist);
            (lon2, lat2)
        };
        [at(270.0, w / 2.0).0, at(180.0, h / 2.0).1, at(90.0, w / 2.0).0, at(0.0, h / 2.0).1]
    }
}

/// OSM keys fetched for a card (each theme filters in memory afterwards).
pub const OSM_TAGS: &[&str] =
    &["building", "highway", "railway", "natural", "water", "landuse", "amenity", "leisure", "waterway"];

/// Keys to ask Overpass for with the older profile: the standard set, then
/// whatever else the profile selects on, since its themes read keys they
/// never declare. A grammar document asks for its own keys alone.
pub fn fetch_keys(needed: &[String]) -> Vec<String> {
    let mut keys: Vec<String> = OSM_TAGS.iter().map(|k| k.to_string()).collect();
    for k in needed {
        if !keys.contains(k) {
            keys.push(k.clone());
        }
    }
    keys
}

/// Overpass servers, tried in order. `z.`
/// and `lz4.` are overpass-api.de's own machines by name: when the main
/// address answers 504 one of them often still has a free slot. (The kumi
/// and private.coffee mirrors took connections and never answered.)
pub const OVERPASS_ENDPOINTS: &[&str] = &[
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/// Seconds to wait before each round of tries over every endpoint. A busy
/// server's 504 often clears within a minute, so a failed round is worth
/// repeating a few times, further apart each time, before giving up.
pub const OVERPASS_ROUND_PAUSE_S: &[u64] = &[0, 10, 30, 60];

/// Longest wait for a free slot after a 429 that is worth sitting through;
/// beyond it the next server is tried instead.
pub const OVERPASS_MAX_SLOT_WAIT_S: u64 = 120;

/// The server's status page next to its `interpreter`: it says how many
/// query slots this address has free, or when the next one frees up.
pub fn overpass_status_url(interpreter: &str) -> String {
    match interpreter.strip_suffix("interpreter") {
        Some(base) => format!("{base}status"),
        None => format!("{}/status", interpreter.trim_end_matches('/')),
    }
}

/// Seconds until a query slot is free, from a status page: 0 when one is
/// free now, `None` when the page says neither.
pub fn overpass_slot_wait_s(status: &str) -> Option<u64> {
    if status.lines().any(|l| l.trim_end().ends_with("slots available now.") && !l.starts_with("0 ")) {
        return Some(0);
    }
    status
        .lines()
        .filter_map(|l| l.split(", in ").nth(1)?.strip_suffix(" seconds.")?.trim().parse::<u64>().ok())
        .min()
}

/// The error Overpass reports inside a 200 reply, when a query ran out of
/// time or memory and the elements are cut short: its `remark`, if it says
/// "error". Read from the end, where Overpass writes it.
pub fn overpass_error(json: &str) -> Option<String> {
    let mut start = json.len().saturating_sub(2000);
    while !json.is_char_boundary(start) {
        start += 1;
    }
    let tail = &json[start..];
    let at = tail.rfind("\"remark\"")?;
    let rest = tail[at + 8..].trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    let text = rest.split('"').next()?.trim();
    text.contains("error").then(|| text.to_string())
}

/// Give up on one endpoint after this long, so a hanging server cannot stall
/// a draw.
pub const OVERPASS_ENDPOINT_TIMEOUT_S: u64 = 60;

/// The Overpass QL osmnx sends for `features_from_polygon(polygon, tags)`
/// with every tag set to `True`. Drawing asks for a padded box instead
/// (`osm_cache::request`); this one finds the replies osmnx cached, for the
/// parity examples.
pub fn overpass_query(polygon: &Polygon<f64>, tags: &[&str], timeout_s: u32) -> String {
    let coords: Vec<String> =
        polygon.exterior().coords().map(|c| format!("{:.6} {:.6}", c.y, c.x)).collect();
    let poly = coords.join(" ");
    let mut components = String::new();
    for key in tags {
        let tag_str = format!("['{key}'](poly:'{poly}');(._;>;);");
        for kind in ["node", "way", "relation"] {
            components.push_str(&format!("({kind}{tag_str});"));
        }
    }
    format!("[out:json][timeout:{timeout_s}];({components});out;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ferry() -> Card {
        Card {
            center: (-122.3934746, 37.7955487),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 10000.0,
            bearing: 0.0,
            projection: ProjectionMode::Utm,
        }
    }

    #[test]
    fn query_matches_osmnx() {
        // Captured from osmnx 2.0.2 for the same card; the osmnx cache key
        // depends on this exact text.
        let q = overpass_query(&ferry().query_polygon(), OSM_TAGS, 180);
        assert!(q.starts_with(
            "[out:json][timeout:180];((node['building'](poly:'37.800125 -122.384822 37.800125 -122.402127 \
             37.790971 -122.402126 37.790971 -122.384823 37.800125 -122.384822');(._;>;););"
        ));
        assert!(q.ends_with(");out;"));
    }

    #[test]
    fn status_pages_and_remarks() {
        let busy = "Connected as: 1\nRate limit: 2\n0 slots available now.\n\
                    Slot available after: 2026-10-02T08:32:01Z, in 36 seconds.\n\
                    Slot available after: 2026-10-02T08:32:20Z, in 55 seconds.\n";
        let free = "Rate limit: 4\n3 slots available now.\nSlot available after: 2026-10-02T08:33:06Z, in 26 seconds.\n";
        assert_eq!(overpass_slot_wait_s(busy), Some(36));
        assert_eq!(overpass_slot_wait_s(free), Some(0));
        assert_eq!(overpass_slot_wait_s("<html>406</html>"), None);
        assert_eq!(
            overpass_status_url("https://overpass-api.de/api/interpreter"),
            "https://overpass-api.de/api/status"
        );
        let cut = r#"{"elements":[{"type":"node","id":1,"lat":0,"lon":0}],
"remark": "runtime error: Query timed out in \"query\" at line 1 after 61 seconds." }"#;
        assert!(overpass_error(cut).unwrap().starts_with("runtime error: Query timed out"));
        assert_eq!(overpass_error(r#"{"elements":[]}"#), None);
    }

    #[test]
    fn bounds_are_geodesic() {
        let [w, s, e, n] = ferry().bounds();
        assert!((n - 37.800125).abs() < 1e-6 && (s - 37.790971).abs() < 1e-6);
        assert!(w < -122.4021 && e > -122.3849);
    }
}
