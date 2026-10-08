//! Labels: names written on the map in a single-stroke font, placed so that
//! none covers another.
//!
//! Placement is greedy, as web maps do it: every named feature is a candidate,
//! ranked by importance (a road's class, an area's size), and the most
//! important are placed first. A label is kept only if the box of each of its
//! glyphs, grown by `padding`, is clear of every label already kept and inside
//! the frame; otherwise the next position along the road is tried, and then
//! the feature goes unlabelled.
//!
//! On a road the text runs along the centreline, reading left to right: in a
//! straight line where the stretch under it is straight, glyph by glyph along
//! the curve where it is not (and the turns are gentle enough to read). A long
//! road is labelled again every `spacing`. An area is labelled level on the
//! page, inside it.

use crate::geom::{self, Lines};
use crate::osm::{Feature, Tags};
use crate::select::{self, TagTest};
use crate::text::{self, LabelFont, LabelGlyph, LabelLayout, CAP_HEIGHT, CAP_TOP, BASELINE};
use crate::units::Mm;
use geo::{Area, Centroid, Contains, Coord, InteriorPoint, LineString, MultiPolygon, Point, Polygon};
use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

/// TTF bytes keyed by [`text::google_font_key`].
pub type GoogleFonts = BTreeMap<String, Vec<u8>>;

fn default_keep_centerline() -> bool {
    true
}

/// How labels look and how close they may come. Every field has a default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Style {
    /// Draw.land Hershey font (`"futural"`) or `{ origin: "google", family, weight? }`.
    pub font: LabelFont,
    /// Capital height of the most important labels.
    pub size: Mm,
    /// Capital height of the least important.
    pub min_size: Mm,
    /// Clear space kept around every glyph.
    pub padding: Mm,
    /// Distance between two labels of the same name.
    pub spacing: Mm,
    /// Bend text along curving roads; off, only straight stretches are labelled.
    pub curved: bool,
    /// Write the names in capitals.
    pub upper: bool,
    /// The tags the text is read from, the first one present.
    pub keys: Vec<String>,
    /// Concentric buffer passes drawn around each placed name (0 = single stroke only).
    pub buffer: u32,
    /// Half-width added per buffer pass, round caps.
    pub buffer_step: Mm,
    /// When `buffer` > 0, keep the centre stroke as well as the outlines.
    #[serde(default = "default_keep_centerline", rename = "keep_centerline")]
    pub keep_centerline: bool,
    /// The first rule whose `tags` match wins; its fields override the defaults above.
    #[serde(default, deserialize_with = "deserialize_rules")]
    pub rules: Vec<LabelRule>,
}

/// One user-defined override: same tag syntax as `features.where`.
#[derive(Debug, Clone, PartialEq)]
pub struct LabelRule {
    pub tags: Vec<(String, TagTest)>,
    pub font: Option<text::LabelFont>,
    pub size: Option<Mm>,
    pub min_size: Option<Mm>,
    pub padding: Option<Mm>,
    pub spacing: Option<Mm>,
    pub curved: Option<bool>,
    pub upper: Option<bool>,
    pub buffer: Option<u32>,
    pub buffer_step: Option<Mm>,
    pub keep_centerline: Option<bool>,
}

#[derive(Deserialize)]
struct LabelRuleIn {
    tags: serde_json::Map<String, Value>,
    font: Option<text::LabelFont>,
    size: Option<Mm>,
    min_size: Option<Mm>,
    padding: Option<Mm>,
    spacing: Option<Mm>,
    curved: Option<bool>,
    upper: Option<bool>,
    buffer: Option<u32>,
    buffer_step: Option<Mm>,
    keep_centerline: Option<bool>,
}

impl LabelRule {
    fn from_in(raw: LabelRuleIn) -> Result<LabelRule, String> {
        Ok(LabelRule {
            tags: select::parse_tag_tests(raw.tags)?,
            font: raw.font,
            size: raw.size,
            min_size: raw.min_size,
            padding: raw.padding,
            spacing: raw.spacing,
            curved: raw.curved,
            upper: raw.upper,
            buffer: raw.buffer,
            buffer_step: raw.buffer_step,
            keep_centerline: raw.keep_centerline,
        })
    }
}

impl Serialize for LabelRule {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = serializer.serialize_map(None)?;
        m.serialize_entry("tags", &select::tag_tests_to_map(&self.tags))?;
        if let Some(v) = &self.font {
            m.serialize_entry("font", v)?;
        }
        if let Some(v) = &self.size {
            m.serialize_entry("size", v)?;
        }
        if let Some(v) = &self.min_size {
            m.serialize_entry("min_size", v)?;
        }
        if let Some(v) = &self.padding {
            m.serialize_entry("padding", v)?;
        }
        if let Some(v) = &self.spacing {
            m.serialize_entry("spacing", v)?;
        }
        if let Some(v) = self.curved {
            m.serialize_entry("curved", &v)?;
        }
        if let Some(v) = self.upper {
            m.serialize_entry("upper", &v)?;
        }
        if let Some(v) = self.buffer.filter(|&n| n > 0) {
            m.serialize_entry("buffer", &v)?;
        }
        if let Some(v) = &self.buffer_step {
            m.serialize_entry("buffer_step", v)?;
        }
        if self.keep_centerline == Some(false) {
            m.serialize_entry("keep_centerline", &false)?;
        }
        m.end()
    }
}

fn deserialize_rules<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<LabelRule>, D::Error> {
    let raw = Vec::<LabelRuleIn>::deserialize(d)?;
    raw.into_iter()
        .map(LabelRule::from_in)
        .collect::<Result<_, _>>()
        .map_err(D::Error::custom)
}

/// Resolved look for one feature after defaults and the first matching rule.
#[derive(Debug, Clone)]
struct EffectiveStyle {
    font: LabelFont,
    size: Mm,
    min_size: Mm,
    padding: Mm,
    spacing: Mm,
    curved: bool,
    upper: bool,
    buffer: u32,
    buffer_step: Mm,
    keep_centerline: bool,
}

impl Style {
    fn for_tags(&self, tags: &Tags) -> Result<EffectiveStyle, String> {
        let stub = Feature {
            element: crate::osm::Element::Tile,
            id: 0,
            tags: tags.clone(),
            geometry: geo::Geometry::Point(Point::new(0.0, 0.0)),
        };
        self.for_feature(&stub)
    }

    fn for_feature(&self, f: &Feature) -> Result<EffectiveStyle, String> {
        let mut eff = EffectiveStyle {
            font: self.font.clone(),
            size: self.size,
            min_size: self.min_size,
            padding: self.padding,
            spacing: self.spacing,
            curved: self.curved,
            upper: self.upper,
            buffer: self.buffer,
            buffer_step: self.buffer_step,
            keep_centerline: self.keep_centerline,
        };
        for rule in &self.rules {
            if select::passes(&rule.tags, f) {
                if let Some(font) = &rule.font {
                    eff.font = font.clone();
                }
                if let Some(size) = rule.size {
                    eff.size = size;
                }
                if let Some(min_size) = rule.min_size {
                    eff.min_size = min_size;
                }
                if let Some(padding) = rule.padding {
                    eff.padding = padding;
                }
                if let Some(spacing) = rule.spacing {
                    eff.spacing = spacing;
                }
                if let Some(curved) = rule.curved {
                    eff.curved = curved;
                }
                if let Some(upper) = rule.upper {
                    eff.upper = upper;
                }
                if let Some(buffer) = rule.buffer {
                    eff.buffer = buffer;
                }
                if let Some(buffer_step) = rule.buffer_step {
                    eff.buffer_step = buffer_step;
                }
                if let Some(keep_centerline) = rule.keep_centerline {
                    eff.keep_centerline = keep_centerline;
                }
                break;
            }
        }
        text::validate_label_font(&eff.font)?;
        Ok(eff)
    }
}

/// Every draw.land font named in `style` must be built in; Google fonts load at run time.
pub fn validate_style(style: &Style) -> Result<(), String> {
    text::validate_label_font(&style.font)?;
    for rule in &style.rules {
        if let Some(font) = &rule.font {
            text::validate_label_font(font)?;
        }
    }
    Ok(())
}

/// Cache keys for Google fonts referenced by this style (`Roboto:400`, …).
pub fn google_font_keys(style: &Style) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(k) = style.font.google_key() {
        keys.push(k);
    }
    for rule in &style.rules {
        if let Some(font) = &rule.font {
            if let Some(k) = font.google_key() {
                keys.push(k);
            }
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

/// Every Google font key any `tools_labels` def in the grammar needs.
pub fn google_font_keys_in_grammar(grammar: &crate::grammar::Grammar) -> Vec<String> {
    let mut keys = Vec::new();
    for def in grammar.all_defs() {
        if let crate::grammar::Op::Labels(l) = &def.op {
            keys.extend(google_font_keys(&l.style));
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

impl Default for Style {
    fn default() -> Style {
        Style {
            font: LabelFont::drawland("futural"),
            size: Mm(2.0),
            min_size: Mm(1.1),
            padding: Mm(0.5),
            spacing: Mm(70.0),
            curved: true,
            upper: false,
            keys: vec!["name".into(), "ref".into()],
            buffer: 0,
            buffer_step: Mm(0.1),
            keep_centerline: true,
            rules: Vec::new(),
        }
    }
}

/// The centre stroke plus `passes` concentric outlines (each pass buffers all strokes by one more step).
fn stroke_with_buffers(strokes: &Lines, passes: u32, step: Mm, keep_center: bool) -> Lines {
    if passes == 0 || step.0 <= 0.0 {
        return strokes.clone();
    }
    let mut out = if keep_center { strokes.clone() } else { Lines::new() };
    for pass in 1..=passes {
        let radius = pass as f64 * step.0;
        let parts: Vec<MultiPolygon<f64>> = strokes.iter().map(|l| geom::buffer_line_round(l, radius)).collect();
        out.extend(geom::rings(&geom::union_multi(&parts)));
    }
    out
}

/// How much a road matters, 0 to 1, by its OpenMapTiles class or OSM `highway`.
fn road_rank(f: &Feature) -> f64 {
    let class = f.tag("class").or_else(|| f.tag("highway")).unwrap_or("");
    let class = class.trim_end_matches("_link");
    match class {
        "motorway" => 1.0,
        "trunk" => 0.9,
        "primary" => 0.8,
        "secondary" => 0.65,
        "tertiary" => 0.5,
        "minor" | "residential" | "unclassified" | "living_street" => 0.3,
        "service" | "busway" => 0.15,
        "rail" | "transit" => 0.2,
        "track" | "path" | "footway" | "cycleway" | "pedestrian" => 0.05,
        _ => 0.3,
    }
}

enum Shape {
    Road(Vec<Coord<f64>>),
    Area(Polygon<f64>),
}

struct Candidate {
    text: String,
    rank: f64,
    /// Length or the square root of the area, mm: the tie-break, larger first.
    extent: f64,
    shape: Shape,
    style: EffectiveStyle,
}

/// A glyph's footprint: four corners, in order.
#[derive(Clone, Copy)]
struct Quad([Coord<f64>; 4]);

impl Quad {
    fn bounds(&self) -> (f64, f64, f64, f64) {
        let xs = self.0.map(|c| c.x);
        let ys = self.0.map(|c| c.y);
        let min = |v: [f64; 4]| v.into_iter().fold(f64::MAX, f64::min);
        let max = |v: [f64; 4]| v.into_iter().fold(f64::MIN, f64::max);
        (min(xs), min(ys), max(xs), max(ys))
    }

    /// Separating axes: two convex quads overlap unless one of their edge
    /// normals splits them.
    fn overlaps(&self, other: &Quad) -> bool {
        for q in [self, other] {
            for i in 0..4 {
                let (a, b) = (q.0[i], q.0[(i + 1) % 4]);
                let n = Coord { x: a.y - b.y, y: b.x - a.x };
                let span = |p: &Quad| {
                    let d = p.0.map(|c| c.x * n.x + c.y * n.y);
                    (d.into_iter().fold(f64::MAX, f64::min), d.into_iter().fold(f64::MIN, f64::max))
                };
                let (a0, a1) = span(self);
                let (b0, b1) = span(other);
                if a1 < b0 || b1 < a0 {
                    return false;
                }
            }
        }
        true
    }

    fn polygon(&self) -> Polygon<f64> {
        Polygon::new(LineString::from(vec![self.0[0], self.0[1], self.0[2], self.0[3], self.0[0]]), vec![])
    }
}

/// The glyph boxes kept so far, bucketed on a grid for the collision test.
struct Taken {
    cell: f64,
    quads: Vec<Quad>,
    grid: HashMap<(i64, i64), Vec<usize>>,
}

impl Taken {
    fn new(cell: f64) -> Taken {
        Taken { cell, quads: Vec::new(), grid: HashMap::new() }
    }

    fn cells(&self, q: &Quad) -> impl Iterator<Item = (i64, i64)> {
        let (x0, y0, x1, y1) = q.bounds();
        let c = self.cell;
        let (i0, i1, j0, j1) = ((x0 / c).floor() as i64, (x1 / c).floor() as i64, (y0 / c).floor() as i64, (y1 / c).floor() as i64);
        (i0..=i1).flat_map(move |i| (j0..=j1).map(move |j| (i, j)))
    }

    fn hits(&self, q: &Quad) -> bool {
        self.cells(q).any(|k| self.grid.get(&k).is_some_and(|ids| ids.iter().any(|&i| self.quads[i].overlaps(q))))
    }

    fn add(&mut self, q: Quad) {
        let i = self.quads.len();
        let cells: Vec<_> = self.cells(&q).collect();
        self.quads.push(q);
        for k in cells {
            self.grid.entry(k).or_default().push(i);
        }
    }
}

/// A polyline walked by arc length.
struct Path {
    pts: Vec<Coord<f64>>,
    at: Vec<f64>,
}

impl Path {
    fn new(pts: Vec<Coord<f64>>) -> Path {
        let mut at = vec![0.0];
        for w in pts.windows(2) {
            at.push(at.last().unwrap() + dist(w[0], w[1]));
        }
        Path { pts, at }
    }

    fn length(&self) -> f64 {
        *self.at.last().unwrap()
    }

    fn point(&self, s: f64) -> Coord<f64> {
        let s = s.clamp(0.0, self.length());
        let i = self.at.partition_point(|&a| a <= s).clamp(1, self.pts.len() - 1);
        let (a, b) = (self.at[i - 1], self.at[i]);
        let t = if b > a { (s - a) / (b - a) } else { 0.0 };
        lerp(self.pts[i - 1], self.pts[i], t)
    }

    /// How far the path between `s0` and `s1` strays from the straight line
    /// joining its ends.
    fn bow(&self, s0: f64, s1: f64) -> f64 {
        let (p0, p1) = (self.point(s0), self.point(s1));
        let d = sub(p1, p0);
        let len = norm(d).max(1e-9);
        self.pts
            .iter()
            .zip(&self.at)
            .filter(|(_, &a)| a > s0 && a < s1)
            .map(|(p, _)| ((p.x - p0.x) * d.y - (p.y - p0.y) * d.x).abs() / len)
            .fold(0.0, f64::max)
    }
}

fn dist(a: Coord<f64>, b: Coord<f64>) -> f64 {
    norm(sub(b, a))
}
fn sub(a: Coord<f64>, b: Coord<f64>) -> Coord<f64> {
    Coord { x: a.x - b.x, y: a.y - b.y }
}
fn norm(a: Coord<f64>) -> f64 {
    a.x.hypot(a.y)
}
fn unit(a: Coord<f64>) -> Coord<f64> {
    let n = norm(a).max(1e-12);
    Coord { x: a.x / n, y: a.y / n }
}
fn lerp(a: Coord<f64>, b: Coord<f64>, t: f64) -> Coord<f64> {
    Coord { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/// One glyph set down: font-unit point `(x, y)` (x from the glyph's left
/// edge) goes to `origin + x·k·u + (y - mid)·k·v`, `v` the text's downward.
struct Pose {
    origin: Coord<f64>,
    u: Coord<f64>,
    k: f64,
}

impl Pose {
    fn v(&self) -> Coord<f64> {
        Coord { x: -self.u.y, y: self.u.x }
    }

    fn map(&self, g: &LabelGlyph, (x, y): (f64, f64)) -> Coord<f64> {
        let v = self.v();
        let mid = (g.top + g.bottom) / 2.0;
        let (a, b) = (x * self.k, (y - mid) * self.k);
        Coord { x: self.origin.x + a * self.u.x + b * v.x, y: self.origin.y + a * self.u.y + b * v.y }
    }

    fn quad(&self, g: &LabelGlyph, pad: f64) -> Quad {
        let p = pad / self.k;
        let (x0, x1, y0, y1) = (-p, g.advance + p, g.top - p, g.bottom + p);
        Quad([
            self.map(g, (x0, y0)),
            self.map(g, (x1, y0)),
            self.map(g, (x1, y1)),
            self.map(g, (x0, y1)),
        ])
    }

    fn strokes(&self, g: &LabelGlyph, out: &mut Lines) {
        for s in &g.strokes {
            out.push(LineString::from(s.iter().map(|&p| self.map(g, p)).collect::<Vec<_>>()));
        }
    }
}

/// The labels of `features` (output millimetres), as pen strokes.
pub fn place(features: &[Feature], frame: &MultiPolygon<f64>, style: &Style, google_fonts: &GoogleFonts) -> Result<Lines, String> {
    validate_style(style)?;
    let page = frame.unsigned_area().max(1.0);
    let mut candidates = Vec::new();
    // Roads come in pieces; one chain per name and class, so a street is one
    // candidate however the data cut it.
    let mut roads: BTreeMap<(String, String), (f64, Lines, Tags)> = BTreeMap::new();
    for f in features {
        let Some(raw) = style.keys.iter().find_map(|k| f.tag(k)).map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        let eff = style.for_feature(f)?;
        let name = if eff.upper { raw.to_uppercase() } else { raw.to_string() };
        let polys = geom::polygons(&f.geometry);
        if let Some(poly) = polys.into_iter().max_by(|a, b| a.unsigned_area().total_cmp(&b.unsigned_area())) {
            let area = poly.unsigned_area();
            let rank = (0.25 + (area / page).sqrt()).min(1.0);
            candidates.push(Candidate {
                text: name,
                rank,
                extent: area.sqrt(),
                shape: Shape::Area(poly),
                style: eff,
            });
        } else {
            let class = f.tag("class").or_else(|| f.tag("highway")).unwrap_or("").to_string();
            let entry = roads.entry((name, class)).or_insert((road_rank(f), Vec::new(), f.tags.clone()));
            entry.1.extend(geom::lines_of(&f.geometry));
        }
    }
    for ((name, _), (rank, lines, tags)) in roads {
        let eff = style.for_tags(&tags)?;
        for chain in geom::linemerge(&lines) {
            let pts: Vec<Coord<f64>> = chain.0;
            if pts.len() < 2 {
                continue;
            }
            let extent = Path::new(pts.clone()).length();
            candidates.push(Candidate { text: name.clone(), rank, extent, shape: Shape::Road(pts), style: eff.clone() });
        }
    }
    candidates.sort_by(|a, b| b.rank.total_cmp(&a.rank).then(b.extent.total_cmp(&a.extent)));

    let max_cap = candidates
        .iter()
        .map(|c| c.style.size.0.max(c.style.min_size.0))
        .fold(style.size.0, f64::max);
    let mut taken = Taken::new(max_cap * 4.0);
    let mut named: HashMap<String, Vec<Coord<f64>>> = HashMap::new();
    let mut out = Lines::new();
    let inside = |q: &Quad| q.0.iter().all(|c| frame.contains(&Point::from(*c)));
    for c in &candidates {
        let eff = &c.style;
        let google_bytes = eff
            .font
            .google_key()
            .and_then(|k| google_fonts.get(&k))
            .map(|b| b.as_slice());
        let layout = text::layout(&eff.font, google_bytes, &c.text)?;
        let (big, small) = (eff.size.0.max(0.1), eff.min_size.0.max(0.1));
        let size = small + (big - small) * c.rank.clamp(0.0, 1.0);
        let k = size / layout.cap_height;
        let glyphs = &layout.glyphs;
        let width = layout.width * k;
        let clear = |poses: &[(Pose, &LabelGlyph)], taken: &Taken| {
            poses.iter().all(|(p, g)| {
                let q = p.quad(g, eff.padding.0);
                inside(&p.quad(g, 0.0)) && !taken.hits(&q)
            })
        };
        let far = |at: Coord<f64>, named: &HashMap<String, Vec<Coord<f64>>>| {
            named.get(&c.text).is_none_or(|seen| seen.iter().all(|&s| dist(s, at) >= eff.spacing.0))
        };
        let keep = |poses: Vec<(Pose, &LabelGlyph)>, at: Coord<f64>, taken: &mut Taken, out: &mut Lines, named: &mut HashMap<String, Vec<Coord<f64>>>| {
            let mut chunk = Lines::new();
            for (p, g) in &poses {
                taken.add(p.quad(g, eff.padding.0));
                p.strokes(g, &mut chunk);
            }
            out.extend(stroke_with_buffers(&chunk, eff.buffer, eff.buffer_step, eff.keep_centerline));
            named.entry(c.text.clone()).or_default().push(at);
        };
        match &c.shape {
            Shape::Road(pts) => {
                let path = Path::new(pts.clone());
                let len = path.length();
                if len < width + size {
                    continue;
                }
                let (lo, hi) = (width / 2.0, len - width / 2.0);
                let step = (width / 4.0).max(size * 2.0);
                let mid = len / 2.0;
                let tries = ((hi - lo) / step).ceil() as i64;
                let mut placed: Vec<f64> = Vec::new();
                // Every straight stretch first; bent text only where none is left.
                let passes: &[bool] = if eff.curved { &[false, true] } else { &[false] };
                for &bend in passes {
                    for i in 0..=2 * tries {
                        let off = ((i + 1) / 2) as f64 * step * if i % 2 == 1 { 1.0 } else { -1.0 };
                        let s = mid + off;
                        if s < lo - 1e-9 || s > hi + 1e-9 {
                            continue;
                        }
                        if placed.iter().any(|&p| (p - s).abs() < eff.spacing.0.max(width + size)) {
                            continue;
                        }
                        let at = path.point(s);
                        if !far(at, &named) {
                            continue;
                        }
                        let Some(poses) = along(&path, s, width, size, k, &glyphs, bend) else { continue };
                        if clear(&poses, &taken) {
                            keep(poses, at, &mut taken, &mut out, &mut named);
                            placed.push(s);
                        }
                    }
                }
            }
            Shape::Area(poly) => {
                let fits = |poses: &[(Pose, &LabelGlyph)]| poses.iter().all(|(p, g)| poly.contains(&p.quad(g, 0.0).polygon()));
                for at in area_spots(poly, width, size) {
                    if !far(at, &named) {
                        continue;
                    }
                    let start = Coord { x: at.x - width / 2.0, y: at.y };
                    let poses: Vec<(Pose, &LabelGlyph)> = glyphs
                        .iter()
                        .map(|g| (Pose { origin: Coord { x: start.x + g.x * k, y: start.y }, u: Coord { x: 1.0, y: 0.0 }, k }, g))
                        .collect();
                    if fits(&poses) && clear(&poses, &taken) {
                        keep(poses, at, &mut taken, &mut out, &mut named);
                        break;
                    }
                }
            }
        }
    }
    Ok(out)
}

/// The glyphs of a label centred at arc length `s` on `path`, or `None` where
/// the road turns too sharply under it to be read.
fn along<'g>(
    path: &Path,
    s: f64,
    width: f64,
    size: f64,
    k: f64,
    glyphs: &'g [LabelGlyph],
    curved: bool,
) -> Option<Vec<(Pose, &'g LabelGlyph)>> {
    let (s0, s1) = (s - width / 2.0, s + width / 2.0);
    let (p0, p1) = (path.point(s0), path.point(s1));
    let d = sub(p1, p0);
    // Read left to right; a road straight up the page reads bottom to top.
    let flip = d.x < -1e-6 || (d.x.abs() <= 1e-6 && d.y > 0.0);
    if path.bow(s0, s1) <= 0.25 * size {
        let (a, b) = if flip { (p1, p0) } else { (p0, p1) };
        let u = unit(sub(b, a));
        return Some(
            glyphs
                .iter()
                .map(|g| (Pose { origin: Coord { x: a.x + g.x * k * u.x, y: a.y + g.x * k * u.y }, u, k }, g))
                .collect(),
        );
    }
    if !curved {
        return None;
    }
    let mut poses = Vec::with_capacity(glyphs.len());
    let mut last: Option<Coord<f64>> = None;
    let mut turned = 0.0;
    for g in glyphs {
        let half = g.advance * k / 2.0;
        let mid = (g.x * k) + half;
        let sign = if flip { -1.0 } else { 1.0 };
        let at = if flip { s1 - mid } else { s0 + mid };
        let reach = half.max(size * 0.8);
        let u = unit(sub(path.point(at + sign * reach), path.point(at - sign * reach)));
        if let Some(prev) = last {
            let turn = (prev.x * u.y - prev.y * u.x).atan2(prev.x * u.x + prev.y * u.y).abs();
            if turn > 35f64.to_radians() {
                return None;
            }
            turned += turn;
        }
        last = Some(u);
        let c = path.point(at);
        poses.push((Pose { origin: Coord { x: c.x - half * u.x, y: c.y - half * u.y }, u, k }, g));
    }
    (turned <= 120f64.to_radians()).then_some(poses)
}

/// Where to try an area's label, best first: its interior point, its centroid,
/// then a grid over it nearest the middle first.
fn area_spots(poly: &Polygon<f64>, width: f64, size: f64) -> Vec<Coord<f64>> {
    let mut spots: Vec<Coord<f64>> = Vec::new();
    let first = poly.interior_point().map(|p| p.0);
    spots.extend(first);
    spots.extend(poly.centroid().map(|p| p.0).filter(|c| poly.contains(&Point::from(*c))));
    let Some(rect) = geo::BoundingRect::bounding_rect(poly) else { return spots };
    let step = (width / 3.0).max(size * 3.0);
    let (nx, ny) = (((rect.width() / step) as usize).min(40), ((rect.height() / step) as usize).min(40));
    let mut grid: Vec<Coord<f64>> = (0..=nx)
        .flat_map(|i| (0..=ny).map(move |j| (i, j)))
        .map(|(i, j)| Coord { x: rect.min().x + i as f64 * step, y: rect.min().y + j as f64 * step })
        .filter(|c| poly.contains(&Point::from(*c)))
        .collect();
    let centre = first.unwrap_or(rect.center());
    grid.sort_by(|a, b| dist(*a, centre).total_cmp(&dist(*b, centre)));
    spots.extend(grid);
    spots
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osm::Element;
    use geo::Geometry;

    fn road(name: &str, class: &str, pts: &[(f64, f64)]) -> Feature {
        Feature {
            element: Element::Tile,
            id: 0,
            tags: [("name", name), ("class", class)].into_iter().map(|(k, v)| (k.into(), v.into())).collect(),
            geometry: Geometry::LineString(LineString::from(pts.to_vec())),
        }
    }

    fn frame() -> MultiPolygon<f64> {
        MultiPolygon::new(vec![geo::Rect::new((0.0, 0.0), (100.0, 100.0)).to_polygon()])
    }

    #[test]
    fn crossing_roads_do_not_overlap() {
        let a = road("Fulton Street", "primary", &[(0.0, 50.0), (100.0, 50.0)]);
        let b = road("Great Avenue", "minor", &[(50.0, 0.0), (50.0, 100.0)]);
        let out = place(&[a, b], &frame(), &Style::default(), &GoogleFonts::new()).unwrap();
        assert!(!out.is_empty());
        // The primary is placed first, on its middle; the avenue is pushed off
        // the crossing.
        let near_cross = out.iter().flat_map(|l| l.0.iter()).filter(|c| (c.x - 50.0).abs() < 1.0 && (c.y - 50.0).abs() > 3.0).count();
        assert!(near_cross > 0, "the avenue is labelled away from the crossing");
    }

    #[test]
    fn text_reads_left_to_right() {
        let a = road("AB", "primary", &[(90.0, 50.0), (10.0, 50.0)]);
        let style = Style { font: LabelFont::drawland("futural"), ..Style::default() };
        let out = place(&[a], &frame(), &style, &GoogleFonts::new()).unwrap();
        // The first stroke drawn is the `A`, left of the `B`.
        let first = out[0].0[0].x;
        let last = out.last().unwrap().0[0].x;
        assert!(first < last);
    }

    #[test]
    fn a_short_road_goes_unlabelled() {
        let a = road("A very long street name", "minor", &[(10.0, 10.0), (14.0, 10.0)]);
        assert!(place(&[a], &frame(), &Style::default(), &GoogleFonts::new()).unwrap().is_empty());
    }
}
