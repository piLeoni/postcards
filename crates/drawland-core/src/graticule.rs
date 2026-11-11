//! An atlas plate's graticule: meridians and parallels across a rectangle of
//! the page, the black-and-white keys of its border (one per so many minutes
//! of arc), and where the degree labels go round it. Everything is found
//! through the output's own projection, so it stays true wherever the plate
//! is moved, at any bearing.

use crate::projection::Projector;
use geo::{Coord, LineString, MultiPolygon, Polygon};

/// The page rectangle the graticule is drawn for, in output mm.
#[derive(Debug, Clone, Copy)]
pub struct Plate {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    /// A line of longitude.
    Meridian,
    /// A line of latitude.
    Parallel,
}

/// One meridian or parallel, at `minutes` of arc (east and north positive).
#[derive(Debug, Clone)]
pub struct GridLine {
    pub family: Family,
    pub minutes: f64,
    pub path: LineString<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Top,
    Bottom,
    Left,
    Right,
}

impl Side {
    pub const ALL: [Side; 4] = [Side::Top, Side::Bottom, Side::Left, Side::Right];

    /// The family whose labels and keys sit on this side.
    pub fn family(self) -> Family {
        match self {
            Side::Top | Side::Bottom => Family::Meridian,
            Side::Left | Side::Right => Family::Parallel,
        }
    }

    /// Unit vector out of the plate.
    pub fn outward(self) -> (f64, f64) {
        match self {
            Side::Top => (0.0, -1.0),
            Side::Bottom => (0.0, 1.0),
            Side::Left => (-1.0, 0.0),
            Side::Right => (1.0, 0.0),
        }
    }
}

impl Plate {
    /// The side's start and end, left to right or top to bottom.
    pub fn edge(&self, side: Side) -> (Coord<f64>, Coord<f64>) {
        let c = |x, y| Coord { x, y };
        match side {
            Side::Top => (c(self.x0, self.y0), c(self.x1, self.y0)),
            Side::Bottom => (c(self.x0, self.y1), c(self.x1, self.y1)),
            Side::Left => (c(self.x0, self.y0), c(self.x0, self.y1)),
            Side::Right => (c(self.x1, self.y0), c(self.x1, self.y1)),
        }
    }

    /// The ground under the plate, as `(lon0, lon1, lat0, lat1)` degrees.
    fn extent(&self, p: &Projector) -> Option<(f64, f64, f64, f64)> {
        let mut lons = Vec::new();
        let mut lats = Vec::new();
        const N: usize = 24;
        for side in Side::ALL {
            let (a, b) = self.edge(side);
            for i in 0..=N {
                let t = i as f64 / N as f64;
                if let Some((lon, lat)) = p.locate(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) {
                    lons.push(lon);
                    lats.push(lat);
                }
            }
        }
        let min = |v: &[f64]| v.iter().copied().fold(f64::INFINITY, f64::min);
        let max = |v: &[f64]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        (!lons.is_empty()).then(|| (min(&lons), max(&lons), min(&lats).max(-85.0), max(&lats).min(85.0)))
    }
}

/// Every meridian and parallel `step` minutes apart that crosses the plate,
/// projected, and running a little past it on every side (cut it to the
/// plate to draw it).
pub fn lines(p: &Projector, plate: &Plate, step: f64) -> Vec<GridLine> {
    let Some((lon0, lon1, lat0, lat1)) = plate.extent(p) else { return vec![] };
    if !(step > 0.0) {
        return vec![];
    }
    // A step's worth of margin, so a line ends past the plate's corners.
    let pad = step / 60.0;
    let (lon0, lon1, lat0, lat1) = (lon0 - pad, lon1 + pad, (lat0 - pad).max(-85.0), (lat1 + pad).min(85.0));
    // Too many to be a graticule: a step far too small for the plate.
    if ((lon1 - lon0) + (lat1 - lat0)) * 60.0 / step > 2000.0 {
        return vec![];
    }
    const N: usize = 96;
    let mut out = Vec::new();
    let mut each = |family: Family, from: f64, to: f64, along: (f64, f64)| {
        let (k0, k1) = ((from * 60.0 / step).ceil() as i64, (to * 60.0 / step).floor() as i64);
        for k in k0..=k1 {
            let minutes = k as f64 * step;
            let v = minutes / 60.0;
            let path: LineString<f64> = (0..=N)
                .map(|i| {
                    let u = along.0 + (along.1 - along.0) * i as f64 / N as f64;
                    let (x, y) = match family {
                        Family::Meridian => p.project(v, u),
                        Family::Parallel => p.project(u, v),
                    };
                    Coord { x, y }
                })
                .filter(|c| c.x.is_finite() && c.y.is_finite())
                .collect();
            if path.0.len() >= 2 {
                out.push(GridLine { family, minutes, path });
            }
        }
    };
    each(Family::Meridian, lon0, lon1, (lat0, lat1));
    each(Family::Parallel, lat0, lat1, (lon0, lon1));
    out
}

/// Where a line crosses one side of the plate: `t` mm along the side from
/// its start.
#[derive(Debug, Clone)]
pub struct Crossing {
    pub t: f64,
    pub at: Coord<f64>,
    pub minutes: f64,
}

/// The lines of the side's own family that cross it, in order along it.
pub fn crossings(lines: &[GridLine], plate: &Plate, side: Side) -> Vec<Crossing> {
    let (a, b) = plate.edge(side);
    let len = (b.x - a.x).hypot(b.y - a.y);
    let mut out: Vec<Crossing> = lines
        .iter()
        .filter(|l| l.family == side.family())
        .filter_map(|l| {
            l.path.0.windows(2).find_map(|w| {
                let t = segment_hit(a, b, w[0], w[1])?;
                Some(Crossing { t: t * len, at: Coord { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, minutes: l.minutes })
            })
        })
        .collect();
    out.sort_by(|p, q| p.t.total_cmp(&q.t));
    out
}

/// Where segment `p0 p1` crosses `a b`, as a fraction along `a b`.
fn segment_hit(a: Coord<f64>, b: Coord<f64>, p0: Coord<f64>, p1: Coord<f64>) -> Option<f64> {
    let (rx, ry) = (b.x - a.x, b.y - a.y);
    let (sx, sy) = (p1.x - p0.x, p1.y - p0.y);
    let den = rx * sy - ry * sx;
    if den.abs() < 1e-12 {
        return None;
    }
    let (qx, qy) = (p0.x - a.x, p0.y - a.y);
    let t = (qx * sy - qy * sx) / den;
    let u = (qx * ry - qy * rx) / den;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u)).then_some(t)
}

/// The border's keys: a band `band` mm wide just outside the plate, cut at
/// every `ticks`-minute line of each side's family, every other piece inked.
/// Which pieces are inked follows the minutes (the even ones), so the keys
/// line up on opposite sides and stay put as the plate moves.
pub fn keys(p: &Projector, plate: &Plate, ticks: f64, band: f64) -> MultiPolygon<f64> {
    if !(ticks > 0.0 && band > 0.0) {
        return MultiPolygon::new(vec![]);
    }
    let grid = lines(p, plate, ticks);
    let mut out = Vec::new();
    for side in Side::ALL {
        let (a, b) = plate.edge(side);
        let len = (b.x - a.x).hypot(b.y - a.y);
        let (dx, dy) = ((b.x - a.x) / len, (b.y - a.y) / len);
        let (ox, oy) = side.outward();
        let cuts: Vec<f64> = std::iter::once(0.0)
            .chain(crossings(&grid, plate, side).into_iter().map(|c| c.t))
            .chain(std::iter::once(len))
            .collect();
        for w in cuts.windows(2) {
            let (t0, t1) = (w[0], w[1]);
            if t1 - t0 < 1e-6 {
                continue;
            }
            let mid = (t0 + t1) / 2.0;
            let Some((lon, lat)) = p.locate(a.x + dx * mid, a.y + dy * mid) else { continue };
            let v = match side.family() {
                Family::Meridian => lon,
                Family::Parallel => lat,
            };
            if ((v * 60.0 / ticks).floor() as i64).rem_euclid(2) != 0 {
                continue;
            }
            let at = |t: f64, out: f64| Coord { x: a.x + dx * t + ox * out, y: a.y + dy * t + oy * out };
            out.push(Polygon::new(LineString::new(vec![at(t0, 0.0), at(t1, 0.0), at(t1, band), at(t0, band), at(t0, 0.0)]), vec![]));
        }
    }
    MultiPolygon::new(out)
}

/// A degree label: `71°W`, `41°30′N`; the equator and the prime meridian bare.
pub fn label(family: Family, minutes: f64) -> String {
    let m = minutes.round() as i64;
    let (deg, min) = (m.abs() / 60, m.abs() % 60);
    let hemi = match (family, m.signum()) {
        (_, 0) => "",
        (Family::Meridian, 1) => "E",
        (Family::Meridian, _) => "W",
        (Family::Parallel, 1) => "N",
        (Family::Parallel, _) => "S",
    };
    if min == 0 { format!("{deg}°{hemi}") } else { format!("{deg}°{min:02}′{hemi}") }
}

/// A label to set round the plate: its text, centre, and turn (degrees).
#[derive(Debug, Clone)]
pub struct Mark {
    pub text: String,
    pub at: Coord<f64>,
    pub rotate: f64,
}

/// The degree labels of every `step`-minute line, outside the border: `off`
/// mm out from the plate's edge to the near side of the letters, which are
/// `size` mm tall. Top and bottom labels read level; the sides' run along
/// the edge, reading up on the left and down on the right. Labels too near
/// a corner (where two sides' would meet) are left out.
pub fn marks(p: &Projector, plate: &Plate, step: f64, off: f64, size: f64) -> Vec<Mark> {
    let grid = lines(p, plate, step);
    let corner = off + size * 1.5;
    let mut out = Vec::new();
    for side in Side::ALL {
        let (a, b) = plate.edge(side);
        let len = (b.x - a.x).hypot(b.y - a.y);
        let (ox, oy) = side.outward();
        let rotate = match side {
            Side::Top | Side::Bottom => 0.0,
            Side::Left => -90.0,
            Side::Right => 90.0,
        };
        for c in crossings(&grid, plate, side) {
            if c.t < corner || c.t > len - corner {
                continue;
            }
            let d = off + size / 2.0;
            out.push(Mark { text: label(side.family(), c.minutes), at: Coord { x: c.at.x + ox * d, y: c.at.y + oy * d }, rotate });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::Output;
    use crate::profile::ProjectionMode;

    fn plate_on(lat: f64, lng: f64, bearing: f64) -> (Projector, Plate) {
        let o = Output {
            center: (lng, lat),
            width_mm: 297.0,
            height_mm: 210.0,
            scale: 1_000_000.0,
            bearing,
            projection: ProjectionMode::Webmercator,
            tile_zoom: None,
        };
        (Projector::new(&o), Plate { x0: 20.0, y0: 20.0, x1: 277.0, y1: 190.0 })
    }

    #[test]
    fn labels_read_like_an_atlas() {
        assert_eq!(label(Family::Meridian, -71.0 * 60.0), "71°W");
        assert_eq!(label(Family::Meridian, -(70.0 * 60.0 + 30.0)), "70°30′W");
        assert_eq!(label(Family::Parallel, 41.0 * 60.0 + 30.0), "41°30′N");
        assert_eq!(label(Family::Parallel, -5.0), "0°05′S");
        assert_eq!(label(Family::Meridian, 0.0), "0°");
    }

    #[test]
    fn locate_undoes_project() {
        let (p, _) = plate_on(41.8, -70.3, 25.0);
        let (x, y) = p.project(-70.1, 41.95);
        let (lon, lat) = p.locate(x, y).unwrap();
        assert!((lon + 70.1).abs() < 1e-7 && (lat - 41.95).abs() < 1e-7, "{lon} {lat}");
    }

    #[test]
    fn cape_cod_at_one_to_a_million() {
        let (p, plate) = plate_on(41.8, -70.3, 0.0);
        // 257 mm across at 1:1M is 257 km, about 3.1° of longitude here:
        // six or seven half-degree meridians.
        let grid = lines(&p, &plate, 30.0);
        let top = crossings(&grid, &plate, Side::Top);
        assert!((6..=7).contains(&top.len()), "{}", top.len());
        // North up: a meridian crosses the top and the bottom at the same x.
        let bottom = crossings(&grid, &plate, Side::Bottom);
        assert!((top[0].at.x - bottom[0].at.x).abs() < 1e-6);
        // Keys: the band holds pieces on all four sides.
        let k = keys(&p, &plate, 10.0, 1.5);
        assert!(k.0.len() > 20, "{}", k.0.len());
        let m = marks(&p, &plate, 30.0, 3.0, 2.0);
        assert!(m.iter().any(|m| m.text == "70°30′W"));
        assert!(m.iter().any(|m| m.text.ends_with('N') && m.rotate == -90.0));
    }
}
