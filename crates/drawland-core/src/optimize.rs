//! Plotter path optimization (`compose.deoverlap`, `compose.linemerge`,
//! `compose.simplify`, `compose.filter`, `compose.reloop`, `compose.linesort`).
//!
//! Runs on composed layer strokes after occlusion masks and card-frame
//! clipping, in the exact sequence the profile script calls them.

use crate::geom::{self, Lines};
use crate::grammar::{At, Id};
use crate::progress::{thousands, Task};
use crate::units::Mm;
use geo::{Coord, LineString, Simplify};
use rayon::prelude::*;
use rstar::{PointDistance, RTree, RTreeObject, AABB};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Which stroke wins when two corridors collide in `deoverlap`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeoverlapPrefer {
    #[default]
    Longest,
    First,
    Shortest,
}

impl From<DeoverlapPrefer> for deoverlap_core::Prefer {
    fn from(p: DeoverlapPrefer) -> Self {
        match p {
            DeoverlapPrefer::Longest => deoverlap_core::Prefer::Longest,
            DeoverlapPrefer::First => deoverlap_core::Prefer::First,
            DeoverlapPrefer::Shortest => deoverlap_core::Prefer::Shortest,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeoverlapSpec {
    #[serde(default = "default_deoverlap_tol")]
    pub tolerance: Mm,
    #[serde(default)]
    pub self_overlap: bool,
    #[serde(default)]
    pub across_layers: bool,
    #[serde(default = "default_angle")]
    pub angle: f64,
    #[serde(default)]
    pub prefer: DeoverlapPrefer,
    #[serde(default)]
    pub min_length: Mm,
    #[serde(default)]
    pub drop: Option<f64>,
}

fn default_deoverlap_tol() -> Mm {
    Mm(0.1)
}

fn default_angle() -> f64 {
    30.0
}

impl Default for DeoverlapSpec {
    fn default() -> Self {
        Self {
            tolerance: default_deoverlap_tol(),
            self_overlap: false,
            across_layers: false,
            angle: default_angle(),
            prefer: DeoverlapPrefer::default(),
            min_length: Mm(0.0),
            drop: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinemergeSpec {
    #[serde(default = "default_linemerge_tol")]
    pub tolerance: Mm,
}

fn default_linemerge_tol() -> Mm {
    Mm(0.1)
}

impl Default for LinemergeSpec {
    fn default() -> Self {
        Self { tolerance: default_linemerge_tol() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SimplifySpec {
    #[serde(default = "default_simplify_tol")]
    pub tolerance: Mm,
}

fn default_simplify_tol() -> Mm {
    Mm(0.05)
}

impl Default for SimplifySpec {
    fn default() -> Self {
        Self { tolerance: default_simplify_tol() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FilterSpec {
    #[serde(default = "default_filter_min")]
    pub min_length: Mm,
}

fn default_filter_min() -> Mm {
    Mm(0.05)
}

impl Default for FilterSpec {
    fn default() -> Self {
        Self { min_length: default_filter_min() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinesortSpec {
    #[serde(default = "default_true")]
    pub two_opt: bool,
    #[serde(default = "default_passes")]
    pub passes: usize,
    #[serde(default)]
    pub follow: bool,
}

fn default_true() -> bool {
    true
}

fn default_passes() -> usize {
    250
}

impl Default for LinesortSpec {
    fn default() -> Self {
        Self {
            two_opt: true,
            passes: default_passes(),
            follow: false,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloopSpec {}

/// One optimization operation in `compose.optimize`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OptimizeOp {
    Deoverlap(DeoverlapSpec),
    Linemerge(LinemergeSpec),
    Simplify(SimplifySpec),
    Filter(FilterSpec),
    Reloop(ReloopSpec),
    Linesort(LinesortSpec),
}

impl OptimizeOp {
    pub fn name(&self) -> &'static str {
        self.label()
    }

    pub fn label(&self) -> &'static str {
        match self {
            OptimizeOp::Deoverlap(_) => "deoverlap",
            OptimizeOp::Linemerge(_) => "linemerge",
            OptimizeOp::Simplify(_) => "simplify",
            OptimizeOp::Filter(_) => "filter",
            OptimizeOp::Reloop(_) => "reloop",
            OptimizeOp::Linesort(_) => "linesort",
        }
    }
}

/// A step in `compose.optimize`: which layers it targets (empty `layers` =
/// every drawn layer in compose order), which layers it skips (`except`),
/// and the operation to run.
#[derive(Debug, Clone, PartialEq)]
pub struct OptimizeStep {
    pub layers: Vec<Id>,
    pub except: Vec<Id>,
    pub op: OptimizeOp,
    pub at: Option<At>,
}

impl OptimizeStep {
    /// Resolve target layer ids in order, given the composed layer order.
    pub fn target_layers(&self, order: &[String]) -> Vec<String> {
        let skip: BTreeSet<&str> = self.except.iter().map(|i| i.0.as_str()).collect();
        if self.layers.is_empty() {
            order.iter().filter(|id| !skip.contains(id.as_str())).cloned().collect()
        } else {
            self.layers
                .iter()
                .map(|i| i.0.clone())
                .filter(|id| !skip.contains(id.as_str()))
                .collect()
        }
    }
}

/// Run the full `compose.optimize` sequence on `groups` (`(layer_id, lines)`),
/// reporting each step with timing and stroke/travel metrics under `parent`.
pub fn run_pipeline(
    steps: &[OptimizeStep],
    order: &[String],
    groups: &mut [(String, Lines)],
    parent: &Task,
) {
    if steps.is_empty() {
        return;
    }
    let opt_task = parent.child("optimize", "optimize", 0, "");
    for (step_idx, step) in steps.iter().enumerate() {
        let targets = step.target_layers(order);
        let id_set: BTreeSet<&str> = targets.iter().map(String::as_str).collect();
        let indices: Vec<usize> = if step.layers.is_empty() {
            groups
                .iter()
                .enumerate()
                .filter(|(_, (id, lines))| id_set.contains(id.as_str()) && !lines.is_empty())
                .map(|(i, _)| i)
                .collect()
        } else {
            // Preserve the explicit layer priority order written in `step.layers`
            // (important for `across_layers` deoverlap).
            targets
                .iter()
                .filter_map(|t| groups.iter().position(|(id, lines)| id == t && !lines.is_empty()))
                .collect()
        };

        let task_id = format!("optimize:{step_idx}:{}", step.op.label());
        let step_task = opt_task.child(&task_id, step.op.label(), indices.len() as u64, "layers");
        if indices.is_empty() {
            step_task.ok("0 layers");
            continue;
        }

        let before_strokes: usize = indices.iter().map(|&i| groups[i].1.len()).sum();
        let before_verts: usize = indices
            .iter()
            .map(|&i| groups[i].1.iter().map(|l| l.0.len()).sum::<usize>())
            .sum();
        let before_travel: f64 = if matches!(step.op, OptimizeOp::Linesort(_)) {
            indices.iter().map(|&i| travel_distance(&groups[i].1)).sum()
        } else {
            0.0
        };

        match &step.op {
            OptimizeOp::Deoverlap(spec) if spec.across_layers => {
                let mut mask = deoverlap_core::Mask::default();
                for &idx in &indices {
                    let ( new_lines, next_mask) = deoverlap_lines(&groups[idx].1, spec, mask);
                    groups[idx].1 = new_lines;
                    mask = next_mask;
                    step_task.tick();
                }
            }
            OptimizeOp::Deoverlap(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let (out, _) = deoverlap_lines(&groups[idx].1, spec, deoverlap_core::Mask::default());
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Linemerge(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = linemerge_tolerance(&groups[idx].1, spec.tolerance.0);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Simplify(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = simplify_lines(&groups[idx].1, spec.tolerance.0);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Filter(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = filter_lines(&groups[idx].1, spec.min_length.0);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Reloop(_) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = reloop_lines(&groups[idx].1);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Linesort(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = linesort_lines(&groups[idx].1, spec);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
        }

        let after_strokes: usize = indices.iter().map(|&i| groups[i].1.len()).sum();
        let after_verts: usize = indices
            .iter()
            .map(|&i| groups[i].1.iter().map(|l| l.0.len()).sum::<usize>())
            .sum();

        let note = match &step.op {
            OptimizeOp::Simplify(_) => {
                format!("{} → {} pts", thousands(before_verts as u64), thousands(after_verts as u64))
            }
            OptimizeOp::Linesort(_) => {
                let after_travel: f64 = indices.iter().map(|&i| travel_distance(&groups[i].1)).sum();
                format!("travel {:.1}m → {:.1}m", before_travel / 1000.0, after_travel / 1000.0)
            }
            OptimizeOp::Reloop(_) => format!("{} strokes", thousands(after_strokes as u64)),
            _ => format!(
                "{} → {} strokes",
                thousands(before_strokes as u64),
                thousands(after_strokes as u64)
            ),
        };
        step_task.ok(&note);
    }
    opt_task.ok("");
}

// ---------------------------------------------------------------------------
// 1. Deoverlap (via deoverlap-core)
// ---------------------------------------------------------------------------

pub fn deoverlap_lines(
    lines: &[LineString<f64>],
    spec: &DeoverlapSpec,
    mask: deoverlap_core::Mask,
) -> (Lines, deoverlap_core::Mask) {
    if lines.is_empty() || spec.tolerance.0 <= 0.0 {
        return (lines.to_vec(), mask);
    }
    let geoms: Vec<deoverlap_core::Geometry> = lines
        .iter()
        .filter(|l| l.0.len() >= 2)
        .map(|l| {
            vec![deoverlap_core::Part::Line(
                l.0.iter().map(|c| [c.x, c.y]).collect(),
            )]
        })
        .collect();

    let opts = deoverlap_core::Options {
        tolerance: spec.tolerance.0,
        prefer: spec.prefer.into(),
        angle: spec.angle,
        self_overlap: spec.self_overlap,
        min_length: spec.min_length.0,
        drop: spec.drop,
        keep_duplicates: false,
        mask,
    };

    let res = deoverlap_core::deoverlap(&geoms, &opts);
    // Emit kept strokes in original input order (kept_parts is aligned with input).
    let mut out = Vec::new();
    for geom_opt in res.kept_parts {
        let Some(geom) = geom_opt else { continue };
        for part in geom {
            if let deoverlap_core::Part::Line(coords) = part {
                if coords.len() >= 2 {
                    out.push(LineString::new(
                        coords.into_iter().map(|[x, y]| Coord { x, y }).collect(),
                    ));
                }
            }
        }
    }
    (out, res.mask)
}

// ---------------------------------------------------------------------------
// 2. Linemerge (with distance tolerance)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
struct EndpointEntry {
    pt: [f64; 2],
    line_idx: usize,
    at_start: bool,
}

impl RTreeObject for EndpointEntry {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        AABB::from_point(self.pt)
    }
}

impl PointDistance for EndpointEntry {
    fn distance_2(&self, point: &[f64; 2]) -> f64 {
        let dx = self.pt[0] - point[0];
        let dy = self.pt[1] - point[1];
        dx * dx + dy * dy
    }
}

pub fn linemerge_tolerance(lines: &[LineString<f64>], tolerance: f64) -> Lines {
    if tolerance <= 0.0 {
        return geom::linemerge(lines);
    }
    let valid: Vec<&LineString<f64>> = lines.iter().filter(|l| l.0.len() >= 2).collect();
    if valid.len() < 2 {
        return valid.into_iter().cloned().collect();
    }

    let tol_sq = tolerance * tolerance;
    let mut entries = Vec::with_capacity(valid.len() * 2);
    for (i, l) in valid.iter().enumerate() {
        let first = l.0[0];
        let last = *l.0.last().unwrap();
        entries.push(EndpointEntry { pt: [first.x, first.y], line_idx: i, at_start: true });
        entries.push(EndpointEntry { pt: [last.x, last.y], line_idx: i, at_start: false });
    }
    let tree = RTree::bulk_load(entries);
    let mut used = vec![false; valid.len()];
    let mut out = Vec::new();

    for start in 0..valid.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let mut chain: Vec<Coord<f64>> = valid[start].0.clone();

        for forward in [true, false] {
            loop {
                let tip = if forward { *chain.last().unwrap() } else { chain[0] };
                let query = [tip.x, tip.y];
                let mut best: Option<(usize, bool, f64)> = None;
                for cand in tree.locate_within_distance(query, tol_sq) {
                    if used[cand.line_idx] {
                        continue;
                    }
                    let d2 = cand.distance_2(&query);
                    if best.is_none_or(|(_, _, b_d2)| d2 < b_d2) {
                        best = Some((cand.line_idx, cand.at_start, d2));
                    }
                }
                let Some((next_idx, at_start, d2)) = best else {
                    break;
                };
                used[next_idx] = true;
                let mut piece = valid[next_idx].0.clone();
                if forward {
                    if !at_start {
                        piece.reverse();
                    }
                    let skip = usize::from(d2 <= 1e-12);
                    chain.extend(piece.into_iter().skip(skip));
                } else {
                    if at_start {
                        piece.reverse();
                    }
                    if d2 <= 1e-12 {
                        piece.pop();
                    }
                    piece.extend(chain);
                    chain = piece;
                }
            }
        }

        if chain.len() >= 4 {
            let first = chain[0];
            let last = *chain.last().unwrap();
            let d2 = (first.x - last.x).powi(2) + (first.y - last.y).powi(2);
            if d2 > 0.0 && d2 <= tol_sq {
                *chain.last_mut().unwrap() = first;
            }
        }
        out.push(LineString::new(chain));
    }
    out
}

// ---------------------------------------------------------------------------
// 3. Simplify (Ramer-Douglas-Peucker)
// ---------------------------------------------------------------------------

pub fn simplify_lines(lines: &[LineString<f64>], tolerance: f64) -> Lines {
    if tolerance <= 0.0 {
        return lines.to_vec();
    }
    lines
        .iter()
        .filter_map(|l| {
            if l.0.len() <= 2 {
                return (l.0.len() >= 2).then(|| l.clone());
            }
            let s = l.simplify(tolerance);
            (s.0.len() >= 2).then_some(s)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 4. Filter (drop short stubs)
// ---------------------------------------------------------------------------

pub fn filter_lines(lines: &[LineString<f64>], min_length: f64) -> Lines {
    if min_length <= 0.0 {
        return lines.to_vec();
    }
    lines
        .iter()
        .filter(|l| geom::line_length(l) >= min_length)
        .cloned()
        .collect()
}

// ---------------------------------------------------------------------------
// 5. Reloop (move seam of closed rings deterministically)
// ---------------------------------------------------------------------------

pub fn reloop_lines(lines: &[LineString<f64>]) -> Lines {
    lines
        .iter()
        .enumerate()
        .map(|(idx, l)| {
            let n = l.0.len();
            if n < 4 {
                return l.clone();
            }
            let first = l.0[0];
            let last = l.0[n - 1];
            let closed = (first.x - last.x).powi(2) + (first.y - last.y).powi(2) <= 1e-8;
            if !closed {
                return l.clone();
            }
            let distinct = n - 1;
            // Deterministic hash from loop index and first vertex so identical
            // scripts produce bit-identical SVGs.
            let mut h = (idx as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
            h ^= first.x.to_bits().wrapping_mul(0xBF58_476D_1CE4_E5B9);
            h ^= first.y.to_bits().wrapping_mul(0x94D0_49BB_1331_11EB);
            h = (h ^ (h >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            let shift = (h as usize) % distinct;
            if shift == 0 {
                return l.clone();
            }
            let mut ring = Vec::with_capacity(n);
            ring.extend_from_slice(&l.0[shift..distinct]);
            ring.extend_from_slice(&l.0[..shift]);
            ring.push(ring[0]);
            LineString::new(ring)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 6. Linesort (nearest-neighbor + 2-opt)
// ---------------------------------------------------------------------------

pub fn travel_distance(lines: &[LineString<f64>]) -> f64 {
    lines
        .windows(2)
        .map(|w| {
            let a = *w[0].0.last().unwrap_or(&Coord { x: 0.0, y: 0.0 });
            let b = *w[1].0.first().unwrap_or(&Coord { x: 0.0, y: 0.0 });
            ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt()
        })
        .sum()
}

pub fn linesort_lines(lines: &[LineString<f64>], spec: &LinesortSpec) -> Lines {
    let valid: Vec<LineString<f64>> = lines.iter().filter(|l| l.0.len() >= 2).cloned().collect();
    if valid.len() < 2 {
        return valid;
    }

    let allow_flip = !spec.follow;
    let mut entries = Vec::with_capacity(valid.len() * if allow_flip { 2 } else { 1 });
    for (i, l) in valid.iter().enumerate().skip(1) {
        let first = l.0[0];
        entries.push(EndpointEntry { pt: [first.x, first.y], line_idx: i, at_start: true });
        if allow_flip {
            let last = *l.0.last().unwrap();
            if (first.x - last.x).powi(2) + (first.y - last.y).powi(2) > 1e-12 {
                entries.push(EndpointEntry { pt: [last.x, last.y], line_idx: i, at_start: false });
            }
        }
    }

    let mut tree = RTree::bulk_load(entries);
    let mut tour: Vec<(usize, bool)> = Vec::with_capacity(valid.len());
    tour.push((0, false));
    let mut cur = *valid[0].0.last().unwrap();

    while tour.len() < valid.len() {
        let Some(&nearest) = tree.nearest_neighbor(&[cur.x, cur.y]) else {
            break;
        };
        let idx = nearest.line_idx;
        let reversed = !nearest.at_start;
        // Remove both endpoints of `idx` from the R-tree.
        let first = valid[idx].0[0];
        let last = *valid[idx].0.last().unwrap();
        tree.remove(&EndpointEntry { pt: [first.x, first.y], line_idx: idx, at_start: true });
        if allow_flip {
            tree.remove(&EndpointEntry { pt: [last.x, last.y], line_idx: idx, at_start: false });
        }
        cur = if reversed { first } else { last };
        tour.push((idx, reversed));
    }

    let mut sorted: Lines = tour
        .into_iter()
        .map(|(i, rev)| {
            let mut l = valid[i].clone();
            if rev {
                l.0.reverse();
            }
            l
        })
        .collect();

    if spec.two_opt && allow_flip && sorted.len() >= 4 && spec.passes > 0 {
        two_opt_improve(&mut sorted, spec.passes);
    }

    sorted
}

fn dist(a: Coord<f64>, b: Coord<f64>) -> f64 {
    ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt()
}

fn two_opt_improve(lines: &mut [LineString<f64>], max_passes: usize) {
    let n = lines.len();
    // Cap neighborhood window on huge layers so 2-opt stays interactive in WASM.
    let window = (250_000 / n).clamp(32, 512).min(n);
    let mut ends: Vec<(Coord<f64>, Coord<f64>)> = lines
        .iter()
        .map(|l| (l.0[0], *l.0.last().unwrap()))
        .collect();

    for _ in 0..max_passes {
        let mut improved = false;
        for i in 1..n - 1 {
            let prev_end = ends[i - 1].1;
            let i_start = ends[i].0;
            let d_prev_i = dist(prev_end, i_start);
            let j_limit = (i + window).min(n - 1);
            for j in i + 1..=j_limit {
                let j_end = ends[j].1;
                let (old_cost, new_cost) = if j + 1 < n {
                    let next_start = ends[j + 1].0;
                    (
                        d_prev_i + dist(j_end, next_start),
                        dist(prev_end, j_end) + dist(i_start, next_start),
                    )
                } else {
                    (d_prev_i, dist(prev_end, j_end))
                };
                if new_cost + 1e-6 < old_cost {
                    lines[i..=j].reverse();
                    for l in &mut lines[i..=j] {
                        l.0.reverse();
                    }
                    ends[i..=j].reverse();
                    for e in &mut ends[i..=j] {
                        *e = (e.1, e.0);
                    }
                    improved = true;
                    break;
                }
            }
        }
        if !improved {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::line_string;

    #[test]
    fn deoverlap_removes_duplicate_and_parallel_corridors() {
        let a = line_string![(x: 0.0, y: 0.0), (x: 10.0, y: 0.0)];
        let b = line_string![(x: 0.0, y: 0.05), (x: 10.0, y: 0.05)];
        let spec = DeoverlapSpec { tolerance: Mm(0.1), ..Default::default() };
        let (kept, _) = deoverlap_lines(&[a, b], &spec, Default::default());
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn linemerge_bridges_gaps_within_tolerance() {
        let a = line_string![(x: 0.0, y: 0.0), (x: 5.0, y: 0.0)];
        let b = line_string![(x: 5.08, y: 0.0), (x: 10.0, y: 0.0)];
        let merged = linemerge_tolerance(&[a, b], 0.1);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0.first().unwrap().x, 0.0);
        assert_eq!(merged[0].0.last().unwrap().x, 10.0);
    }

    #[test]
    fn filter_and_reloop_and_linesort() {
        let short = line_string![(x: 0.0, y: 0.0), (x: 0.02, y: 0.0)];
        let ring = line_string![
            (x: 0.0, y: 0.0),
            (x: 10.0, y: 0.0),
            (x: 10.0, y: 10.0),
            (x: 0.0, y: 10.0),
            (x: 0.0, y: 0.0)
        ];
        let filtered = filter_lines(&[short, ring], 0.05);
        assert_eq!(filtered.len(), 1);
        let relooped = reloop_lines(&filtered);
        assert_eq!(relooped.len(), 1);
        assert_eq!(relooped[0].0.first(), relooped[0].0.last());

        let l1 = line_string![(x: 0.0, y: 0.0), (x: 1.0, y: 0.0)];
        let l2 = line_string![(x: 100.0, y: 0.0), (x: 101.0, y: 0.0)];
        let l3 = line_string![(x: 2.0, y: 0.0), (x: 1.1, y: 0.0)];
        let before = travel_distance(&[l1.clone(), l2.clone(), l3.clone()]);
        let sorted = linesort_lines(&[l1, l2, l3], &LinesortSpec::default());
        let after = travel_distance(&sorted);
        assert!(after < before, "travel reduced: {before} -> {after}");
    }
}
