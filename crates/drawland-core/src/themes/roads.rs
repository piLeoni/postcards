//! Roads: the carriageway as an area. Each way is buffered by half its
//! ground width; bridges stack above what they cross, and the seams where a
//! deck crosses a road below become detail strokes.

use super::{below_ground, Context, LayerParts};
use crate::fill;
use crate::geom::{self, Lines};
use crate::osm::{Element, Feature};
use crate::profile::StrokeSpec;
use crate::tiles::LAYER_TAG;
use geo::algorithm::buffer::Buffer;
use geo::{Coord, Geometry, LineString, MultiLineString, MultiPolygon};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// Coordinate space for bare numbers in [`RoadOptions`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoadWidthMode {
    /// Metres on the ground, scaled by the map's `scale`.
    #[default]
    Ground,
    /// Millimetres on the printed sheet, independent of map `scale`.
    Paper,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroundMeasure {
    pub ground: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaperMeasure {
    pub paper: f64,
}

/// A road measurement: a bare number (interpreted with [`RoadOptions::width_mode`]),
/// `{ ground: m }` (metres on earth), or `{ paper: mm }` (mm on paper).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RoadMeasure {
    Bare(f64),
    Ground(GroundMeasure),
    Paper(PaperMeasure),
}

impl RoadMeasure {
    pub const fn bare(v: f64) -> Self {
        RoadMeasure::Bare(v)
    }

    pub const fn ground(v: f64) -> Self {
        RoadMeasure::Ground(GroundMeasure { ground: v })
    }

    pub const fn paper(v: f64) -> Self {
        RoadMeasure::Paper(PaperMeasure { paper: v })
    }

    /// Convert to output millimetres. Ground metres are multiplied by `scale_ratio`.
    pub fn to_mm(self, default_mode: RoadWidthMode, scale_ratio: f64) -> f64 {
        match self {
            RoadMeasure::Ground(g) => g.ground * scale_ratio,
            RoadMeasure::Paper(p) => p.paper,
            RoadMeasure::Bare(v) => match default_mode {
                RoadWidthMode::Ground => v * scale_ratio,
                RoadWidthMode::Paper => v,
            },
        }
    }

    pub fn is_ground(self, default_mode: RoadWidthMode) -> bool {
        match self {
            RoadMeasure::Ground(_) => true,
            RoadMeasure::Paper(_) => false,
            RoadMeasure::Bare(_) => default_mode == RoadWidthMode::Ground,
        }
    }
}

/// Per-class configuration in [`RoadOptions::classes`].
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoadClassObject {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ground: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<RoadMeasure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lanes: Option<f64>,
    #[serde(default, alias = "singleLine", skip_serializing_if = "Option::is_none")]
    pub single_line: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub centerline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clearance: Option<RoadMeasure>,
}

impl RoadClassObject {
    pub fn width_measure(&self) -> Option<RoadMeasure> {
        if let Some(g) = self.ground {
            Some(RoadMeasure::ground(g))
        } else if let Some(p) = self.paper {
            Some(RoadMeasure::paper(p))
        } else {
            self.width
        }
    }

    pub fn validate(&self, where_: &str) -> Result<(), String> {
        let count = usize::from(self.ground.is_some())
            + usize::from(self.paper.is_some())
            + usize::from(self.width.is_some());
        if count > 1 {
            return Err(format!("{where_}: specify only one of ground, paper, or width"));
        }
        if self.single_line == Some(true) && count > 0 {
            return Err(format!(
                "{where_}: singleLine classes do not take a road width (use clearance for mask width)"
            ));
        }
        if let Some(l) = self.lanes {
            if !l.is_finite() || l <= 0.0 {
                return Err(format!("{where_}: lanes must be a positive number"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RoadClassSpec {
    Bare(f64),
    Object(RoadClassObject),
}

impl RoadClassSpec {
    pub fn as_object(&self) -> RoadClassObject {
        match self {
            RoadClassSpec::Bare(v) => RoadClassObject {
                width: Some(RoadMeasure::Bare(*v)),
                ..Default::default()
            },
            RoadClassSpec::Object(o) => o.clone(),
        }
    }

    pub fn validate(&self, where_: &str) -> Result<(), String> {
        match self {
            RoadClassSpec::Bare(v) => {
                if !v.is_finite() || *v < 0.0 {
                    return Err(format!("{where_}: width must be a non-negative number"));
                }
                Ok(())
            }
            RoadClassSpec::Object(o) => o.validate(where_),
        }
    }
}

fn default_one() -> f64 {
    1.0
}
fn default_true() -> bool {
    true
}
fn default_centerline_min_width() -> RoadMeasure {
    RoadMeasure::Bare(CENTERLINE_MIN_WIDTH_M)
}
fn default_joint_close() -> RoadMeasure {
    RoadMeasure::Bare(JOINT_CLOSE_M)
}
fn default_zero_measure() -> RoadMeasure {
    RoadMeasure::Bare(0.0)
}
fn is_one(v: &f64) -> bool {
    (*v - 1.0).abs() < 1e-12
}
fn is_true(v: &bool) -> bool {
    *v
}
fn is_default_mode(m: &RoadWidthMode) -> bool {
    *m == RoadWidthMode::Ground
}
fn is_default_centerline(m: &RoadMeasure) -> bool {
    *m == default_centerline_min_width()
}
fn is_default_joint_close(m: &RoadMeasure) -> bool {
    *m == default_joint_close()
}
fn is_zero_measure(m: &RoadMeasure) -> bool {
    *m == default_zero_measure()
}

/// Profile options for `modules.roads(...)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoadOptions {
    #[serde(default, alias = "widthMode", skip_serializing_if = "is_default_mode")]
    pub width_mode: RoadWidthMode,
    #[serde(default = "default_one", alias = "widthMultiplier", skip_serializing_if = "is_one")]
    pub width_multiplier: f64,
    #[serde(default = "default_true", alias = "useWidthTag", skip_serializing_if = "is_true")]
    pub use_width_tag: bool,
    #[serde(default = "default_true", alias = "multiplyByLanes", skip_serializing_if = "is_true")]
    pub multiply_by_lanes: bool,
    #[serde(default = "default_true", alias = "inferLanesByClass", skip_serializing_if = "is_true")]
    pub infer_lanes_by_class: bool,
    #[serde(
        default = "default_centerline_min_width",
        alias = "centerlineMinWidth",
        skip_serializing_if = "is_default_centerline"
    )]
    pub centerline_min_width: RoadMeasure,
    #[serde(
        default = "default_joint_close",
        alias = "jointClose",
        skip_serializing_if = "is_default_joint_close"
    )]
    pub joint_close: RoadMeasure,
    #[serde(default = "default_zero_measure", skip_serializing_if = "is_zero_measure")]
    pub clearance: RoadMeasure,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub classes: BTreeMap<String, RoadClassSpec>,
}

impl Default for RoadOptions {
    fn default() -> Self {
        Self {
            width_mode: RoadWidthMode::Ground,
            width_multiplier: 1.0,
            use_width_tag: true,
            multiply_by_lanes: true,
            infer_lanes_by_class: true,
            centerline_min_width: default_centerline_min_width(),
            joint_close: default_joint_close(),
            clearance: default_zero_measure(),
            classes: BTreeMap::new(),
        }
    }
}

impl RoadOptions {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    pub fn validate(&self) -> Result<(), String> {
        if !self.width_multiplier.is_finite() || self.width_multiplier < 0.0 {
            return Err("module_roads.width_multiplier must be a non-negative number".into());
        }
        for (k, v) in &self.classes {
            v.validate(&format!("module_roads.classes.{k}"))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
struct ResolvedClass {
    width: RoadMeasure,
    lanes: f64,
    single_line: bool,
    centerline: Option<bool>,
    clearance: Option<RoadMeasure>,
}

fn builtin_class(class: &str) -> ResolvedClass {
    let road = |w: f64, lanes: f64| ResolvedClass {
        width: RoadMeasure::ground(w),
        lanes,
        single_line: false,
        centerline: None,
        clearance: None,
    };
    let single = |clear_m: f64| ResolvedClass {
        width: RoadMeasure::ground(clear_m),
        lanes: 1.0,
        single_line: true,
        centerline: Some(false),
        clearance: Some(RoadMeasure::ground(clear_m)),
    };
    match class {
        "motorway" => road(3.75, 4.0),
        "motorway_link" => road(3.5, 2.0),
        "trunk" => road(5.0, 2.0),
        "trunk_link" => road(3.0, 2.0),
        "primary" => road(3.5, 2.0),
        "primary_link" => road(3.0, 2.0),
        "secondary" => road(3.0, 2.0),
        "secondary_link" | "tertiary" | "tertiary_link" | "construction" => road(2.5, 2.0),
        "residential" | "unclassified" => road(4.0, 1.0),
        "living_street" | "service" | "pedestrian" => road(3.0, 1.0),
        "elevator" => road(1.5, 1.0),
        "footway" | "path" | "steps" => single(TRAIL_WIDTH_M),
        "cycleway" => single(TRAIL_WIDTH_M),
        "bridleway" => single(TRAIL_WIDTH_M),
        "track" => single(TRAIL_WIDTH_M),
        "rail" => single(RAIL_WIDTH_M),
        _ => road(LANE_WIDTH_M, 2.0),
    }
}

fn apply_override(mut base: ResolvedClass, over: &RoadClassObject) -> ResolvedClass {
    if let Some(w) = over.width_measure() {
        base.width = w;
        if over.single_line.is_none() {
            base.single_line = false;
        }
    }
    if let Some(lanes) = over.lanes {
        base.lanes = lanes;
    }
    if let Some(single) = over.single_line {
        base.single_line = single;
    }
    if let Some(cl) = over.centerline {
        base.centerline = Some(cl);
    }
    if let Some(c) = over.clearance {
        base.clearance = Some(c);
    }
    base
}

fn resolve_class(class: &str, opts: &RoadOptions) -> ResolvedClass {
    let mut resolved = builtin_class(class);
    let is_known = matches!(
        class,
        "motorway"
            | "motorway_link"
            | "trunk"
            | "trunk_link"
            | "primary"
            | "primary_link"
            | "secondary"
            | "secondary_link"
            | "tertiary"
            | "tertiary_link"
            | "construction"
            | "residential"
            | "unclassified"
            | "living_street"
            | "service"
            | "pedestrian"
            | "elevator"
            | "footway"
            | "path"
            | "steps"
            | "cycleway"
            | "bridleway"
            | "track"
            | "rail"
    );
    if !is_known {
        if let Some(def) = opts.classes.get("default") {
            resolved = apply_override(resolved, &def.as_object());
        }
    }
    if let Some(spec) = opts.classes.get(class) {
        resolved = apply_override(resolved, &spec.as_object());
    }
    resolved
}

/// Soft upper bounds, metres: tags like `width=200` on a residential happen.
fn max_width_by_type(highway: &str) -> f64 {
    match highway {
        "motorway" => 50.0,
        "motorway_link" => 25.0,
        "trunk" => 40.0,
        "trunk_link" => 20.0,
        "primary" => 30.0,
        "primary_link" => 18.0,
        "secondary" => 24.0,
        "secondary_link" | "residential" | "unclassified" => 15.0,
        "tertiary" | "pedestrian" => 20.0,
        "tertiary_link" | "living_street" | "service" => 12.0,
        "footway" | "cycleway" | "path" => 6.0,
        _ => 40.0,
    }
}

const LANE_WIDTH_M: f64 = 3.0;
const BUFFER_FUDGE: f64 = 1.25;
/// Gaps narrower than this on the ground are closed after buffering (flat-cap
/// wedges at joints) without gluing dual carriageways together.
const JOINT_CLOSE_M: f64 = 2.5;
/// Grid (output mm) endpoints snap to when looking for shared nodes.
const NODE_SNAP_MM: f64 = 0.05;
const CENTERLINE_MIN_WIDTH_M: f64 = 6.0;
/// Ground width a trail cuts out of what is below it. A trail is one pen
/// line, so it hides about as much as the line covers, whatever its tags say.
const TRAIL_WIDTH_M: f64 = 1.0;
/// Ground width a railway cuts out of what is below it: the track bed, so
/// a fill or hatching under it keeps clear of the line.
const RAIL_WIDTH_M: f64 = 5.0;
const CENTERLINE_DASH_MM: f64 = 0.3;
const CENTERLINE_GAP_MM: f64 = 0.35;

fn unit_to_metres(unit: &str) -> Option<f64> {
    Some(match unit {
        "m" | "metre" | "metres" | "meter" | "meters" => 1.0,
        "km" => 1000.0,
        "ft" | "feet" | "foot" | "'" => 0.3048,
        "in" | "inch" | "inches" => 0.0254,
        _ => return None,
    })
}

/// An OSM `width` in metres: bare numbers are metres; units and feet-inches
/// (`12'6"`) are converted; `a;b` takes the larger.
fn parse_width_m(value: &str) -> Option<f64> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }
    if v.contains(';') && !v.contains('|') {
        return v.split(';').filter_map(parse_width_m).reduce(f64::max);
    }
    if let Some(m) = feet_inches(v) {
        return Some(m);
    }
    let num_end = v.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(v.len());
    if num_end == 0 {
        return None;
    }
    let (number, rest) = v.split_at(num_end);
    let unit = rest.trim_start();
    if !unit.chars().all(|c| c.is_ascii_alphabetic() || c == '\'' || c == '"') {
        return None;
    }
    let number: f64 = number.parse().ok()?;
    let unit = if unit.is_empty() { "m".to_string() } else { unit.to_ascii_lowercase() };
    Some(number * unit_to_metres(unit.trim())?)
}

fn feet_inches(v: &str) -> Option<f64> {
    let digits = |s: &str| -> Option<(u32, usize)> {
        let n = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
        (n > 0).then(|| s[..n].parse().ok().map(|d| (d, n)))?
    };
    let (feet, n) = digits(v)?;
    let rest = v[n..].trim_start().strip_prefix('\'')?.trim_start();
    if rest.is_empty() {
        return Some(feet as f64 * 0.3048);
    }
    let (inches, n) = digits(rest)?;
    let tail = rest[n..].trim_start().strip_prefix('"')?;
    tail.is_empty().then(|| (feet as f64 + inches as f64 / 12.0) * 0.3048)
}

fn width_lanes_m(value: &str) -> Option<f64> {
    let widths: Vec<f64> = value.trim().split(['|', ';']).filter_map(parse_width_m).filter(|w| *w > 0.0).collect();
    (!widths.is_empty()).then(|| widths.iter().sum())
}

/// The OSM `highway` a way stands for: its tag, or for a vector tile road
/// (OpenMapTiles `transportation`) the nearest one to its class and subclass.
/// Railways, ferries, roads under construction and indoor corridors are not
/// roads here.
fn highway(f: &Feature) -> Option<&str> {
    if f.element != Element::Tile {
        return f.tag("highway");
    }
    if f.tag(LAYER_TAG) != Some("transportation") {
        return None;
    }
    let ramp = truthy(f.tag("ramp"));
    Some(match (f.tag("class")?, ramp) {
        ("motorway", false) => "motorway",
        ("motorway", true) => "motorway_link",
        ("trunk", false) => "trunk",
        ("trunk", true) => "trunk_link",
        ("primary", false) => "primary",
        ("primary", true) => "primary_link",
        ("secondary", false) => "secondary",
        ("secondary", true) => "secondary_link",
        ("tertiary", false) => "tertiary",
        ("tertiary", true) => "tertiary_link",
        ("minor", _) => "residential",
        ("service" | "busway", _) => "service",
        ("track", _) => "track",
        ("raceway", _) => "raceway",
        ("path", _) => match f.tag("subclass") {
            Some(s @ ("footway" | "path" | "steps" | "cycleway" | "bridleway" | "pedestrian")) => s,
            Some("corridor" | "platform") => return None,
            _ => "path",
        },
        _ => return None,
    })
}

/// A tunnel's `tunnel` value (`yes`, `culvert`…); tiles say `brunnel=tunnel`.
fn tunnel(f: &Feature) -> Option<&str> {
    match f.element {
        Element::Tile => (f.tag("brunnel") == Some("tunnel")).then_some("yes"),
        _ => f.tag("tunnel"),
    }
}

fn bridge(f: &Feature) -> bool {
    match f.element {
        Element::Tile => f.tag("brunnel") == Some("bridge"),
        _ => truthy(f.tag("bridge")),
    }
}

fn explicit_width_m(f: &Feature) -> Option<f64> {
    if let Some(w) = f.tag("width").and_then(parse_width_m).filter(|w| *w > 0.0) {
        return Some(w);
    }
    for key in ["width:lanes", "width:lanes:forward", "width:lanes:backward"] {
        if let Some(w) = f.tag(key).and_then(width_lanes_m) {
            return Some(w);
        }
    }
    None
}

fn parse_lanes(f: &Feature) -> Option<f64> {
    let lanes = f.tag("lanes")?;
    let n = lanes
        .replace('|', ";")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .parse::<f64>()
        .ok()?;
    (n.is_finite() && n > 0.0).then_some(n)
}

fn road_width_mm(
    f: &Feature,
    class_name: &str,
    resolved: &ResolvedClass,
    opts: &RoadOptions,
    scale_ratio: f64,
) -> f64 {
    let mult = opts.width_multiplier.max(0.0);
    let clamp_m = |w: f64| w.max(0.5).min(max_width_by_type(class_name));
    if opts.use_width_tag {
        if let Some(w_m) = explicit_width_m(f) {
            return clamp_m(w_m) * scale_ratio * mult;
        }
    }
    let explicit_lanes = parse_lanes(f);
    let lane_mult = if opts.multiply_by_lanes {
        if let Some(n) = explicit_lanes {
            n
        } else if opts.infer_lanes_by_class {
            resolved.lanes
        } else {
            1.0
        }
    } else {
        1.0
    };
    if resolved.width.is_ground(opts.width_mode) {
        let base_m = match resolved.width {
            RoadMeasure::Ground(g) => g.ground,
            RoadMeasure::Bare(v) => v,
            RoadMeasure::Paper(_) => unreachable!(),
        };
        let w_m = if explicit_lanes.is_some() {
            clamp_m(base_m * lane_mult)
        } else {
            (base_m * lane_mult).max(0.0)
        };
        w_m * scale_ratio * mult
    } else {
        let base_mm = resolved.width.to_mm(opts.width_mode, scale_ratio);
        (base_mm * lane_mult * mult).max(0.0)
    }
}

#[cfg(test)]
fn road_width_m(f: &Feature) -> f64 {
    let opts = RoadOptions::default();
    let class_name = if is_rail(f) { "rail" } else { highway(f).unwrap_or("") };
    let resolved = resolve_class(class_name, &opts);
    road_width_mm(f, class_name, &resolved, &opts, 1.0)
}

/// Ways drawn as a single line instead of a carriageway outline by default.
#[cfg(test)]
fn is_trail(f: &Feature) -> bool {
    let opts = RoadOptions::default();
    highway(f).is_some_and(|h| resolve_class(h, &opts).single_line)
}

/// Railways drawn as one line: an OSM `railway` that carries trains, or a
/// tile `transportation` way of class `rail` or `transit`.
fn is_rail(f: &Feature) -> bool {
    match f.element {
        Element::Tile => {
            f.tag(LAYER_TAG) == Some("transportation") && matches!(f.tag("class"), Some("rail" | "transit"))
        }
        _ => matches!(
            f.tag("railway"),
            Some("rail" | "light_rail" | "tram" | "subway" | "narrow_gauge" | "monorail" | "funicular" | "preserved")
        ),
    }
}

fn truthy(v: Option<&str>) -> bool {
    v.is_some_and(|t| !matches!(t.trim().to_ascii_lowercase().as_str(), "" | "no" | "false" | "0"))
}

/// Stacking index: `layer`, with bridges lifted to at least 1 (a bridge
/// tagged `layer=0` is a common mistake) and tunnels pushed below ground.
fn road_layer(f: &Feature) -> i64 {
    let explicit = f
        .tag("layer")
        .filter(|l| !l.trim().is_empty())
        .and_then(|l| l.split(';').next().unwrap_or("").trim().parse::<f64>().ok())
        .map(|l| l.trunc() as i64);
    if let Some(t) = tunnel(f) {
        if !matches!(t.trim().to_ascii_lowercase().as_str(), "" | "no" | "false" | "0" | "building_passage") {
            return explicit.filter(|e| *e < 0).unwrap_or(-1);
        }
    }
    let bridge = bridge(f);
    match explicit {
        Some(0) if bridge => 1,
        Some(e) => e,
        None if bridge => 1,
        None => 0,
    }
}

fn merge(polys: &[MultiPolygon<f64>]) -> MultiPolygon<f64> {
    geom::union_multi(polys)
}

fn close_gaps(mp: &MultiPolygon<f64>, c: f64) -> MultiPolygon<f64> {
    geom::buffer(&geom::buffer(mp, c), -c)
}

fn keep_longer(lines: Lines, min: f64) -> Lines {
    geom::linemerge(&lines).into_iter().filter(|l| geom::line_length(l) > min).collect()
}

/// Dashes for a lane divider; pieces shorter than 0.05 mm are dropped.
fn dashed_centerline(line: &LineString<f64>) -> Lines {
    let length = geom::line_length(line);
    if length < CENTERLINE_DASH_MM * 0.5 {
        return vec![];
    }
    let mut out = Vec::new();
    let mut t = 0.0;
    while t < length - 1e-9 {
        let b = (t + CENTERLINE_DASH_MM).min(length);
        if b - t > 0.05 {
            if let Some(piece) = geom::substring(line, t, b).filter(|p| geom::line_length(p) > 0.05) {
                out.push(piece);
            }
        }
        t += CENTERLINE_DASH_MM + CENTERLINE_GAP_MM;
    }
    out
}

fn node_key(layer: i64, c: Coord<f64>) -> (i64, u64, u64) {
    let snap = |v: f64| ((v / NODE_SNAP_MM).round_ties_even() * NODE_SNAP_MM + 0.0).to_bits();
    (layer, snap(c.x), snap(c.y))
}

/// The module's drawing, with its details also kept apart: the centre lines
/// whole (undashed, cut where a higher deck passes over) and the bridge seams.
pub struct Roads {
    /// `details` holds the centre lines dashed, then the seams.
    pub parts: LayerParts,
    pub centerlines: Lines,
    pub seams: Lines,
    /// Railways as single lines, when the features include any; their track
    /// bed is part of the mask.
    pub rails: Lines,
}

pub(crate) fn build(ctx: &Context, opts: &RoadOptions) -> Roads {
    let feats: Vec<(&Feature, i64)> = ctx
        .features
        .iter()
        .filter(|f| {
            (is_rail(f) || highway(f).is_some())
                && !matches!(f.tag("footway"), Some("crossing" | "sidewalk"))
                && !f.is_point()
        })
        .map(|f| (f, road_layer(f)))
        .filter(|(f, l)| *l >= 0 && !below_ground(f, &["layer"]))
        .collect();
    if feats.is_empty() {
        return Roads { parts: LayerParts::default(), centerlines: vec![], seams: vec![], rails: vec![] };
    }

    let scale_ratio = 1.0 / (ctx.output.scale / 1000.0) * BUFFER_FUDGE;
    let centerline_min_mm = opts.centerline_min_width.to_mm(opts.width_mode, scale_ratio);

    let mut buffered: Vec<MultiPolygon<f64>> = Vec::new();
    let mut extra_covered: Vec<MultiPolygon<f64>> = Vec::new();
    // Trails at ground level stop at the carriageway edge; on a bridge they
    // are drawn across whatever they span.
    let mut ground_trails: Lines = Vec::new();
    let mut raised_trails: Lines = Vec::new();
    // Railways likewise: cut by the carriageway at a level crossing, drawn
    // across it on a bridge.
    let mut ground_rails: Lines = Vec::new();
    let mut raised_rails: Lines = Vec::new();
    // Single-line mask strips keyed by clearance radius in 1e-4 mm steps.
    let mut single_clear_order: Vec<i64> = Vec::new();
    let mut single_clear_by_key: HashMap<i64, Lines> = HashMap::new();
    // Keyed by (layer, radius as 1e-4 mm steps, has_centerline, extra_clearance_steps), in first-seen order.
    type RoadKey = (i64, i64, bool, i64);
    let mut key_order: Vec<RoadKey> = Vec::new();
    let mut lines_by_key: HashMap<RoadKey, Lines> = HashMap::new();
    // Snapped node → (its position, the radii of the ways ending there).
    type NodeKey = (i64, u64, u64);
    let mut node_radii: HashMap<NodeKey, (Coord<f64>, Vec<f64>)> = HashMap::new();

    for (f, lyr) in &feats {
        let rail = is_rail(f);
        let class_name = if rail {
            "rail"
        } else {
            let Some(h) = highway(f) else { continue };
            h
        };
        let resolved = resolve_class(class_name, opts);
        match &f.geometry {
            Geometry::LineString(_) | Geometry::MultiLineString(_) if resolved.single_line => {
                let parts: Lines =
                    geom::lines_of(&f.geometry).into_iter().filter(|p| geom::line_length(p) > 0.0).collect();
                if parts.is_empty() {
                    continue;
                }
                let clear_mm = resolved
                    .clearance
                    .unwrap_or_else(|| RoadMeasure::ground(if rail { RAIL_WIDTH_M } else { TRAIL_WIDTH_M }))
                    .to_mm(opts.width_mode, scale_ratio);
                let clear_steps = ((clear_mm / 2.0) * 1e4).round_ties_even() as i64;
                if clear_steps > 0 {
                    if !single_clear_by_key.contains_key(&clear_steps) {
                        single_clear_order.push(clear_steps);
                    }
                    single_clear_by_key.entry(clear_steps).or_default().extend(parts.iter().cloned());
                }
                if rail {
                    if *lyr >= 1 { raised_rails.extend(parts) } else { ground_rails.extend(parts) }
                } else if *lyr >= 1 {
                    raised_trails.extend(parts)
                } else {
                    ground_trails.extend(parts)
                }
            }
            Geometry::Polygon(_) | Geometry::MultiPolygon(_) if resolved.single_line => {}
            Geometry::LineString(_) | Geometry::MultiLineString(_) => {
                let width_mm = road_width_mm(f, class_name, &resolved, opts, scale_ratio);
                let radius = width_mm / 2.0;
                let r_steps = (radius * 1e4).round_ties_even() as i64;
                if r_steps <= 0 {
                    continue;
                }
                let has_centerline = resolved.centerline.unwrap_or(width_mm >= centerline_min_mm - 1e-9);
                let extra_clear_mm = resolved
                    .clearance
                    .unwrap_or(opts.clearance)
                    .to_mm(opts.width_mode, scale_ratio)
                    .max(0.0);
                let clear_steps = (extra_clear_mm * 1e4).round_ties_even() as i64;
                let key = (*lyr, r_steps, has_centerline, clear_steps);
                for part in geom::lines_of(&f.geometry) {
                    if part.0.len() < 2 || geom::line_length(&part) == 0.0 {
                        continue;
                    }
                    for c in [part.0[0], *part.0.last().unwrap()] {
                        let k = node_key(*lyr, c);
                        let snapped = Coord { x: f64::from_bits(k.1), y: f64::from_bits(k.2) };
                        node_radii.entry(k).or_insert_with(|| (snapped, vec![])).1.push(radius);
                    }
                    if !lines_by_key.contains_key(&key) {
                        key_order.push(key);
                    }
                    lines_by_key.entry(key).or_default().push(part);
                }
            }
            Geometry::Polygon(_) | Geometry::MultiPolygon(_) => {
                buffered.push(MultiPolygon::new(geom::polygons(&f.geometry)));
            }
            _ => {}
        }
    }

    let mut by_layer: BTreeMap<i64, Vec<MultiPolygon<f64>>> = BTreeMap::new();
    let mut endpoints_by_layer: BTreeMap<i64, Vec<MultiPolygon<f64>>> = BTreeMap::new();
    let mut centerlines_by_layer: BTreeMap<i64, Lines> = BTreeMap::new();

    for key in &key_order {
        let (lyr, r_steps, has_centerline, clear_steps) = *key;
        let radius = r_steps as f64 / 1e4;
        let extra_clear = clear_steps as f64 / 1e4;
        for part in geom::linemerge(&lines_by_key[key]) {
            if geom::line_length(&part) == 0.0 {
                continue;
            }
            let piece = geom::buffer_line_flat(&part, radius);
            buffered.push(piece.clone());
            if extra_clear > 0.0 {
                extra_covered.push(geom::buffer_line_flat(&part, radius + extra_clear));
            }
            if has_centerline {
                centerlines_by_layer.entry(lyr).or_default().push(part.clone());
            }
            if lyr >= 1 {
                by_layer.entry(lyr).or_default().push(piece);
                let ends = endpoints_by_layer.entry(lyr).or_default();
                ends.push(geom::disk(part.0[0], radius));
                ends.push(geom::disk(*part.0.last().unwrap(), radius));
            }
        }
    }

    // Where ways of different widths meet, a disk of the wider one fills the joint.
    for ((lyr, _, _), (centre, radii)) in &node_radii {
        if radii.len() < 2 {
            continue;
        }
        let disk = geom::disk(*centre, radii.iter().copied().fold(f64::MIN, f64::max));
        buffered.push(disk.clone());
        if *lyr >= 1 {
            by_layer.entry(*lyr).or_default().push(disk);
        }
    }

    let mut carriageway = merge(&buffered);
    let close = opts.joint_close.to_mm(opts.width_mode, scale_ratio);
    if close > 0.0 {
        carriageway = close_gaps(&carriageway, close);
        for decks in by_layer.values_mut() {
            let merged = merge(decks);
            *decks = if merged.0.is_empty() { vec![] } else { vec![close_gaps(&merged, close)] };
        }
    }
    let outer = MultiLineString::new(geom::rings(&carriageway));

    // Higher decks erase the centre-lines underneath.
    let elevated_union = merge(&by_layer.values().flatten().cloned().collect::<Vec<_>>());
    let mut higher_deck: BTreeMap<i64, MultiPolygon<f64>> = BTreeMap::new();
    let mut above = geom::empty();
    for (lyr, decks) in by_layer.iter().rev() {
        higher_deck.insert(*lyr, above.clone());
        let deck = merge(decks);
        if !deck.0.is_empty() {
            above = geom::union_multi([&above, &deck]);
        }
    }
    let mut centerlines: Lines = Vec::new();
    for (lyr, lines) in &centerlines_by_layer {
        let empty = geom::empty();
        let cutter = if *lyr <= 0 { &elevated_union } else { higher_deck.get(lyr).unwrap_or(&empty) };
        centerlines.extend(geom::clip_lines(lines, cutter, true));
    }
    let mut all_seams: Lines = Vec::new();

    // Bridge seams: each deck minus everything above it; only edges that are
    // not the outer silhouette are drawn.
    let ids: Vec<i64> = by_layer.keys().copied().filter(|l| *l >= 1).collect();
    let originals: Vec<MultiPolygon<f64>> = ids.iter().map(|l| merge(&by_layer[l])).collect();
    let endpoints: Vec<MultiPolygon<f64>> =
        ids.iter().map(|l| merge(endpoints_by_layer.get(l).map_or(&[][..], |v| v))).collect();
    for i in 0..ids.len() {
        let above: Vec<&MultiPolygon<f64>> = originals[i + 1..].iter().collect();
        let deck = geom::difference(&originals[i], &geom::union_multi(above));
        if deck.0.is_empty() {
            continue;
        }
        // A hair of band around the silhouette, built only near this deck:
        // buffering the whole outline costs seconds.
        let near = geom::clip_lines(&outer.0, &geom::buffer(&deck, 0.05), false);
        let band = if near.is_empty() { geom::empty() } else { MultiLineString::new(near).buffer(0.02) };
        let mut seams = keep_longer(geom::clip_lines(&geom::rings(&deck), &band, true), 0.05);
        if !endpoints[i].0.is_empty() {
            let cap = geom::buffer(&endpoints[i], 0.005);
            seams = keep_longer(geom::clip_lines(&seams, &cap, true), 0.05);
        }
        all_seams.extend(seams);
    }
    let mut details: Lines = centerlines.iter().flat_map(dashed_centerline).collect();
    details.extend(all_seams.iter().cloned());

    // Trails and rails stay out of the carriageway and of its gap closing: they
    // add no outline, only their own clearance strip to the mask.
    let mut covered: Vec<MultiPolygon<f64>> = Vec::new();
    for clear_steps in single_clear_order {
        let r = clear_steps as f64 / 1e4;
        for line in geom::linemerge(&single_clear_by_key[&clear_steps]) {
            covered.push(geom::buffer_line_flat(&line, r));
        }
    }
    covered.extend(extra_covered);
    covered.push(carriageway.clone());

    let ground_trails = geom::linemerge(&ground_trails);
    let raised_trails = geom::linemerge(&raised_trails);
    let ground_rails = geom::linemerge(&ground_rails);
    let raised_rails = geom::linemerge(&raised_rails);
    let mut trails = geom::clip_lines(&ground_trails, &carriageway, true);
    trails.extend(raised_trails);
    let mut rails = geom::clip_lines(&ground_rails, &carriageway, true);
    rails.extend(raised_rails);

    let parts = LayerParts {
        outlines: fill::stroke(geom::rings(&carriageway), &StrokeSpec::default()),
        details,
        trails,
        filling: vec![],
        mask: merge(&covered),
    };
    Roads { parts, centerlines, seams: all_seams, rails }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osm::{Element, Tags};
    use geo::Point;

    fn feature(tags: &[(&str, &str)]) -> Feature {
        let tags: Tags = tags.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Feature { element: Element::Way, id: 1, tags, geometry: Geometry::Point(Point::new(0.0, 0.0)) }
    }

    #[test]
    fn widths_follow_osm_priority() {
        assert_eq!(road_width_m(&feature(&[("highway", "residential"), ("width", "8")])), 8.0);
        assert_eq!(road_width_m(&feature(&[("highway", "residential"), ("width", "200")])), 15.0);
        assert!((road_width_m(&feature(&[("highway", "primary"), ("width", "20'")])) - 6.096).abs() < 1e-9);
        assert!((road_width_m(&feature(&[("highway", "primary"), ("width", "12'6\"")])) - 3.81).abs() < 1e-9);
        assert_eq!(road_width_m(&feature(&[("highway", "primary"), ("width:lanes", "3.5|3.5")])), 7.0);
        assert_eq!(road_width_m(&feature(&[("highway", "primary"), ("lanes", "3")])), 10.5);
        assert_eq!(road_width_m(&feature(&[("highway", "motorway")])), 15.0);
        assert_eq!(road_width_m(&feature(&[("highway", "raceway")])), 6.0);
        assert_eq!(parse_width_m("3 m;5"), Some(5.0));
        assert_eq!(parse_width_m("2 furlongs"), None);
    }

    #[test]
    fn tile_roads_speak_openmaptiles() {
        let tile = |tags: &[(&str, &str)]| Feature {
            element: Element::Tile,
            ..feature(&[&[(LAYER_TAG, "transportation")], tags].concat())
        };
        assert_eq!(highway(&tile(&[("class", "minor")])), Some("residential"));
        assert_eq!(highway(&tile(&[("class", "primary"), ("ramp", "1")])), Some("primary_link"));
        assert_eq!(highway(&tile(&[("class", "path"), ("subclass", "steps")])), Some("steps"));
        assert_eq!(highway(&tile(&[("class", "path"), ("subclass", "platform")])), None);
        assert_eq!(highway(&tile(&[("class", "rail"), ("subclass", "rail")])), None);
        assert!(is_trail(&tile(&[("class", "path"), ("subclass", "footway")])));
        assert_eq!(road_width_m(&tile(&[("class", "secondary")])), 6.0);
        assert_eq!(road_layer(&tile(&[("class", "minor"), ("brunnel", "bridge")])), 1);
        assert_eq!(road_layer(&tile(&[("class", "minor"), ("brunnel", "tunnel")])), -1);
        // An OSM way keeps reading OSM tags, even one called `class`.
        assert_eq!(highway(&feature(&[("class", "minor")])), None);
    }

    #[test]
    fn trails_are_one_line_that_still_cuts() {
        use crate::output::Output;
        use crate::profile::{OutputSpec, ProjectionMode};
        use crate::units::{Mm, Scale};
        use geo::{line_string, Contains};

        let way = |highway: &str, y: f64| Feature {
            geometry: Geometry::LineString(line_string![(x: 10.0, y: y), (x: 40.0, y: y)]),
            ..feature(&[("highway", highway)])
        };
        let map = OutputSpec {
            address: None,
            lat: None,
            lng: None,
            width: Mm(100.0),
            height: Mm(50.0),
            scale: Scale(10000.0),
            bearing: 0.0,
            projection: ProjectionMode::default(),
            warp: Default::default(),
            padding: Default::default(),
            slices: Default::default(),
            tile_zoom: None,
        };
        let output = Output::new(&map, (0.0, 0.0));
        let features = vec![way("residential", 30.0), way("track", 10.0), way("service", 20.0)];
        let ctx = Context { output: &output, features: &features };
        let parts = build(&ctx, &RoadOptions::default()).parts;

        assert_eq!(parts.trails.len(), 1, "only the track is a trail");
        assert!(parts.trails[0].0.iter().all(|c| c.y == 10.0));
        assert_eq!(geom::rings(&parts.mask).len(), 3, "residential, service and the track's strip");
        assert!(parts.mask.contains(&Point::new(25.0, 10.0)));
        assert!(parts.outlines.iter().all(|l| l.0.iter().all(|c| c.y > 15.0)), "the track has no outline");
    }

    #[test]
    fn railways_are_one_line_with_a_track_bed() {
        use crate::output::Output;
        use crate::profile::{OutputSpec, ProjectionMode};
        use crate::units::{Mm, Scale};
        use geo::{line_string, Contains};

        let tile = |tags: &[(&str, &str)]| Feature {
            element: Element::Tile,
            ..feature(&[&[(LAYER_TAG, "transportation")], tags].concat())
        };
        assert!(is_rail(&tile(&[("class", "rail"), ("subclass", "rail")])));
        assert!(is_rail(&tile(&[("class", "transit"), ("subclass", "light_rail")])));
        assert!(is_rail(&feature(&[("railway", "tram")])));
        assert!(!is_rail(&feature(&[("railway", "platform")])));
        assert!(!is_rail(&tile(&[("class", "minor")])));

        let map = OutputSpec {
            address: None,
            lat: None,
            lng: None,
            width: Mm(100.0),
            height: Mm(50.0),
            scale: Scale(10000.0),
            bearing: 0.0,
            projection: ProjectionMode::default(),
            warp: Default::default(),
            padding: Default::default(),
            slices: Default::default(),
            tile_zoom: None,
        };
        let output = Output::new(&map, (0.0, 0.0));
        let line = |tags: &[(&str, &str)], from: (f64, f64), to: (f64, f64)| Feature {
            geometry: Geometry::LineString(line_string![(x: from.0, y: from.1), (x: to.0, y: to.1)]),
            ..feature(tags)
        };
        // A railway crossing a residential street at grade, and one in a tunnel.
        let features = vec![
            line(&[("highway", "residential")], (10.0, 30.0), (40.0, 30.0)),
            line(&[("railway", "rail")], (25.0, 10.0), (25.0, 45.0)),
            line(&[("railway", "subway"), ("tunnel", "yes")], (60.0, 10.0), (60.0, 45.0)),
        ];
        let roads = build(&Context { output: &output, features: &features }, &RoadOptions::default());

        assert!(!roads.rails.is_empty());
        assert!(roads.rails.iter().all(|l| l.0.iter().all(|c| c.x == 25.0)), "the subway stays underground");
        assert!(roads.rails.iter().all(|l| l.0.iter().all(|c| (c.y - 30.0).abs() > 0.1)), "cut at the crossing");
        assert!(roads.parts.mask.contains(&Point::new(25.2, 15.0)), "the track bed masks");
        assert!(!roads.parts.mask.contains(&Point::new(60.0, 15.0)));
        assert!(roads.parts.trails.is_empty() && roads.parts.outlines.iter().all(|l| l.0.iter().all(|c| c.x != 25.0)));
    }

    #[test]
    fn centre_lines_come_whole_and_dashed() {
        use crate::output::Output;
        use crate::profile::{OutputSpec, ProjectionMode};
        use crate::units::{Mm, Scale};
        use geo::line_string;

        let way = |tags: &[(&str, &str)], y: f64| Feature {
            geometry: Geometry::LineString(line_string![(x: 10.0, y: y), (x: 40.0, y: y)]),
            ..feature(tags)
        };
        let map = OutputSpec {
            address: None,
            lat: None,
            lng: None,
            width: Mm(100.0),
            height: Mm(50.0),
            scale: Scale(5000.0),
            bearing: 0.0,
            projection: ProjectionMode::default(),
            warp: Default::default(),
            padding: Default::default(),
            slices: Default::default(),
            tile_zoom: None,
        };
        let output = Output::new(&map, (0.0, 0.0));
        let features = vec![way(&[("highway", "residential"), ("lanes", "2")], 30.0), way(&[("highway", "residential")], 10.0)];
        let ctx = Context { output: &output, features: &features };
        let roads = build(&ctx, &RoadOptions::default());

        assert_eq!(roads.centerlines.len(), 1, "two lanes make 6 m; one lane of 4 m has none");
        assert!(roads.centerlines[0].0.iter().all(|c| c.y == 30.0));
        assert!(roads.seams.is_empty());
        let dashes = dashed_centerline(&roads.centerlines[0]).len();
        assert!(dashes > 10 && roads.parts.details.len() == dashes, "details keep the dashed form");
    }

    #[test]
    fn layers_lift_bridges_and_sink_tunnels() {
        assert_eq!(road_layer(&feature(&[("bridge", "yes")])), 1);
        assert_eq!(road_layer(&feature(&[("bridge", "yes"), ("layer", "0")])), 1);
        assert_eq!(road_layer(&feature(&[("bridge", "yes"), ("layer", "2")])), 2);
        assert_eq!(road_layer(&feature(&[("tunnel", "yes")])), -1);
        assert_eq!(road_layer(&feature(&[("tunnel", "yes"), ("layer", "-2")])), -2);
        assert_eq!(road_layer(&feature(&[("tunnel", "building_passage")])), 0);
        assert_eq!(road_layer(&feature(&[("layer", "1;2")])), 1);
    }

    #[test]
    fn custom_road_options_paper_lanes_and_single_line() {
        let opts: RoadOptions = serde_json::from_value(serde_json::json!({
            "width_mode": "paper",
            "multiply_by_lanes": true,
            "infer_lanes_by_class": true,
            "classes": {
                "primary": { "paper": 0.4, "lanes": 2, "centerline": true },
                "residential": { "single_line": true, "clearance": 0.6 },
                "footway": { "ground": 2.0, "lanes": 1 }
            }
        }))
        .unwrap();
        opts.validate().unwrap();

        let scale_ratio = 1000.0 / 10000.0; // 1:10,000 -> 0.1 mm per metre
        // primary without lanes tag gets 0.4mm * 2 lanes = 0.8mm
        let p = resolve_class("primary", &opts);
        assert!(!p.single_line && p.centerline == Some(true));
        assert!((road_width_mm(&feature(&[("highway", "primary")]), "primary", &p, &opts, scale_ratio) - 0.8).abs() < 1e-9);
        // primary with lanes=4 gets 0.4mm * 4 = 1.6mm
        assert!((road_width_mm(&feature(&[("highway", "primary"), ("lanes", "4")]), "primary", &p, &opts, scale_ratio) - 1.6).abs() < 1e-9);

        // residential overridden to single_line
        let r = resolve_class("residential", &opts);
        assert!(r.single_line);
        assert!((r.clearance.unwrap().to_mm(opts.width_mode, scale_ratio) - 0.6).abs() < 1e-9);

        // footway promoted from single_line to 2-sided road (2.0m at 1:10000 = 0.2mm)
        let f = resolve_class("footway", &opts);
        assert!(!f.single_line);
        assert!((road_width_mm(&feature(&[("highway", "footway")]), "footway", &f, &opts, scale_ratio) - 0.2).abs() < 1e-9);
    }
}
