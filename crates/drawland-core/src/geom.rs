//! Geometry helpers over `geo`: unions, line clipping, buffers, and the line
//! tools `geo` does not have (merge, substring, dashes).

use geo::algorithm::buffer::{Buffer, BufferStyle, LineCap, LineJoin};
use geo::orient::{Direction, Orient};
use geo::{
    polygon, BooleanOps, BoundingRect, Coord, Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Validation,
};
use std::collections::{HashMap, HashSet};

pub type Lines = Vec<LineString<f64>>;

pub fn empty() -> MultiPolygon<f64> {
    MultiPolygon::new(vec![])
}

/// Polygon parts of any geometry (lines and points ignored).
pub fn polygons(g: &Geometry<f64>) -> Vec<Polygon<f64>> {
    match g {
        Geometry::Polygon(p) => vec![p.clone()],
        Geometry::MultiPolygon(mp) => mp.0.clone(),
        Geometry::GeometryCollection(gc) => gc.0.iter().flat_map(polygons).collect(),
        Geometry::Rect(r) => vec![r.to_polygon()],
        Geometry::Triangle(t) => vec![t.to_polygon()],
        _ => vec![],
    }
}

/// Line parts of any geometry: linestrings as they are, polygon rings as
/// closed lines.
pub fn lines_of(g: &Geometry<f64>) -> Lines {
    match g {
        Geometry::LineString(l) => vec![l.clone()],
        Geometry::MultiLineString(ml) => ml.0.clone(),
        Geometry::Line(l) => vec![LineString::from(vec![l.start, l.end])],
        Geometry::Polygon(_) | Geometry::MultiPolygon(_) | Geometry::Rect(_) | Geometry::Triangle(_) => {
            rings(&MultiPolygon::new(polygons(g)))
        }
        Geometry::GeometryCollection(gc) => gc.0.iter().flat_map(lines_of).collect(),
        _ => vec![],
    }
}

/// Repair a polygon that is not valid (self-touching or self-crossing rings)
/// by re-resolving it with the even-odd rule, as `make_valid` would.
pub fn make_valid(p: &Polygon<f64>) -> MultiPolygon<f64> {
    if p.exterior().0.len() < 4 {
        return empty();
    }
    if p.is_valid() {
        return MultiPolygon::new(vec![p.orient(Direction::Default)]);
    }
    p.union(&empty())
}

/// Union of any number of polygons.
pub fn union_all<'a>(polys: impl IntoIterator<Item = &'a Polygon<f64>>) -> MultiPolygon<f64> {
    let oriented: Vec<Polygon<f64>> = polys
        .into_iter()
        .filter(|p| p.exterior().0.len() >= 4)
        .map(|p| p.orient(Direction::Default))
        .collect();
    if oriented.is_empty() {
        return empty();
    }
    geo::unary_union(&oriented)
}

pub fn union_multi<'a>(parts: impl IntoIterator<Item = &'a MultiPolygon<f64>>) -> MultiPolygon<f64> {
    union_all(parts.into_iter().flat_map(|mp| mp.0.iter()))
}

pub fn difference(a: &MultiPolygon<f64>, b: &MultiPolygon<f64>) -> MultiPolygon<f64> {
    if a.0.is_empty() || b.0.is_empty() {
        return a.clone();
    }
    a.difference(b)
}

pub fn intersection(a: &MultiPolygon<f64>, b: &MultiPolygon<f64>) -> MultiPolygon<f64> {
    if a.0.is_empty() || b.0.is_empty() {
        return empty();
    }
    a.intersection(b)
}

/// Close the gaps, up to `reach` wide, between `of` and the edges of `frame`
/// (tile polygons that stop just short of the card border).
///
/// Only the parts of `of` within `reach` of an edge are stretched, each
/// straight out to that edge over its own span along it: water that is far
/// from an edge never reaches it, so the land between the coast and the far
/// side of the card stays land.
pub fn extend_to_frame_edges(of: &MultiPolygon<f64>, frame: &MultiPolygon<f64>, reach: f64) -> MultiPolygon<f64> {
    let Some(fb) = frame.bounding_rect() else {
        return of.clone();
    };
    if of.0.is_empty() || reach <= 0.0 {
        return of.clone();
    }
    let (x0, y0, x1, y1) = (fb.min().x, fb.min().y, fb.max().x, fb.max().y);
    let rect = |ax: f64, ay: f64, bx: f64, by: f64| -> Polygon<f64> {
        polygon![(x: ax, y: ay), (x: bx, y: ay), (x: bx, y: by), (x: ax, y: by)]
    };
    // Each edge's band, and for a piece of water in it, the cap from the edge
    // to where the water starts.
    type Cap = fn(geo::Rect<f64>, (f64, f64, f64, f64)) -> Option<[f64; 4]>;
    const EPS: f64 = 1e-6;
    let sides: [(Polygon<f64>, Cap); 4] = [
        (rect(x0, y0, x0 + reach, y1), |b, (x0, _, _, _)| (b.min().x > x0 + EPS).then(|| [x0, b.min().y, b.min().x, b.max().y])),
        (rect(x1 - reach, y0, x1, y1), |b, (_, _, x1, _)| (b.max().x < x1 - EPS).then(|| [b.max().x, b.min().y, x1, b.max().y])),
        (rect(x0, y0, x1, y0 + reach), |b, (_, y0, _, _)| (b.min().y > y0 + EPS).then(|| [b.min().x, y0, b.max().x, b.min().y])),
        (rect(x0, y1 - reach, x1, y1), |b, (_, _, _, y1)| (b.max().y < y1 - EPS).then(|| [b.min().x, b.max().y, b.max().x, y1])),
    ];
    let mut caps = Vec::new();
    for (band, cap) in sides {
        let near = intersection(of, &MultiPolygon::new(vec![band]));
        for piece in &near.0 {
            if let Some([ax, ay, bx, by]) = piece.bounding_rect().and_then(|b| cap(b, (x0, y0, x1, y1))) {
                caps.push(rect(ax, ay, bx, by));
            }
        }
    }
    if caps.is_empty() {
        return of.clone();
    }
    let capped = MultiPolygon::new(caps);
    let parts = [of, &capped];
    intersection(&union_multi(parts.iter().copied()), frame)
}

/// Exterior and interior rings as closed lines.
pub fn rings(mp: &MultiPolygon<f64>) -> Lines {
    mp.0.iter()
        .flat_map(|p| std::iter::once(p.exterior().clone()).chain(p.interiors().iter().cloned()))
        .filter(|l| l.0.len() >= 2)
        .collect()
}

pub fn exterior_rings(mp: &MultiPolygon<f64>) -> Lines {
    mp.0.iter().map(|p| p.exterior().clone()).filter(|l| l.0.len() >= 2).collect()
}

/// Every polygon without its holes, re-unioned (an island in a hole merges
/// back into the shell around it).
pub fn fill_holes(mp: &MultiPolygon<f64>) -> MultiPolygon<f64> {
    let shells: Vec<Polygon<f64>> = mp.0.iter().map(|p| Polygon::new(p.exterior().clone(), vec![])).collect();
    union_all(&shells)
}

/// Points [`clip_lines`] hands geo's clip at once. The sweep takes four to
/// ten times the lines' own memory, so a big fill in one call is GBs; each
/// batch sweeps the mask again, so batches are kept large. Counted in
/// points, since a wave or a hatch line can hold thousands.
pub const BATCH_POINTS: usize = 131_072;

/// The parts of `lines` inside `mask` (or outside, with `invert`).
pub fn clip_lines(lines: &[LineString<f64>], mask: &MultiPolygon<f64>, invert: bool) -> Lines {
    if lines.is_empty() {
        return vec![];
    }
    if mask.0.is_empty() {
        return if invert { lines.to_vec() } else { vec![] };
    }
    // Lines clip independently, so batches give the same result.
    let mut out = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let mut end = start;
        let mut points = 0;
        while end < lines.len() && (end == start || points + lines[end].0.len() <= BATCH_POINTS) {
            points += lines[end].0.len();
            end += 1;
        }
        let batch = MultiLineString::new(lines[start..end].to_vec());
        out.extend(mask.clip(&batch, invert).0.into_iter().filter(|l| l.0.len() >= 2 && line_length(l) > 0.0));
        start = end;
    }
    out
}

/// Polygon buffer with round joins; negative shrinks.
pub fn buffer(mp: &MultiPolygon<f64>, distance: f64) -> MultiPolygon<f64> {
    if mp.0.is_empty() || distance == 0.0 {
        return mp.clone();
    }
    mp.buffer(distance)
}

/// A line buffered with flat ends and round joins (roads: keeps narrow gaps open).
pub fn buffer_line_flat(line: &LineString<f64>, radius: f64) -> MultiPolygon<f64> {
    let style = BufferStyle::new(radius).line_cap(LineCap::Butt).line_join(LineJoin::Round(round_angle()));
    line.buffer_with_style(style)
}

/// A line buffered with round ends and round joins (`areas.buffer`: halos, masks).
pub fn buffer_line_round(line: &LineString<f64>, radius: f64) -> MultiPolygon<f64> {
    let style = BufferStyle::new(radius)
        .line_cap(LineCap::Round(round_angle()))
        .line_join(LineJoin::Round(round_angle()));
    line.buffer_with_style(style)
}

pub fn disk(center: Coord<f64>, radius: f64) -> MultiPolygon<f64> {
    geo::Point::from(center).buffer(radius)
}

fn round_angle() -> f64 {
    // Same as geo's default: roughly shapely's 16 segments per quarter circle.
    std::f64::consts::PI / 32.0
}

pub fn line_length(l: &LineString<f64>) -> f64 {
    l.0.windows(2).map(|w| ((w[1].x - w[0].x).powi(2) + (w[1].y - w[0].y).powi(2)).sqrt()).sum()
}

fn key(c: Coord<f64>) -> (u64, u64) {
    // +0.0 and -0.0 are the same point.
    ((c.x + 0.0).to_bits(), (c.y + 0.0).to_bits())
}

/// Join lines end to end where exactly two ends meet, like shapely's
/// `linemerge`. Direction may flip; closed loops come back closed.
pub fn linemerge(lines: &[LineString<f64>]) -> Lines {
    let edges: Vec<&[Coord<f64>]> = lines.iter().map(|l| l.0.as_slice()).filter(|c| c.len() >= 2).collect();
    let mut incident: HashMap<(u64, u64), Vec<(usize, bool)>> = HashMap::new();
    for (i, e) in edges.iter().enumerate() {
        incident.entry(key(e[0])).or_default().push((i, true));
        incident.entry(key(e[e.len() - 1])).or_default().push((i, false));
    }
    let mut used = vec![false; edges.len()];
    let mut out = Vec::new();

    let oriented = |i: usize, from_start: bool| -> Vec<Coord<f64>> {
        let mut v = edges[i].to_vec();
        if !from_start {
            v.reverse();
        }
        v
    };

    let walk = |start: usize, from_start: bool, used: &mut Vec<bool>| -> Vec<Coord<f64>> {
        used[start] = true;
        let mut path = oriented(start, from_start);
        let mut current = start;
        loop {
            let end = *path.last().unwrap();
            let inc = &incident[&key(end)];
            if inc.len() != 2 {
                break;
            }
            let Some(&(j, at_start)) = inc.iter().find(|&&(j, _)| j != current) else { break };
            if used[j] {
                break;
            }
            used[j] = true;
            let seg = oriented(j, at_start);
            path.extend_from_slice(&seg[1..]);
            current = j;
        }
        path
    };

    // Chains start at ends that are not simple pass-throughs.
    let mut starts: Vec<(usize, bool)> = Vec::new();
    for (i, e) in edges.iter().enumerate() {
        if incident[&key(e[0])].len() != 2 {
            starts.push((i, true));
        }
        if incident[&key(e[e.len() - 1])].len() != 2 {
            starts.push((i, false));
        }
    }
    for (i, from_start) in starts {
        if !used[i] {
            out.push(LineString::new(walk(i, from_start, &mut used)));
        }
    }
    // What is left are loops through degree-2 nodes only.
    for i in 0..edges.len() {
        if !used[i] {
            out.push(LineString::new(walk(i, true, &mut used)));
        }
    }
    out
}

/// Segments that appear more than once (shared walls) kept once, then
/// merged into lines.
pub fn dedupe_segments(lines: &[LineString<f64>]) -> Lines {
    let mut seen: HashSet<((u64, u64), (u64, u64))> = HashSet::new();
    let mut segs: Lines = Vec::new();
    for l in lines {
        for w in l.0.windows(2) {
            let (a, b) = (key(w[0]), key(w[1]));
            if a == b {
                continue;
            }
            let k = if a <= b { (a, b) } else { (b, a) };
            if seen.insert(k) {
                segs.push(LineString::new(vec![w[0], w[1]]));
            }
        }
    }
    linemerge(&segs)
}

/// The part of `line` between distances `start` and `end` along it.
pub fn substring(line: &LineString<f64>, start: f64, end: f64) -> Option<LineString<f64>> {
    if end <= start {
        return None;
    }
    let mut out: Vec<Coord<f64>> = Vec::new();
    let mut walked = 0.0;
    for w in line.0.windows(2) {
        let (a, b) = (w[0], w[1]);
        let len = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
        if len == 0.0 {
            continue;
        }
        let (s0, s1) = (walked, walked + len);
        walked = s1;
        if s1 < start {
            continue;
        }
        if s0 > end {
            break;
        }
        let at = |d: f64| -> Coord<f64> {
            let t = ((d - s0) / len).clamp(0.0, 1.0);
            Coord { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        };
        if out.is_empty() {
            out.push(at(start.max(s0)));
        }
        if s1 <= end {
            out.push(b);
        } else {
            out.push(at(end));
            break;
        }
    }
    out.dedup();
    (out.len() >= 2).then(|| LineString::new(out))
}

/// `line` cut into `dash`-long pieces with `gap` between them.
pub fn dash_line(line: &LineString<f64>, dash: f64, gap: f64) -> Lines {
    let length = line_length(line);
    if length <= 0.0 {
        return vec![];
    }
    if dash <= 0.0 {
        return vec![line.clone()];
    }
    let period = dash + gap.max(0.0);
    let mut out = Vec::new();
    let mut t = 0.0;
    while t < length - 1e-9 {
        let t1 = (t + dash).min(length);
        if t1 - t > 1e-6 {
            if let Some(piece) = substring(line, t, t1) {
                if line_length(&piece) > 1e-6 {
                    out.push(piece);
                }
            }
        }
        t += period;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::{line_string, polygon};

    #[test]
    fn linemerge_joins_through_degree_two() {
        let a = line_string![(x: 0.0, y: 0.0), (x: 1.0, y: 0.0)];
        let b = line_string![(x: 2.0, y: 0.0), (x: 1.0, y: 0.0)];
        let c = line_string![(x: 2.0, y: 0.0), (x: 3.0, y: 0.0)];
        let merged = linemerge(&[a, b, c]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0.len(), 4);
    }

    #[test]
    fn linemerge_closes_loops() {
        let a = line_string![(x: 0.0, y: 0.0), (x: 1.0, y: 0.0), (x: 1.0, y: 1.0)];
        let b = line_string![(x: 1.0, y: 1.0), (x: 0.0, y: 1.0), (x: 0.0, y: 0.0)];
        let merged = linemerge(&[a, b]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0.first(), merged[0].0.last());
    }

    #[test]
    fn linemerge_stops_at_junctions() {
        let a = line_string![(x: 0.0, y: 0.0), (x: 1.0, y: 0.0)];
        let b = line_string![(x: 1.0, y: 0.0), (x: 2.0, y: 0.0)];
        let c = line_string![(x: 1.0, y: 0.0), (x: 1.0, y: 1.0)];
        assert_eq!(linemerge(&[a, b, c]).len(), 3);
    }

    #[test]
    fn dashes_have_the_requested_length() {
        let l = line_string![(x: 0.0, y: 0.0), (x: 10.0, y: 0.0)];
        let d = dash_line(&l, 0.45, 0.40);
        assert_eq!(d.len(), 12);
        assert!((line_length(&d[0]) - 0.45).abs() < 1e-9);
    }

    #[test]
    fn shared_walls_are_kept_once() {
        let a = line_string![(x: 0.0, y: 0.0), (x: 1.0, y: 0.0), (x: 1.0, y: 1.0), (x: 0.0, y: 1.0), (x: 0.0, y: 0.0)];
        let b = line_string![(x: 1.0, y: 0.0), (x: 2.0, y: 0.0), (x: 2.0, y: 1.0), (x: 1.0, y: 1.0), (x: 1.0, y: 0.0)];
        let total: f64 = dedupe_segments(&[a, b]).iter().map(line_length).sum();
        assert!((total - 7.0).abs() < 1e-9);
    }

    #[test]
    fn lines_on_the_boundary_count_as_covered() {
        let sq = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 2.0, y: 0.0), (x: 2.0, y: 2.0), (x: 0.0, y: 2.0)]]);
        let edge = vec![line_string![(x: -1.0, y: 0.0), (x: 3.0, y: 0.0)]];
        let outside: f64 = clip_lines(&edge, &sq, true).iter().map(line_length).sum();
        let inside: f64 = clip_lines(&edge, &sq, false).iter().map(line_length).sum();
        assert!((outside - 2.0).abs() < 1e-9, "difference keeps {outside}");
        assert!((inside - 2.0).abs() < 1e-9, "intersection keeps {inside}");
    }

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> MultiPolygon<f64> {
        MultiPolygon::new(vec![polygon![(x: x0, y: y0), (x: x1, y: y0), (x: x1, y: y1), (x: x0, y: y1)]])
    }

    #[test]
    fn extend_to_frame_leaves_a_coast_far_from_the_other_edges_alone() {
        use geo::Area;
        // A west coast: the sea touches the west, north and south edges and
        // stops halfway across. Nothing east of the coast may turn to water.
        let frame = square(0.0, 0.0, 150.0, 100.0);
        let sea = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 60.0, y: 0.0), (x: 30.0, y: 100.0), (x: 0.0, y: 100.0)]]);
        let got = extend_to_frame_edges(&sea, &frame, 1.0);
        assert!((got.unsigned_area() - sea.unsigned_area()).abs() < 1e-6, "area {} vs {}", got.unsigned_area(), sea.unsigned_area());
        assert!(got.bounding_rect().unwrap().max().x <= 60.0 + 1e-9);
    }

    #[test]
    fn extend_to_frame_closes_a_thin_gap_at_the_edge_only() {
        use geo::Area;
        let frame = square(0.0, 0.0, 150.0, 100.0);
        // Stops 0.5 mm short of the west edge, 70 mm short of the east one.
        let sea = square(0.5, 20.0, 80.0, 60.0);
        let got = extend_to_frame_edges(&sea, &frame, 1.0);
        let b = got.bounding_rect().unwrap();
        assert!(b.min().x <= 1e-9, "reaches the west edge, got {:?}", b);
        assert!((b.max().x - 80.0).abs() < 1e-9, "east side untouched, got {:?}", b);
        assert!((b.min().y - 20.0).abs() < 1e-9 && (b.max().y - 60.0).abs() < 1e-9, "only over its own span, got {:?}", b);
        assert!((got.unsigned_area() - 80.0 * 40.0).abs() < 1e-6);
    }

    #[test]
    fn clip_and_invert() {
        let sq = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 2.0, y: 0.0), (x: 2.0, y: 2.0), (x: 0.0, y: 2.0)]]);
        let l = vec![line_string![(x: -1.0, y: 1.0), (x: 3.0, y: 1.0)]];
        let inside: f64 = clip_lines(&l, &sq, false).iter().map(line_length).sum();
        let outside: f64 = clip_lines(&l, &sq, true).iter().map(line_length).sum();
        assert!((inside - 2.0).abs() < 1e-9 && (outside - 2.0).abs() < 1e-9);
    }
}
