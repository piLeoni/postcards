//! Distortions of the ground (`output.warp`): every feature, the sea and the
//! output's frame are bent in output millimetres right after projecting, before
//! anything is drawn from them. Areas, roads and rings come out bent; the
//! fills laid inside them stay flat patterns, as on any other output. Each
//! warp keeps the output's edge where it is, so nothing slides off the paper
//! and no blank strip opens along a side.

use crate::units::Mm;
use geo::{Coord, Densify, Euclidean, Geometry, GeometryCollection, MapCoords, MultiPolygon};
use serde::Deserialize;

/// Longest step left in an edge before it is bent: a straight segment
/// stays straight under a warp unless it is cut finer.
const STEP_MM: f64 = 0.2;

/// One warp, written as a single-key map: `{ fisheye: 0.5 }`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase", deny_unknown_fields)]
pub enum Warp {
    /// Magnifies the centre (from 0 to about 1); negative pinches it instead.
    Fisheye(f64),
    /// Turns the centre by this many degrees, less and less towards the edge.
    Twirl(f64),
    /// Ripples both ways: `{ amplitude: 1mm, wavelength: 20mm }`.
    Wave(Wave),
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wave {
    pub amplitude: Mm,
    pub wavelength: Mm,
}

/// One warp or a list of them, applied in order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Warps(pub Vec<Warp>);

impl<'de> Deserialize<'de> for Warps {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum OneOrMany {
            One(Warp),
            Many(Vec<Warp>),
        }
        Ok(Warps(match OneOrMany::deserialize(d)? {
            OneOrMany::One(w) => vec![w],
            OneOrMany::Many(ws) => ws,
        }))
    }
}

impl Warps {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// A geometry in output mm on a `width × height` mm output, bent.
    pub fn bend(&self, width: f64, height: f64, g: &Geometry<f64>) -> Geometry<f64> {
        if self.is_empty() {
            return g.clone();
        }
        let at = |c: Coord<f64>| self.point(width, height, c);
        match g {
            Geometry::LineString(l) => Geometry::LineString(Euclidean.densify(l, STEP_MM).map_coords(at)),
            Geometry::MultiLineString(l) => Geometry::MultiLineString(Euclidean.densify(l, STEP_MM).map_coords(at)),
            Geometry::Polygon(p) => Geometry::Polygon(Euclidean.densify(p, STEP_MM).map_coords(at)),
            Geometry::MultiPolygon(p) => Geometry::MultiPolygon(self.bend_area(width, height, p)),
            Geometry::GeometryCollection(c) => {
                Geometry::GeometryCollection(GeometryCollection(c.iter().map(|g| self.bend(width, height, g)).collect()))
            }
            other => other.map_coords(at),
        }
    }

    pub fn bend_area(&self, width: f64, height: f64, area: &MultiPolygon<f64>) -> MultiPolygon<f64> {
        if self.is_empty() {
            return area.clone();
        }
        Euclidean.densify(area, STEP_MM).map_coords(|c| self.point(width, height, c))
    }

    fn point(&self, width: f64, height: f64, c: Coord<f64>) -> Coord<f64> {
        self.0.iter().fold(c, |c, w| w.point(width, height, c))
    }
}

impl Warp {
    /// Where `c` (output mm) goes. Positions are taken relative to the centre
    /// in units of the half sides, so the edge is where the larger of the two
    /// reaches 1; every warp leaves that edge in place.
    fn point(&self, width: f64, height: f64, c: Coord<f64>) -> Coord<f64> {
        let (hw, hh) = (width / 2.0, height / 2.0);
        let (u, v) = ((c.x - hw) / hw, (c.y - hh) / hh);
        let t = u.abs().max(v.abs());
        let back = |u: f64, v: f64| Coord { x: hw + u * hw, y: hh + v * hh };
        match self {
            Warp::Fisheye(s) => {
                if *s == 0.0 || t == 0.0 {
                    return c;
                }
                let k = 10.0 * s.abs();
                let g = if *s > 0.0 { (1.0 + k * t).ln() / (1.0 + k).ln() } else { ((1.0 + k).powf(t) - 1.0) / k };
                back(u * g / t, v * g / t)
            }
            Warp::Twirl(deg) => {
                if t == 0.0 || t >= 1.0 {
                    return c;
                }
                let a = deg.to_radians() * (1.0 - t).powi(2);
                let (sin, cos) = a.sin_cos();
                let (ru, rv) = (u * cos - v * sin, u * sin + v * cos);
                // Back onto the same square ring, so the turn never crosses the edge.
                let rt = ru.abs().max(rv.abs());
                back(ru * t / rt, rv * t / rt)
            }
            Warp::Wave(w) => {
                let (a, l) = (w.amplitude.0, w.wavelength.0.max(1e-6));
                let fade = |p: f64, side: f64| if (0.0..=side).contains(&p) { (std::f64::consts::PI * p / side).sin() } else { 0.0 };
                let tau = std::f64::consts::TAU;
                let calm = fade(c.x, width) * fade(c.y, height);
                Coord { x: c.x + a * (tau * c.y / l).sin() * calm, y: c.y + a * (tau * c.x / l).sin() * calm }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    fn warps(yaml: &str) -> Warps {
        serde_saphyr::from_str(yaml).unwrap()
    }

    #[test]
    fn reads_one_or_many() {
        assert_eq!(warps("{ fisheye: 0.5 }").0, vec![Warp::Fisheye(0.5)]);
        let two = warps("[{ twirl: 90 }, { wave: { amplitude: 1mm, wavelength: 20mm } }]");
        assert_eq!(two.0.len(), 2);
        assert!(serde_saphyr::from_str::<Warps>("{ swirl: 1 }").is_err());
    }

    #[test]
    fn the_edge_stays_and_the_inside_moves() {
        let (w, h) = (150.0, 100.0);
        for warp in [Warp::Fisheye(0.6), Warp::Fisheye(-0.6), Warp::Twirl(120.0), Warp::Wave(Wave { amplitude: Mm(2.0), wavelength: Mm(15.0) })] {
            for edge in [Coord { x: 0.0, y: 37.0 }, Coord { x: 150.0, y: 80.0 }, Coord { x: 20.0, y: 0.0 }, Coord { x: 150.0, y: 100.0 }] {
                let p = warp.point(w, h, edge);
                assert_abs_diff_eq!(p.x, edge.x, epsilon = 1e-9);
                assert_abs_diff_eq!(p.y, edge.y, epsilon = 1e-9);
            }
            let inside = Coord { x: 90.0, y: 61.0 };
            let p = warp.point(w, h, inside);
            assert!((p.x - inside.x).abs() + (p.y - inside.y).abs() > 0.1, "{warp:?} left {inside:?} alone");
            assert!((0.0..=w).contains(&p.x) && (0.0..=h).contains(&p.y), "{warp:?} sent it off the output");
        }
        // The centre holds for the radial ones; a fisheye pushes the rest outwards.
        let c = Coord { x: 75.0, y: 50.0 };
        assert_eq!(Warp::Fisheye(0.6).point(w, h, c), c);
        assert!(Warp::Fisheye(0.6).point(w, h, Coord { x: 90.0, y: 50.0 }).x > 90.0);
    }

    #[test]
    fn straight_edges_bend() {
        let line = geo::LineString::from(vec![(10.0, 50.0), (140.0, 50.0)]);
        let Geometry::LineString(bent) =
            warps("{ wave: { amplitude: 2mm, wavelength: 20mm } }").bend(150.0, 100.0, &Geometry::LineString(line))
        else {
            unreachable!()
        };
        assert!(bent.0.len() > 600, "cut into 0.2 mm steps");
        assert!(bent.0.iter().any(|c| (c.y - 50.0).abs() > 1.0));
    }
}
