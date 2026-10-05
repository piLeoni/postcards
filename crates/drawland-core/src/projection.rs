//! Geographic coordinates onto the output, in millimetres, y down.
//!
//! `utm` projects into the UTM zone of the output centre (transverse Mercator,
//! Krüger series to n⁶ — the algorithm PROJ uses, so points agree with pyproj
//! far below plotting resolution), so distances are true but north turns away
//! from the page's up the further the output is from the zone's central
//! meridian (1.4° in Boston). `webmercator` projects to EPSG:3857 with one
//! scale for both axes, the cosine of the centre's latitude, as web maps count
//! metres: the drawing is a crop of the web map the app shows, to the
//! pixel. A PROJ string goes through proj4rs, scaled so a small square of
//! ground at the centre keeps its area at the output's scale. All of them then
//! centre on the output, scale to mm, flip y, and turn by the bearing.

use crate::output::Output;
use crate::profile::ProjectionMode;
use geo::{Coord, MapCoords};

const WGS84_A: f64 = 6_378_137.0;
const WGS84_F: f64 = 1.0 / 298.257_223_563;
const UTM_K0: f64 = 0.9996;

/// Forward transverse Mercator for one UTM zone.
#[derive(Debug, Clone)]
pub struct Utm {
    lon0: f64,
    false_northing: f64,
    e: f64,
    a_hat: f64,
    alpha: [f64; 6],
}

impl Utm {
    pub fn zone_for(lon: f64) -> u32 {
        ((lon + 180.0) / 6.0).floor() as u32 + 1
    }

    pub fn new(zone: u32, south: bool) -> Utm {
        let f = WGS84_F;
        let n = f / (2.0 - f);
        let (n2, n3, n4, n5, n6) = (n * n, n.powi(3), n.powi(4), n.powi(5), n.powi(6));
        let a_hat = WGS84_A / (1.0 + n) * (1.0 + n2 / 4.0 + n4 / 64.0 + n6 / 256.0);
        let alpha = [
            n / 2.0 - 2.0 / 3.0 * n2 + 5.0 / 16.0 * n3 + 41.0 / 180.0 * n4 - 127.0 / 288.0 * n5
                + 7891.0 / 37800.0 * n6,
            13.0 / 48.0 * n2 - 3.0 / 5.0 * n3 + 557.0 / 1440.0 * n4 + 281.0 / 630.0 * n5
                - 1983433.0 / 1935360.0 * n6,
            61.0 / 240.0 * n3 - 103.0 / 140.0 * n4 + 15061.0 / 26880.0 * n5 + 167603.0 / 181440.0 * n6,
            49561.0 / 161280.0 * n4 - 179.0 / 168.0 * n5 + 6601661.0 / 7257600.0 * n6,
            34729.0 / 80640.0 * n5 - 3418889.0 / 1995840.0 * n6,
            212378941.0 / 319334400.0 * n6,
        ];
        Utm {
            lon0: (zone as f64 - 1.0) * 6.0 - 180.0 + 3.0,
            false_northing: if south { 10_000_000.0 } else { 0.0 },
            e: (f * (2.0 - f)).sqrt(),
            a_hat,
            alpha,
        }
    }

    /// `(lon, lat)` degrees → `(easting, northing)` metres.
    pub fn forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        let phi = lat.to_radians();
        let lam = (lon - self.lon0).to_radians();
        let s = phi.sin();
        let t = (s.atanh() - self.e * (self.e * s).atanh()).sinh();
        let xi_p = t.atan2(lam.cos());
        let eta_p = (lam.sin() / (1.0 + t * t).sqrt()).atanh();
        let (mut xi, mut eta) = (xi_p, eta_p);
        for (j, a) in self.alpha.iter().enumerate() {
            let k = 2.0 * (j as f64 + 1.0);
            xi += a * (k * xi_p).sin() * (k * eta_p).cosh();
            eta += a * (k * xi_p).cos() * (k * eta_p).sinh();
        }
        (500_000.0 + UTM_K0 * self.a_hat * eta, self.false_northing + UTM_K0 * self.a_hat * xi)
    }
}

fn merc_forward(lon: f64, lat: f64) -> (f64, f64) {
    let x = WGS84_A * lon.to_radians();
    let y = WGS84_A * (std::f64::consts::FRAC_PI_4 + lat.to_radians() / 2.0).tan().ln();
    (x, y)
}

/// A PROJ projection, from WGS84 lon/lat.
#[derive(Clone)]
struct Proj {
    from: proj4rs::proj::Proj,
    to: proj4rs::proj::Proj,
}

impl std::fmt::Debug for Proj {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Proj")
    }
}

impl Proj {
    fn new(definition: &str) -> Result<Proj, String> {
        let from = proj4rs::proj::Proj::from_proj_string("+proj=longlat +datum=WGS84").map_err(|e| e.to_string())?;
        let to = proj4rs::proj::Proj::from_proj_string(definition).map_err(|e| format!("{definition:?}: {e}"))?;
        Ok(Proj { from, to })
    }

    /// Projected `(x, y)`; NaN where the projection has no value (the far
    /// side of the globe for a geostationary view).
    fn forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        let mut p = (lon.to_radians(), lat.to_radians(), 0.0);
        match proj4rs::transform::transform(&self.from, &self.to, &mut p) {
            Ok(()) => (p.0, p.1),
            Err(_) => (f64::NAN, f64::NAN),
        }
    }

    fn inverse(&self, x: f64, y: f64) -> Option<(f64, f64)> {
        let mut p = (x, y, 0.0);
        proj4rs::transform::transform(&self.to, &self.from, &mut p).ok()?;
        Some((p.0.to_degrees(), p.1.to_degrees()))
    }

    /// Projected units per ground metre at `(lon, lat)`: the square root of
    /// how much a small square of ground grows, so area keeps its scale even
    /// where the projection stretches one way more than the other.
    fn units_per_m(&self, lon: f64, lat: f64) -> f64 {
        use geographiclib_rs::{DirectGeodesic, Geodesic};
        const STEP_M: f64 = 10.0;
        let g = Geodesic::wgs84();
        let at = |azimuth: f64| {
            let (lat2, lon2): (f64, f64) = g.direct(lat, lon, azimuth, STEP_M);
            self.forward(lon2, lat2)
        };
        let o = self.forward(lon, lat);
        let (e, n) = (at(90.0), at(0.0));
        let (ex, ey, nx, ny) = (e.0 - o.0, e.1 - o.1, n.0 - o.0, n.1 - o.1);
        let k = (ex * ny - ey * nx).abs().sqrt() / STEP_M;
        if k.is_finite() && k > 0.0 { k } else { 1.0 }
    }
}

#[derive(Debug, Clone)]
enum Base {
    Utm(Utm),
    Merc,
    Proj(Box<Proj>),
}

/// lon/lat → output mm for one output.
#[derive(Debug, Clone)]
pub struct Projector {
    base: Base,
    center: (f64, f64),
    sx: f64,
    sy: f64,
    half: (f64, f64),
    cos_b: f64,
    sin_b: f64,
}

impl Projector {
    pub fn new(output: &Output) -> Projector {
        let (lon, lat) = output.center;
        let mm_per_m = output.mm_per_m();
        let webmercator = || {
            let k = lat.to_radians().cos();
            (Base::Merc, merc_forward(lon, lat), k, k)
        };
        let (base, center, fx, fy) = match &output.projection {
            ProjectionMode::Utm => {
                let utm = Utm::new(Utm::zone_for(lon), lat < 0.0);
                let c = utm.forward(lon, lat);
                (Base::Utm(utm), c, 1.0, 1.0)
            }
            ProjectionMode::Webmercator => webmercator(),
            // The profile checked the string when it was read; only a centre
            // the projection cannot reach is left to fail here.
            ProjectionMode::Proj(template) => match Proj::new(&ProjectionMode::proj_string(template, output.center)) {
                Ok(p) => {
                    let k = 1.0 / p.units_per_m(lon, lat);
                    let c = p.forward(lon, lat);
                    if c.0.is_finite() && c.1.is_finite() { (Base::Proj(Box::new(p)), c, k, k) } else { webmercator() }
                }
                Err(_) => webmercator(),
            },
        };
        // Shapely's rotate(-bearing) about the output centre, in page space.
        let theta = (-output.bearing).to_radians();
        Projector {
            base,
            center,
            sx: mm_per_m * fx,
            sy: -mm_per_m * fy,
            half: (output.width_mm / 2.0, output.height_mm / 2.0),
            cos_b: theta.cos(),
            sin_b: theta.sin(),
        }
    }

    pub fn project(&self, lon: f64, lat: f64) -> (f64, f64) {
        let (x, y) = match &self.base {
            Base::Utm(u) => u.forward(lon, lat),
            Base::Merc => merc_forward(lon, lat),
            Base::Proj(p) => p.forward(lon, lat),
        };
        let dx = (x - self.center.0) * self.sx;
        let dy = (y - self.center.1) * self.sy;
        (self.half.0 + dx * self.cos_b - dy * self.sin_b, self.half.1 + dx * self.sin_b + dy * self.cos_b)
    }

    /// Output mm back to `(lon, lat)`, for a PROJ projection; `None` for the
    /// built-in ones, whose ground area is a geodesic rectangle anyway.
    pub fn unproject(&self, x: f64, y: f64) -> Option<(f64, f64)> {
        let Base::Proj(p) = &self.base else { return None };
        let (px, py) = (x - self.half.0, y - self.half.1);
        let (dx, dy) = (px * self.cos_b + py * self.sin_b, -px * self.sin_b + py * self.cos_b);
        p.inverse(self.center.0 + dx / self.sx, self.center.1 + dy / self.sy)
    }

    pub fn project_geometry<G: MapCoords<f64, f64, Output = G>>(&self, g: &G) -> G {
        g.map_coords(|c| {
            let (x, y) = self.project(c.x, c.y);
            Coord { x, y }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    // Reference values from pyproj 3.7.1 (Transformer EPSG:4326 → EPSG:32610 /
    // 32633 / 32756, always_xy).
    #[test]
    fn utm_matches_pyproj() {
        let cases = [
            (10, false, -122.3934746, 37.7955487, 553399.060380, 4183304.335362),
            (10, false, -125.9, 45.0, 271435.514118, 4987042.306615),
            (33, false, 11.3426, 44.4939, 209210.902664, 4933240.574922),
            (56, true, 151.2093, -33.8688, 334368.633648, 6250948.345385),
        ];
        for (zone, south, lon, lat, e, n) in cases {
            let (x, y) = Utm::new(zone, south).forward(lon, lat);
            assert_abs_diff_eq!(x, e, epsilon = 1e-5);
            assert_abs_diff_eq!(y, n, epsilon = 1e-5);
        }
    }

    // Reference values from postcards.utils.projection.project (Python).
    #[test]
    fn card_matches_python_projection() {
        let cases = [
            (ProjectionMode::Utm, 0.0, [(106.685924534, 34.498819133), (19.001922261, 90.543444644)]),
            (ProjectionMode::Utm, 30.0, [(94.450994671, 21.439800991), (46.536733953, 113.817871565)]),
        ];
        for (projection, bearing, expected) in cases {
            let output = Output {
                center: (-122.3934746, 37.7955487),
                width_mm: 152.4,
                height_mm: 101.6,
                scale: 10000.0,
                bearing,
                projection,
                tile_zoom: None,
            };
            let p = Projector::new(&output);
            for ((lon, lat), (ex, ey)) in [(-122.39, 37.797), (-122.40, 37.792)].into_iter().zip(expected) {
                let (x, y) = p.project(lon, lat);
                assert_abs_diff_eq!(x, ex, epsilon = 1e-6);
                assert_abs_diff_eq!(y, ey, epsilon = 1e-6);
            }
        }
    }

    #[test]
    fn webmercator_is_a_crop_of_the_web_map() {
        // Boston, 2° off its UTM zone's meridian: UTM turns north by 1.4°.
        let output = |projection| Output {
            center: (-71.079, 42.3617),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 8000.0,
            bearing: 0.0,
            tile_zoom: None,
            projection,
        };
        let p = Projector::new(&output(ProjectionMode::Webmercator));
        // A web map's pixel is square, cos(latitude) metres per Mercator metre.
        let k = 42.3617_f64.to_radians().cos() * output(ProjectionMode::Webmercator).mm_per_m();
        let (cx, cy) = merc_forward(-71.079, 42.3617);
        for (dx, dy) in [(500.0, 0.0), (0.0, 400.0), (-300.0, -250.0)] {
            let (lon, lat) = {
                let (x, y) = (cx + dx, cy + dy);
                ((x / WGS84_A).to_degrees(), (2.0 * (y / WGS84_A).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees())
            };
            let (x, y) = p.project(lon, lat);
            assert_abs_diff_eq!(x, 76.2 + dx * k, epsilon = 1e-9);
            assert_abs_diff_eq!(y, 50.8 - dy * k, epsilon = 1e-9);
        }
        let north = (-71.079, 42.368);
        assert_abs_diff_eq!(p.project(north.0, north.1).0, 76.2, epsilon = 1e-9);
        let utm = Projector::new(&output(ProjectionMode::Utm)).project(north.0, north.1);
        assert!((utm.0 - 76.2).abs() > 0.1, "UTM leans: {}", utm.0);
    }

    #[test]
    fn proj_strings_keep_the_scale_at_the_centre() {
        use geographiclib_rs::{DirectGeodesic, Geodesic};
        let output = |projection: &str| Output {
            center: (-71.079, 42.3617),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 8000.0,
            bearing: 0.0,
            tile_zoom: None,
            projection: ProjectionMode::Proj(projection.into()),
        };
        let g = Geodesic::wgs84();
        for def in ["+proj=tmerc +lat_0={lat} +lon_0={lng} +ellps=WGS84", "+proj=laea +lat_0={lat} +lon_0={lng}"] {
            let c = output(def);
            let p = Projector::new(&c);
            let (x, y) = p.project(c.center.0, c.center.1);
            assert_abs_diff_eq!(x, 76.2, epsilon = 1e-6);
            assert_abs_diff_eq!(y, 50.8, epsilon = 1e-6);
            // 500 m east is 500 m at 1:8000 = 62.5 mm, and north stays up.
            let (lat2, lon2): (f64, f64) = g.direct(c.center.1, c.center.0, 90.0, 500.0);
            let (x, _) = p.project(lon2, lat2);
            assert_abs_diff_eq!(x - 76.2, 62.5, epsilon = 0.05);
            let (lat3, lon3): (f64, f64) = g.direct(c.center.1, c.center.0, 0.0, 400.0);
            let (x, y) = p.project(lon3, lat3);
            assert_abs_diff_eq!(x, 76.2, epsilon = 0.01);
            assert_abs_diff_eq!(50.8 - y, 50.0, epsilon = 0.05);
            // The frame, taken back to the ground, is the output's own rectangle.
            let back = c.query_polygon();
            let plain = Output { projection: ProjectionMode::Utm, ..c.clone() }.query_polygon();
            use geo::BoundingRect;
            let (a, b) = (back.bounding_rect().unwrap(), plain.bounding_rect().unwrap());
            assert_abs_diff_eq!(a.min().x, b.min().x, epsilon = 1e-4);
            assert_abs_diff_eq!(a.max().y, b.max().y, epsilon = 1e-4);
        }
    }

    #[test]
    fn projections_read_from_the_card() {
        let read = |p: &str| serde_saphyr::from_str::<crate::profile::OutputSpec>(&format!("projection: \"{p}\"")).map(|m| m.projection);
        assert_eq!(read("webmercator").unwrap(), ProjectionMode::Webmercator);
        assert!(matches!(read("+proj=lcc +lat_1=40 +lat_2=44 +lon_0={lng}").unwrap(), ProjectionMode::Proj(_)));
        assert!(read("+proj=nonsense").is_err());
        assert!(read("mercator").unwrap_err().to_string().contains("PROJ string"));
    }

    #[test]
    fn card_centre_lands_mid_page() {
        let output = Output {
            center: (-122.3934746, 37.7955487),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 10000.0,
            bearing: 30.0,
            tile_zoom: None,
            projection: ProjectionMode::Webmercator,
        };
        let p = Projector::new(&output);
        let (x, y) = p.project(output.center.0, output.center.1);
        assert_abs_diff_eq!(x, 76.2, epsilon = 1e-9);
        assert_abs_diff_eq!(y, 50.8, epsilon = 1e-9);
    }
}
