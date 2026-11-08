//! Plotter path optimization (`compose.deoverlap`, `compose.linemerge`,
//! `compose.simplify`, `compose.filter`, `compose.reloop`, `compose.linesort`)
//! and the hand-drawn look (`compose.hand`, via `penfill::hand`).
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

/// Preferred drawing direction: either a compass preset (`"lr"`, `"tb"`,
/// `"tl-br"`, `"se"`, …) or an explicit angle in degrees (`0` = East/right,
/// `45` = South-East / top-left to bottom-right, `90` = South/down).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DirectionAngle(pub f64);

impl DirectionAngle {
    pub fn parse_str(s: &str) -> Result<Self, String> {
        let deg = match s.trim().to_ascii_lowercase().as_str() {
            "lr" | "left-to-right" | "e" | "east" => 0.0,
            "tl-br" | "nw-se" | "se" | "southeast" => 45.0,
            "tb" | "top-to-bottom" | "s" | "south" => 90.0,
            "tr-bl" | "ne-sw" | "sw" | "southwest" => 135.0,
            "rl" | "right-to-left" | "w" | "west" => 180.0,
            "br-tl" | "se-nw" | "nw" | "northwest" => 225.0,
            "bt" | "bottom-to-top" | "n" | "north" => 270.0,
            "bl-tr" | "sw-ne" | "ne" | "northeast" => 315.0,
            other => {
                return Err(format!(
                    "unknown direction {other:?} (expected a degree angle or \"lr\", \"rl\", \"tb\", \"bt\", \"tl-br\", \"tr-bl\", \"bl-tr\", \"br-tl\", \"e\", \"se\", \"s\", \"sw\", \"w\", \"nw\", \"n\", \"ne\")"
                ))
            }
        };
        Ok(DirectionAngle(deg))
    }

    pub fn unit_vector(self) -> (f64, f64) {
        let rad = self.0.to_radians();
        (rad.cos(), rad.sin())
    }
}

impl Serialize for DirectionAngle {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_f64(self.0)
    }
}

impl<'de> Deserialize<'de> for DirectionAngle {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Num(f64),
            Str(String),
        }
        match Raw::deserialize(deserializer)? {
            Raw::Num(deg) if deg.is_finite() => Ok(DirectionAngle(deg)),
            Raw::Num(deg) => Err(serde::de::Error::custom(format!("direction angle must be finite, got {deg}"))),
            Raw::Str(s) => DirectionAngle::parse_str(&s).map_err(serde::de::Error::custom),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrientSpec {
    #[serde(default = "default_orient_direction", alias = "angle")]
    pub direction: DirectionAngle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<Mm>,
    #[serde(default)]
    pub split_reversals: bool,
}

fn default_orient_direction() -> DirectionAngle {
    DirectionAngle(0.0)
}

impl Default for OrientSpec {
    fn default() -> Self {
        Self {
            direction: default_orient_direction(),
            max_length: None,
            split_reversals: false,
        }
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
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "angle")]
    pub direction: Option<DirectionAngle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<Mm>,
    #[serde(default)]
    pub split_reversals: bool,
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
            direction: None,
            max_length: None,
            split_reversals: false,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloopSpec {}

/// Starting point for `compose.hand`; individual keys override it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HandPreset {
    /// Steady hand: tremble, bowed edges, loose ends.
    #[default]
    Steady,
    /// Loose sketch: crossing corners and long lines in several strokes.
    Sketch,
}

/// `compose.hand`: redraw strokes as if by hand (see `penfill::HandParams`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandSpec {
    #[serde(default)]
    pub preset: HandPreset,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wobble: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wavelength: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tremor: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bow: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overshoot: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reach: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corners: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retrace: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retrace_offset: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
}

impl HandSpec {
    pub fn params(&self) -> penfill::HandParams {
        let mut p = match self.preset {
            HandPreset::Steady => penfill::HandParams::default(),
            HandPreset::Sketch => penfill::HandParams::sketch(),
        };
        let set = |dst: &mut f64, v: Option<Mm>| {
            if let Some(Mm(x)) = v {
                *dst = x;
            }
        };
        set(&mut p.wobble, self.wobble);
        set(&mut p.wavelength, self.wavelength);
        set(&mut p.tremor, self.tremor);
        set(&mut p.overshoot, self.overshoot);
        set(&mut p.close, self.close);
        set(&mut p.reach, self.reach);
        set(&mut p.corners, self.corners);
        set(&mut p.retrace_offset, self.retrace_offset);
        if let Some(r) = self.retrace {
            p.retrace = r;
        }
        if let Some(b) = self.bow {
            p.bow = b;
        }
        if let Some(s) = self.seed {
            p.seed = s;
        }
        p
    }
}

/// Redraw `lines` by hand. The tremble field is shared across layers (same
/// seed), so strokes that meet in different layers still meet.
pub fn hand_lines(lines: &[LineString<f64>], spec: &HandSpec) -> Lines {
    let strokes: penfill::Strokes = lines.iter().map(|l| l.0.iter().map(|c| (c.x, c.y)).collect()).collect();
    penfill::hand(&strokes, &spec.params())
        .into_iter()
        .filter(|s| s.len() >= 2)
        .map(|s| LineString(s.into_iter().map(|(x, y)| Coord { x, y }).collect()))
        .collect()
}

/// One optimization operation in `compose.optimize`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OptimizeOp {
    Deoverlap(DeoverlapSpec),
    Linemerge(LinemergeSpec),
    Simplify(SimplifySpec),
    Filter(FilterSpec),
    Reloop(ReloopSpec),
    Hand(HandSpec),
    Orient(OrientSpec),
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
            OptimizeOp::Hand(_) => "hand",
            OptimizeOp::Orient(_) => "orient",
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
    let mut oriented_layers: BTreeSet<String> = BTreeSet::new();
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
            OptimizeOp::Hand(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = hand_lines(&groups[idx].1, spec);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Orient(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let out = orient_lines(&groups[idx].1, spec);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    oriented_layers.insert(groups[idx].0.clone());
                    groups[idx].1 = out;
                }
            }
            OptimizeOp::Linesort(spec) => {
                let results: Vec<(usize, Lines)> = indices
                    .par_iter()
                    .map(|&idx| {
                        let mut eff = spec.clone();
                        if oriented_layers.contains(&groups[idx].0) {
                            eff.follow = true;
                        }
                        let out = linesort_lines(&groups[idx].1, &eff);
                        step_task.tick();
                        (idx, out)
                    })
                    .collect();
                for (idx, out) in results {
                    if spec.direction.is_some() {
                        oriented_layers.insert(groups[idx].0.clone());
                    }
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
// 6. Orient (align stroke directions to a preferred angle/compass direction)
// ---------------------------------------------------------------------------

fn split_at_reversals(line: &LineString<f64>, ux: f64, uy: f64) -> Lines {
    let pts = &line.0;
    if pts.len() < 3 {
        return vec![line.clone()];
    }
    let first = pts[0];
    let last = *pts.last().unwrap();
    if (first.x - last.x).powi(2) + (first.y - last.y).powi(2) <= 1e-8 {
        return vec![line.clone()];
    }

    let mut pieces: Lines = Vec::new();
    let mut current: Vec<Coord<f64>> = vec![pts[0]];
    // Sign of projection onto (ux, uy): +1 for forward, -1 for backward, 0 if perpendicular.
    let mut prev_sign: i8 = 0;

    for w in pts.windows(2) {
        let a = w[0];
        let b = w[1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let seg_len = (dx * dx + dy * dy).sqrt();
        if seg_len <= 1e-9 {
            continue;
        }
        let proj = (dx * ux + dy * uy) / seg_len;
        // Only count as a strong forward/backward commitment if |cos(theta)| > 0.15 (~81 deg)
        let sign = if proj > 0.15 {
            1
        } else if proj < -0.15 {
            -1
        } else {
            0
        };

        if prev_sign != 0 && sign != 0 && sign != prev_sign {
            if current.len() >= 2 {
                pieces.push(LineString::new(current));
            }
            current = vec![a, b];
            prev_sign = sign;
        } else {
            current.push(b);
            if sign != 0 {
                prev_sign = sign;
            }
        }
    }

    if current.len() >= 2 {
        pieces.push(LineString::new(current));
    }
    pieces
}

pub fn orient_lines(lines: &[LineString<f64>], spec: &OrientSpec) -> Lines {
    let (ux, uy) = spec.direction.unit_vector();
    let max_len = spec.max_length.map(|m| m.0).filter(|&m| m > 0.0);

    let candidates: Lines = if spec.split_reversals {
        lines
            .iter()
            .filter(|l| l.0.len() >= 2)
            .flat_map(|l| {
                if let Some(limit) = max_len {
                    if geom::line_length(l) > limit {
                        return vec![l.clone()];
                    }
                }
                split_at_reversals(l, ux, uy)
            })
            .collect()
    } else {
        lines.iter().filter(|l| l.0.len() >= 2).cloned().collect()
    };

    candidates
        .into_iter()
        .map(|mut l| {
            let first = l.0[0];
            let last = *l.0.last().unwrap();
            let closed = (first.x - last.x).powi(2) + (first.y - last.y).powi(2) <= 1e-8;
            if closed {
                return l;
            }
            if let Some(limit) = max_len {
                if geom::line_length(&l) > limit {
                    return l;
                }
            }
            let dx = last.x - first.x;
            let dy = last.y - first.y;
            let dot = dx * ux + dy * uy;
            if dot < -1e-9 {
                l.0.reverse();
            } else if dot.abs() <= 1e-9 {
                // Tie-breaker on perpendicular axis so perpendicular lines are also consistent.
                let perp = -dx * uy + dy * ux;
                if perp < -1e-9 {
                    l.0.reverse();
                }
            }
            l
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 7. Linesort (nearest-neighbor + 2-opt)
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
    let valid: Vec<LineString<f64>> = if let Some(dir) = spec.direction {
        orient_lines(
            lines,
            &OrientSpec {
                direction: dir,
                max_length: spec.max_length,
                split_reversals: spec.split_reversals,
            },
        )
    } else {
        lines.iter().filter(|l| l.0.len() >= 2).cloned().collect()
    };
    if valid.len() < 2 {
        return valid;
    }

    let allow_flip = !spec.follow && spec.direction.is_none();
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

    #[test]
    fn orient_flips_strokes_to_preferred_direction_and_splits_reversals() {
        let forward = line_string![(x: 0.0, y: 0.0), (x: 10.0, y: 0.0)];
        let backward = line_string![(x: 10.0, y: 5.0), (x: 0.0, y: 5.0)];
        let spec = OrientSpec {
            direction: DirectionAngle::parse_str("lr").unwrap(),
            max_length: None,
            split_reversals: false,
        };
        let oriented = orient_lines(&[forward, backward], &spec);
        assert_eq!(oriented.len(), 2);
        for l in &oriented {
            assert!(l.0.first().unwrap().x < l.0.last().unwrap().x);
        }

        // Zigzag stroke reversing along x should split into 3 forward strokes when split_reversals = true.
        let zigzag = line_string![
            (x: 0.0, y: 0.0),
            (x: 10.0, y: 1.0),
            (x: 0.0, y: 2.0),
            (x: 10.0, y: 3.0)
        ];
        let split_spec = OrientSpec {
            direction: DirectionAngle(0.0),
            max_length: None,
            split_reversals: true,
        };
        let split = orient_lines(&[zigzag], &split_spec);
        assert_eq!(split.len(), 3);
        for l in &split {
            assert!(l.0.first().unwrap().x < l.0.last().unwrap().x);
        }

        // Linesort with direction should orient strokes and never flip them back.
        let s1 = line_string![(x: 10.0, y: 0.0), (x: 0.0, y: 0.0)];
        let s2 = line_string![(x: 10.0, y: 0.1), (x: 0.0, y: 0.1)];
        let sorted = linesort_lines(
            &[s1, s2],
            &LinesortSpec {
                direction: Some(DirectionAngle::parse_str("tl-br").unwrap()),
                ..Default::default()
            },
        );
        for l in &sorted {
            assert!(l.0.first().unwrap().x < l.0.last().unwrap().x);
        }
    }
}
