//! Geographic coordinates onto the card, in millimetres, y down.
//!
//! `utm` projects into the UTM zone of the card centre (transverse Mercator,
//! Krüger series to n⁶ — the algorithm PROJ uses, so points agree with pyproj
//! far below plotting resolution), so distances are true but north turns away
//! from the page's up the further the card is from the zone's central
//! meridian (1.4° in Boston). `webmercator` projects to EPSG:3857 with one
//! scale for both axes, the cosine of the centre's latitude, as web maps count
//! metres: the drawing is a crop of the Mapbox map the web app shows, to the
//! pixel. Both then centre on the card, scale to mm, flip y, and turn by the
//! bearing.

use crate::card::Card;
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

#[derive(Debug, Clone)]
enum Base {
    Utm(Utm),
    Merc,
}

/// lon/lat → card mm for one card.
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
    pub fn new(card: &Card) -> Projector {
        let (lon, lat) = card.center;
        let mm_per_m = card.mm_per_m();
        let (base, center, fx, fy) = match card.projection {
            ProjectionMode::Utm => {
                let utm = Utm::new(Utm::zone_for(lon), lat < 0.0);
                let c = utm.forward(lon, lat);
                (Base::Utm(utm), c, 1.0, 1.0)
            }
            ProjectionMode::Webmercator => {
                let k = lat.to_radians().cos();
                (Base::Merc, merc_forward(lon, lat), k, k)
            }
        };
        // Shapely's rotate(-bearing) about the card centre, in page space.
        let theta = (-card.bearing).to_radians();
        Projector {
            base,
            center,
            sx: mm_per_m * fx,
            sy: -mm_per_m * fy,
            half: (card.width_mm / 2.0, card.height_mm / 2.0),
            cos_b: theta.cos(),
            sin_b: theta.sin(),
        }
    }

    pub fn project(&self, lon: f64, lat: f64) -> (f64, f64) {
        let (x, y) = match &self.base {
            Base::Utm(u) => u.forward(lon, lat),
            Base::Merc => merc_forward(lon, lat),
        };
        let dx = (x - self.center.0) * self.sx;
        let dy = (y - self.center.1) * self.sy;
        (self.half.0 + dx * self.cos_b - dy * self.sin_b, self.half.1 + dx * self.sin_b + dy * self.cos_b)
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
            let card = Card {
                center: (-122.3934746, 37.7955487),
                width_mm: 152.4,
                height_mm: 101.6,
                scale: 10000.0,
                bearing,
                projection,
            };
            let p = Projector::new(&card);
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
        let card = |projection| Card {
            center: (-71.079, 42.3617),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 8000.0,
            bearing: 0.0,
            projection,
        };
        let p = Projector::new(&card(ProjectionMode::Webmercator));
        // A web map's pixel is square, cos(latitude) metres per Mercator metre.
        let k = 42.3617_f64.to_radians().cos() * card(ProjectionMode::Webmercator).mm_per_m();
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
        let utm = Projector::new(&card(ProjectionMode::Utm)).project(north.0, north.1);
        assert!((utm.0 - 76.2).abs() > 0.1, "UTM leans: {}", utm.0);
    }

    #[test]
    fn card_centre_lands_mid_page() {
        let card = Card {
            center: (-122.3934746, 37.7955487),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 10000.0,
            bearing: 30.0,
            projection: ProjectionMode::Webmercator,
        };
        let p = Projector::new(&card);
        let (x, y) = p.project(card.center.0, card.center.1);
        assert_abs_diff_eq!(x, 76.2, epsilon = 1e-9);
        assert_abs_diff_eq!(y, 50.8, epsilon = 1e-9);
    }
}
