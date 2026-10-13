//! Labels: names written on the map, placed so that none covers another.
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
//!
//! What comes out is geometry, never ink: the pen strokes of the letters, and
//! the shape they cover. A single-stroke font covers nothing until it is
//! buffered; an outline font covers its glyphs, counters left open.

use crate::geom::{self, Lines};
use crate::osm::Feature;
use crate::select::{self, TagTest};
use crate::text::{self, LabelFont, LabelGlyph, LabelLayout};
use crate::units::Mm;
use geo::{Area, Centroid, Contains, Coord, InteriorPoint, LineString, MultiPolygon, Point, Polygon};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{BTreeMap, HashMap};

/// Font file bytes (TTF, OTF or WOFF2) keyed by [`text::google_font_key`].
pub type GoogleFonts = BTreeMap<String, Vec<u8>>;

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
    /// Concentric outlines drawn around each placed name (0 = the strokes only).
    pub buffer: u32,
    /// Half-width added per buffer pass, round caps.
    pub buffer_step: Mm,
    /// When `buffer` > 0, keep the letters' own strokes as well as the outlines.
    pub keep_centerline: bool,
    /// The first rule whose `tags` match wins; its fields override the ones above.
    pub rules: Vec<LabelRule>,
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

/// One user-defined override, for the features whose tags pass `tags` (the
/// tests of `features.where`). Unset fields keep the style's.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabelRule {
    /// When set, labels placed under this rule also land in `labels.<id>` in
    /// the profile (their own `lines` and `area` handles).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(serialize_with = "tags_out", deserialize_with = "tags_in")]
    pub tags: Vec<(String, TagTest)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<LabelFont>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_size: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spacing: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curved: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upper: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer_step: Option<Mm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_centerline: Option<bool>,
}

fn tags_in<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(String, TagTest)>, D::Error> {
    let map = serde_json::Map::deserialize(d)?;
    select::parse_tag_tests(map).map_err(|e| serde::de::Error::custom(format!("rule tags: {e}")))
}

fn tags_out<S: Serializer>(tags: &[(String, TagTest)], s: S) -> Result<S::Ok, S::Error> {
    select::tag_tests_to_map(tags).serialize(s)
}

/// How one feature's label looks: the style, overridden by the first rule
/// its tags pass.
#[derive(Debug, Clone)]
struct Look {
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
    /// The resolved look and, when the matching rule has an `id`, that bucket name.
    fn look(&self, f: &Feature) -> (Look, Option<String>) {
        let none = LabelRule::default();
        let r = self.rules.iter().find(|r| select::passes(&r.tags, f)).unwrap_or(&none);
        let look = Look {
            font: r.font.clone().unwrap_or_else(|| self.font.clone()),
            size: r.size.unwrap_or(self.size),
            min_size: r.min_size.unwrap_or(self.min_size),
            padding: r.padding.unwrap_or(self.padding),
            spacing: r.spacing.unwrap_or(self.spacing),
            curved: r.curved.unwrap_or(self.curved),
            upper: r.upper.unwrap_or(self.upper),
            buffer: r.buffer.unwrap_or(self.buffer),
            buffer_step: r.buffer_step.unwrap_or(self.buffer_step),
            keep_centerline: r.keep_centerline.unwrap_or(self.keep_centerline),
        };
        let bucket = if self.rules.iter().any(|rule| select::passes(&rule.tags, f)) {
            r.id.clone()
        } else {
            None
        };
        (look, bucket)
    }

    /// Every distinct `id` on a rule, in order.
    pub fn rule_ids(&self) -> Vec<String> {
        let mut out = Vec::new();
        for r in &self.rules {
            if let Some(id) = &r.id {
                if !out.iter().any(|x| x == id) {
                    out.push(id.clone());
                }
            }
        }
        out
    }

    /// The style's font and every rule's.
    fn fonts(&self) -> impl Iterator<Item = &LabelFont> {
        std::iter::once(&self.font).chain(self.rules.iter().filter_map(|r| r.font.as_ref()))
    }
}

/// Every draw.land font named in `style` must be built in; Google fonts load at run time.
pub fn validate_style(style: &Style) -> Result<(), String> {
    style.fonts().try_for_each(text::validate_label_font)?;
    let mut seen = std::collections::BTreeSet::new();
    for r in &style.rules {
        if let Some(id) = &r.id {
            if id.is_empty() {
                return Err("labels: rule id is a non-empty name".into());
            }
            if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || id.starts_with(|c: char| c.is_ascii_digit()) {
                return Err(format!("labels: rule id {:?} is not a name (letters, digits, underscore)", id));
            }
            if !seen.insert(id.clone()) {
                return Err(format!("labels: duplicate rule id {:?}", id));
            }
        }
    }
    Ok(())
}

/// Every Google font key any `tools_labels` def in the grammar needs (`Roboto:400`, …).
pub fn google_font_keys_in_grammar(grammar: &crate::grammar::Grammar) -> Vec<String> {
    use crate::grammar::Op;
    let mut keys: Vec<String> = grammar
        .all_defs()
        .flat_map(|def| match &def.op {
            Op::Labels(l) => l.style.fonts().filter_map(LabelFont::google_key).collect::<Vec<_>>(),
            Op::Text(t) | Op::TextArea(t) => t.font.google_key().into_iter().collect(),
            _ => vec![],
        })
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

/// The labels as placed: the pen strokes of their letters, and what each
/// label covers.
#[derive(Debug, Clone, Default)]
struct Bucket {
    lines: Lines,
    shapes: Vec<MultiPolygon<f64>>,
}

#[derive(Debug, Clone, Default)]
pub struct Placed {
    /// Every label's strokes together.
    pub lines: Lines,
    /// One filled silhouette per label (counters open) for hatch inside letters.
    pub shapes: Vec<MultiPolygon<f64>>,
    /// Solid footprint per label for masking fills below: the silhouette with
    /// counters closed, so the hole follows the letters rather than a box.
    pub mask: Vec<MultiPolygon<f64>>,
    /// Labels whose matching rule had an `id`.
    pub buckets: BTreeMap<String, Bucket>,
}

impl Placed {
    /// What every label covers together when subtracting ink below it.
    pub fn area(&self) -> MultiPolygon<f64> {
        if !self.mask.is_empty() {
            return geom::union_multi(&self.mask);
        }
        geom::union_multi(&self.shapes)
    }

    pub fn lines_for(&self, rule: Option<&str>) -> Lines {
        match rule {
            None => self.lines.clone(),
            Some(id) => self.buckets.get(id).map(|b| b.lines.clone()).unwrap_or_default(),
        }
    }

    pub fn area_for(&self, rule: Option<&str>) -> MultiPolygon<f64> {
        match rule {
            None => self.area(),
            Some(id) => self
                .buckets
                .get(id)
                .map(|b| geom::union_multi(&b.shapes))
                .unwrap_or_else(geom::empty),
        }
    }
}

/// `strokes` with `passes` concentric outlines around them (each pass buffers
/// them all by one more step), and the area inside the outermost one.
fn buffered(strokes: Lines, passes: u32, step: Mm, keep_strokes: bool) -> (Lines, MultiPolygon<f64>) {
    if passes == 0 || step.0 <= 0.0 {
        return (strokes, geom::empty());
    }
    let mut out = if keep_strokes { strokes.clone() } else { Lines::new() };
    let mut outer = geom::empty();
    for pass in 1..=passes {
        let radius = pass as f64 * step.0;
        let parts: Vec<MultiPolygon<f64>> = strokes.iter().map(|l| geom::buffer_line_round(l, radius)).collect();
        outer = geom::union_multi(&parts);
        out.extend(geom::rings(&outer));
    }
    (out, outer)
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

fn pin_rank(f: &Feature) -> f64 {
    let layer = f.tag("tiles:layer").unwrap_or("");
    let class = f.tag("class").unwrap_or("");
    if layer == "place" {
        return match class {
            "city" => 1.0,
            "town" => 0.85,
            "suburb" => 0.55,
            "neighbourhood" | "neighborhood" => 0.5,
            "quarter" => 0.45,
            "island" => 0.4,
            "hamlet" | "village" => 0.35,
            _ => 0.3,
        };
    }
    if layer == "poi" {
        return 0.25;
    }
    0.2
}

enum Shape {
    Road(Vec<Coord<f64>>),
    Area(Polygon<f64>),
    Pin(Coord<f64>),
}

struct Candidate {
    text: String,
    rank: f64,
    /// Length or the square root of the area, mm: the tie-break, larger first.
    extent: f64,
    shape: Shape,
    look: Look,
    /// The matching rule's `id`, when it has one.
    rule: Option<String>,
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

/// One glyph of a layout set down: font-unit point `(x, y)` (x from the
/// glyph's left edge) goes to `origin + x·k·u + (y - mid)·k·v`, `v` the text's
/// downward and `mid` the middle of the layout's line.
struct Pose {
    glyph: usize,
    origin: Coord<f64>,
    u: Coord<f64>,
    k: f64,
}

impl Pose {
    fn v(&self) -> Coord<f64> {
        Coord { x: -self.u.y, y: self.u.x }
    }

    fn map(&self, layout: &LabelLayout, (x, y): (f64, f64)) -> Coord<f64> {
        let v = self.v();
        let mid = (layout.top + layout.bottom) / 2.0;
        let (a, b) = (x * self.k, (y - mid) * self.k);
        Coord { x: self.origin.x + a * self.u.x + b * v.x, y: self.origin.y + a * self.u.y + b * v.y }
    }

    fn quad(&self, layout: &LabelLayout, pad: f64) -> Quad {
        let p = pad / self.k;
        let advance = layout.glyphs[self.glyph].advance;
        let (x0, x1, y0, y1) = (-p, advance + p, layout.top - p, layout.bottom + p);
        Quad([
            self.map(layout, (x0, y0)),
            self.map(layout, (x1, y0)),
            self.map(layout, (x1, y1)),
            self.map(layout, (x0, y1)),
        ])
    }

    fn strokes(&self, layout: &LabelLayout) -> Lines {
        layout.glyphs[self.glyph]
            .strokes
            .iter()
            .map(|s| LineString::from(s.iter().map(|&p| self.map(layout, p)).collect::<Vec<_>>()))
            .collect()
    }
}

/// The labels of `features` (output millimetres).
pub fn place(features: &[Feature], frame: &MultiPolygon<f64>, style: &Style, google_fonts: &GoogleFonts) -> Result<Placed, String> {
    validate_style(style)?;
    // Each font file decoded once, not once per label.
    let mut faces: HashMap<String, Vec<u8>> = HashMap::new();
    for key in style.fonts().filter_map(LabelFont::google_key) {
        if let Some(bytes) = google_fonts.get(&key) {
            faces.insert(key, crate::google_fonts::decode_font_bytes(bytes)?);
        }
    }
    let page = frame.unsigned_area().max(1.0);
    let mut candidates = Vec::new();
    // Roads come in pieces; one chain per name and class, so a street is one
    // candidate however the data cut it.
    let mut roads: BTreeMap<(String, String), (f64, Lines, Look, Option<String>)> = BTreeMap::new();
    for f in features {
        let Some(raw) = style.keys.iter().find_map(|k| f.tag(k)).map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        let (look, rule) = style.look(f);
        let name = if look.upper { raw.to_uppercase() } else { raw.to_string() };
        let polys = geom::polygons(&f.geometry);
        if let Some(poly) = polys.into_iter().max_by(|a, b| a.unsigned_area().total_cmp(&b.unsigned_area())) {
            let area = poly.unsigned_area();
            let rank = (0.25 + (area / page).sqrt()).min(1.0);
            candidates.push(Candidate { text: name, rank, extent: area.sqrt(), shape: Shape::Area(poly), look, rule });
        } else if let geo::Geometry::Point(p) = &f.geometry {
            let rank = pin_rank(f);
            candidates.push(Candidate { text: name, rank, extent: 1.0, shape: Shape::Pin(p.0), look, rule });
        } else {
            let class = f.tag("class").or_else(|| f.tag("highway")).unwrap_or("").to_string();
            let entry = roads.entry((name, class)).or_insert_with(|| (road_rank(f), Vec::new(), look, rule));
            entry.1.extend(geom::lines_of(&f.geometry));
        }
    }
    for ((name, _), (rank, lines, look, rule)) in roads {
        for chain in geom::linemerge(&lines) {
            let pts: Vec<Coord<f64>> = chain.0;
            if pts.len() < 2 {
                continue;
            }
            let extent = Path::new(pts.clone()).length();
            candidates.push(Candidate {
                text: name.clone(),
                rank,
                extent,
                shape: Shape::Road(pts),
                look: look.clone(),
                rule: rule.clone(),
            });
        }
    }
    candidates.sort_by(|a, b| b.rank.total_cmp(&a.rank).then(b.extent.total_cmp(&a.extent)));

    let max_cap = candidates.iter().map(|c| c.look.size.0.max(c.look.min_size.0)).fold(style.size.0, f64::max);
    let mut taken = Taken::new(max_cap * 4.0);
    let mut named: HashMap<String, Vec<Coord<f64>>> = HashMap::new();
    let mut out = Placed::default();
    let inside = |q: &Quad| q.0.iter().all(|c| frame.contains(&Point::from(*c)));
    for c in &candidates {
        let look = &c.look;
        let bytes = look.font.google_key().and_then(|k| faces.get(&k)).map(Vec::as_slice);
        let layout = text::layout(&look.font, bytes, &c.text)?;
        let (big, small) = (look.size.0.max(0.1), look.min_size.0.max(0.1));
        let size = small + (big - small) * c.rank.clamp(0.0, 1.0);
        let k = size / layout.cap_height;
        let width = layout.width * k;
        let clear = |poses: &[Pose], taken: &Taken| {
            poses.iter().all(|p| inside(&p.quad(&layout, 0.0)) && !taken.hits(&p.quad(&layout, look.padding.0)))
        };
        let far = |at: Coord<f64>, named: &HashMap<String, Vec<Coord<f64>>>| {
            named.get(&c.text).is_none_or(|seen| seen.iter().all(|&s| dist(s, at) >= look.spacing.0))
        };
        let bucket = c.rule.clone();
        let keep = |poses: Vec<Pose>, at: Coord<f64>, taken: &mut Taken, out: &mut Placed, named: &mut HashMap<String, Vec<Coord<f64>>>| {
            let mut strokes = Lines::new();
            let mut glyphs = Vec::new();
            for p in &poses {
                taken.add(p.quad(&layout, look.padding.0));
                let s = p.strokes(&layout);
                if layout.outline {
                    // The pen traces the letter's edge, not the contours it
                    // was built from: those overlap inside the letter.
                    let shape = text::glyph_silhouette(&s);
                    strokes.extend(geom::rings(&shape));
                    glyphs.push(shape);
                } else {
                    strokes.extend(s);
                }
            }
            let (lines, outer) = buffered(strokes, look.buffer, look.buffer_step, look.keep_centerline);
            out.lines.extend(lines.clone());
            glyphs.push(outer);
            let silhouette = geom::union_multi(&glyphs);
            let mask = if layout.outline {
                geom::fill_holes(&silhouette)
            } else {
                silhouette.clone()
            };
            if !silhouette.0.is_empty() {
                out.shapes.push(silhouette.clone());
            }
            if !mask.0.is_empty() {
                out.mask.push(mask);
            }
            if let Some(id) = &bucket {
                let b = out.buckets.entry(id.clone()).or_default();
                b.lines.extend(lines);
                if !silhouette.0.is_empty() {
                    b.shapes.push(silhouette);
                }
            }
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
                let passes: &[bool] = if look.curved { &[false, true] } else { &[false] };
                for &bend in passes {
                    for i in 0..=2 * tries {
                        let off = ((i + 1) / 2) as f64 * step * if i % 2 == 1 { 1.0 } else { -1.0 };
                        let s = mid + off;
                        if s < lo - 1e-9 || s > hi + 1e-9 {
                            continue;
                        }
                        if placed.iter().any(|&p| (p - s).abs() < look.spacing.0.max(width + size)) {
                            continue;
                        }
                        let at = path.point(s);
                        if !far(at, &named) {
                            continue;
                        }
                        let Some(poses) = along(&path, s, width, size, k, &layout.glyphs, bend) else { continue };
                        if clear(&poses, &taken) {
                            keep(poses, at, &mut taken, &mut out, &mut named);
                            placed.push(s);
                        }
                    }
                }
            }
            Shape::Area(poly) => {
                let fits = |poses: &[Pose]| poses.iter().all(|p| poly.contains(&p.quad(&layout, 0.0).polygon()));
                for at in area_spots(poly, width, size) {
                    if !far(at, &named) {
                        continue;
                    }
                    let poses = horizontal_label(&layout, at, width, k);
                    if fits(&poses) && clear(&poses, &taken) {
                        keep(poses, at, &mut taken, &mut out, &mut named);
                        break;
                    }
                }
            }
            Shape::Pin(at) => {
                if !frame.contains(&Point::from(*at)) || !far(*at, &named) {
                    continue;
                }
                let poses = horizontal_label(&layout, *at, width, k);
                if clear(&poses, &taken) {
                    keep(poses, *at, &mut taken, &mut out, &mut named);
                }
            }
        }
    }
    Ok(out)
}

/// The glyphs of a label centred at arc length `s` on `path`, or `None` where
/// the road turns too sharply under it to be read.
fn along(path: &Path, s: f64, width: f64, size: f64, k: f64, glyphs: &[LabelGlyph], curved: bool) -> Option<Vec<Pose>> {
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
                .enumerate()
                .map(|(glyph, g)| Pose { glyph, origin: Coord { x: a.x + g.x * k * u.x, y: a.y + g.x * k * u.y }, u, k })
                .collect(),
        );
    }
    if !curved {
        return None;
    }
    let mut poses = Vec::with_capacity(glyphs.len());
    let mut last: Option<Coord<f64>> = None;
    let mut turned = 0.0;
    for (glyph, g) in glyphs.iter().enumerate() {
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
        poses.push(Pose { glyph, origin: Coord { x: c.x - half * u.x, y: c.y - half * u.y }, u, k });
    }
    (turned <= 120f64.to_radians()).then_some(poses)
}

fn horizontal_label(layout: &LabelLayout, at: Coord<f64>, width: f64, k: f64) -> Vec<Pose> {
    let start = Coord { x: at.x - width / 2.0, y: at.y };
    (0..layout.glyphs.len())
        .map(|i| Pose {
            glyph: i,
            origin: Coord { x: start.x + layout.glyphs[i].x * k, y: start.y },
            u: Coord { x: 1.0, y: 0.0 },
            k,
        })
        .collect()
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

    fn park(name: &str) -> Feature {
        Feature {
            element: Element::Tile,
            id: 0,
            tags: [("name", name), ("tiles:layer", "park")]
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
            geometry: Geometry::Polygon(geo::Rect::new((10.0, 10.0), (90.0, 90.0)).to_polygon()),
        }
    }

    fn frame() -> MultiPolygon<f64> {
        MultiPolygon::new(vec![geo::Rect::new((0.0, 0.0), (100.0, 100.0)).to_polygon()])
    }

    #[test]
    fn crossing_roads_do_not_overlap() {
        let a = road("Fulton Street", "primary", &[(0.0, 50.0), (100.0, 50.0)]);
        let b = road("Great Avenue", "minor", &[(50.0, 0.0), (50.0, 100.0)]);
        let out = place(&[a, b], &frame(), &Style::default(), &GoogleFonts::new()).unwrap().lines;
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
        let out = place(&[a], &frame(), &style, &GoogleFonts::new()).unwrap().lines;
        // The first stroke drawn is the `A`, left of the `B`.
        let first = out[0].0[0].x;
        let last = out.last().unwrap().0[0].x;
        assert!(first < last);
    }

    #[test]
    fn a_short_road_goes_unlabelled() {
        let a = road("A very long street name", "minor", &[(10.0, 10.0), (14.0, 10.0)]);
        assert!(place(&[a], &frame(), &Style::default(), &GoogleFonts::new()).unwrap().lines.is_empty());
    }

    #[test]
    fn rule_ids_split_lines_and_area() {
        let style: Style = serde_json::from_value(serde_json::json!({
            "rules": [{ "id": "park", "tags": { "tiles:layer": "park" }, "size": "8mm", "min_size": "8mm" }],
        }))
        .unwrap();
        let placed = place(&[park("Lake")], &frame(), &style, &GoogleFonts::new()).unwrap();
        let bucket = placed.buckets.get("park").expect("park bucket");
        assert!(!bucket.lines.is_empty());
        assert_eq!(placed.lines.len(), bucket.lines.len());
    }

    #[test]
    fn a_single_stroke_label_covers_something_only_when_buffered() {
        let plain = place(&[park("Lake")], &frame(), &Style::default(), &GoogleFonts::new()).unwrap();
        assert!(!plain.lines.is_empty());
        assert!(plain.area().0.is_empty());

        let style = Style { buffer: 2, keep_centerline: false, ..Style::default() };
        let thick = place(&[park("Lake")], &frame(), &style, &GoogleFonts::new()).unwrap();
        let area = thick.area();
        assert!(!area.0.is_empty());
        // Every outline lies on or inside the outermost one.
        let grown = geom::buffer(&area, 1e-6);
        assert!(thick.lines.iter().flat_map(|l| l.0.iter()).all(|c| grown.contains(&Point::from(*c))));
    }

    #[test]
    fn rules_override_the_style_and_reject_unknown_keys() {
        let style: Style = serde_json::from_value(serde_json::json!({
            "size": "2mm",
            "rules": [{ "tags": { "class": ["primary"] }, "size": "3mm", "buffer": 1 }],
        }))
        .unwrap();
        let back: Style = serde_json::from_value(serde_json::to_value(&style).unwrap()).unwrap();
        assert_eq!(back, style);
        let (look, bucket) = style.look(&road("A", "primary", &[(0.0, 0.0), (1.0, 0.0)]));
        assert_eq!((look.size, look.buffer), (Mm(3.0), 1));
        assert!(bucket.is_none());
        let (look, _) = style.look(&road("A", "minor", &[(0.0, 0.0), (1.0, 0.0)]));
        assert_eq!((look.size, look.buffer), (Mm(2.0), 0));
        let e = serde_json::from_value::<Style>(serde_json::json!({
            "rules": [{ "tags": { "class": "park" }, "fill": { "pattern": "lines" } }],
        }));
        assert!(e.is_err());
    }

    /// A TrueType face from the system, for the outline tests; they are
    /// skipped where there is none.
    fn system_face() -> Option<(LabelFont, GoogleFonts)> {
        let bytes = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
            .iter()
            .find_map(|p| std::fs::read(p).ok())?;
        let font: LabelFont = serde_json::from_value(serde_json::json!({ "origin": "google", "family": "Test" })).unwrap();
        let fonts = GoogleFonts::from([(font.google_key().unwrap(), bytes)]);
        Some((font, fonts))
    }

    fn assert_glyphs_merge(font: LabelFont, bytes: &[u8], sample: &str) {
        let layout = text::layout(&font, Some(bytes), sample).unwrap();
        assert!(layout.outline);
        for (ch, g) in sample.chars().zip(&layout.glyphs) {
            if g.strokes.is_empty() {
                continue;
            }
            let contours: Lines = g
                .strokes
                .iter()
                .map(|s| LineString::from(s.iter().map(|&(x, y)| Coord { x, y }).collect::<Vec<_>>()))
                .collect();
            let parts = text::glyph_silhouette(&contours).0.len();
            let disjoint = ch == 'i' || ch == 'j';
            assert!(
                disjoint || parts <= 1,
                "'{ch}' should be one merged body, got {parts} parts from {} contours",
                g.strokes.len()
            );
        }
    }

    #[test]
    fn outline_glyph_overlapping_contours_merge_to_one_silhouette() {
        let Some((font, fonts)) = system_face() else { return };
        let bytes = fonts.values().next().unwrap();
        assert_glyphs_merge(font, bytes, "adng");
    }

    /// Google's Roboto (`fonts.gstatic.com`, the file the page downloads), a
    /// variable font whose contours overlap, `P` and `e` each within itself.
    /// Skipped unless it is at `/tmp/roboto.ttf`.
    #[test]
    fn roboto_glyphs_are_one_body_each_with_their_counters() {
        let Ok(bytes) = std::fs::read("/tmp/roboto.ttf") else { return };
        let font: LabelFont = serde_json::from_value(serde_json::json!({ "origin": "google", "family": "Roboto" })).unwrap();
        assert_glyphs_merge(font.clone(), &bytes, "Lands End");
        let sample = "LandsEOPeg";
        let counters = [0, 1, 0, 1, 0, 0, 1, 1, 1, 1];
        let layout = text::layout(&font, Some(&bytes), sample).unwrap();
        for ((ch, g), want) in sample.chars().zip(&layout.glyphs).zip(counters) {
            let contours: Lines = g
                .strokes
                .iter()
                .map(|s| LineString::from(s.iter().map(|&(x, y)| Coord { x, y }).collect::<Vec<_>>()))
                .collect();
            let shape = text::glyph_silhouette(&contours);
            assert_eq!(shape.0.len(), 1, "'{ch}' is one body");
            assert_eq!(shape.0[0].interiors().len(), want, "'{ch}' counters");
        }

        // The pen draws each letter's edge once: one ring per body and counter.
        let fonts = GoogleFonts::from([(font.google_key().unwrap(), bytes)]);
        let style = Style { font, size: Mm(6.0), min_size: Mm(6.0), ..Style::default() };
        let placed = place(&[park(sample)], &frame(), &style, &fonts).unwrap();
        assert_eq!(placed.lines.len(), sample.len() + counters.iter().sum::<usize>());
    }

    #[test]
    fn an_outline_font_covers_its_glyphs_with_the_counters_open() {
        let Some((font, fonts)) = system_face() else { return };
        let style = Style { font, size: Mm(6.0), min_size: Mm(6.0), ..Style::default() };
        let placed = place(&[park("OPg")], &frame(), &style, &fonts).unwrap();
        assert!(!placed.lines.is_empty(), "the contours are drawn");
        let ink = geom::union_multi(&placed.shapes);
        assert_eq!(ink.0.len(), 3);
        assert!(ink.0.iter().all(|p| p.interiors().len() == 1));
        // Mask below labels is each letter, solid: counters closed, no box.
        let mask = placed.area();
        assert_eq!(mask.0.len(), 3);
        assert!(mask.0.iter().all(|p| p.interiors().is_empty()));
        assert!((mask.unsigned_area() - geom::fill_holes(&ink).unsigned_area()).abs() < 1e-6);
        // One baseline: the `g` hangs below the capitals, whose bottoms line up.
        let bottom = |p: &Polygon<f64>| p.exterior().0.iter().map(|c| c.y).fold(f64::MIN, f64::max);
        let mut polys = ink.0.clone();
        polys.sort_by(|a, b| a.centroid().unwrap().x().total_cmp(&b.centroid().unwrap().x()));
        assert!((bottom(&polys[0]) - bottom(&polys[1])).abs() < 0.2);
        assert!(bottom(&polys[2]) > bottom(&polys[0]) + 0.5);
    }
}
