//! Single-stroke (Hershey) fonts: text as pen strokes, the kind CNC engravers
//! and plotters draw in one pass, with no outline to fill.
//!
//! A `.jhf` file holds one glyph per line, in ASCII order from the space:
//! a 5-digit number, a 3-digit count of coordinate pairs, then the pairs, each
//! two characters offset from `R`. The first pair is the glyph's left and right
//! edge; ` R` lifts the pen. Coordinates are y down, the baseline at 9 and the
//! capitals' top at -12.
//!
//! The glyphs are Dr. A. V. Hershey's, U.S. National Bureau of Standards,
//! whose terms ask that this acknowledgement travel with them.
//!
//! Outline fonts (Google Fonts and similar) are traced as closed contours for
//! the plotter; see [`layout`].

use crate::geom::{self, Lines};
use geo::{Area, Coord, LineString, MultiPolygon, Polygon};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Where the capitals start and end, in font units (y down).
pub const CAP_TOP: f64 = -12.0;
pub const BASELINE: f64 = 9.0;
/// Capital height, font units: `size` in millimetres is this tall.
pub const CAP_HEIGHT: f64 = BASELINE - CAP_TOP;

#[derive(Debug, Clone)]
pub struct Glyph {
    pub left: f64,
    pub right: f64,
    /// Pen-down runs, font units, relative to the glyph's own origin.
    pub strokes: Vec<Vec<(f64, f64)>>,
}

impl Glyph {
    pub fn advance(&self) -> f64 {
        self.right - self.left
    }
}

#[derive(Debug)]
pub struct Font {
    glyphs: Vec<Glyph>,
}

/// Built-in stroke font ids (no download). Catalog ids (`ems-readability`, …) load at run time.
pub const FONTS: &[&str] = crate::stroke_font::BUILTIN_STROKE_IDS;

pub fn font(name: &str) -> Option<&'static Font> {
    static FUTURAL: OnceLock<Font> = OnceLock::new();
    match name {
        "futural" => Some(FUTURAL.get_or_init(|| {
            Font::parse(include_str!("../fonts/futural.jhf")).expect("the built-in futural font parses")
        })),
        _ => None,
    }
}

/// Which font draws a label: draw.land's single-stroke fonts or a Google outline font.
#[derive(Debug, Clone, PartialEq)]
pub enum LabelFont {
    /// Built-in Hershey id, e.g. `"futural"`.
    Drawland(String),
    /// `{ origin: "drawland" | "google", … }`.
    Origin(LabelFontOrigin),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "origin", rename_all = "lowercase")]
pub enum LabelFontOrigin {
    Drawland {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    /// Single-stroke SVG or JHF font from a URL (`fetch` in the browser / CLI).
    Stroke { url: String },
    Google {
        family: String,
        #[serde(default = "default_google_weight", deserialize_with = "deserialize_font_weight")]
        weight: u32,
        #[serde(default)]
        italic: bool,
    },
}

fn deserialize_font_weight<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_f64().map(|f| f.round() as u64))
            .ok_or_else(|| serde::de::Error::custom("google font weight"))
            .map(|w| w as u32),
        _ => Err(serde::de::Error::custom("google font weight")),
    }
}

impl Serialize for LabelFont {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            LabelFont::Drawland(id) => id.serialize(s),
            LabelFont::Origin(o) => o.serialize(s),
        }
    }
}

impl<'de> Deserialize<'de> for LabelFont {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        match v {
            serde_json::Value::String(id) => Ok(LabelFont::Drawland(id)),
            serde_json::Value::Object(o) => {
                let origin = LabelFontOrigin::deserialize(serde_json::Value::Object(o)).map_err(serde::de::Error::custom)?;
                Ok(LabelFont::Origin(origin))
            }
            _ => Err(serde::de::Error::custom("labels font: string id or { origin, … }")),
        }
    }
}

fn default_google_weight() -> u32 {
    400
}

impl LabelFont {
    pub fn drawland(id: impl Into<String>) -> LabelFont {
        LabelFont::Drawland(id.into())
    }

    pub fn drawland_id(&self) -> Option<&str> {
        match self {
            LabelFont::Drawland(s) => Some(s),
            LabelFont::Origin(LabelFontOrigin::Drawland { id, .. }) => Some(id),
            LabelFont::Origin(LabelFontOrigin::Google { .. }) | LabelFont::Origin(LabelFontOrigin::Stroke { .. }) => None,
        }
    }

    /// URL whose bytes must be supplied in [`stroke_font_keys_in_grammar`] / `Inputs.stroke_fonts`.
    pub fn stroke_font_key(&self) -> Option<String> {
        match self {
            LabelFont::Drawland(id) => stroke_key_for_id(id, None),
            LabelFont::Origin(LabelFontOrigin::Drawland { id, url }) => stroke_key_for_id(id, url.as_deref()),
            LabelFont::Origin(LabelFontOrigin::Stroke { url }) => Some(url.clone()),
            _ => None,
        }
    }

    pub fn google_spec(&self) -> Option<(&str, u32, bool)> {
        match self {
            LabelFont::Origin(LabelFontOrigin::Google { family, weight, italic }) => Some((family.as_str(), *weight, *italic)),
            _ => None,
        }
    }

    /// Cache key for downloaded TTF bytes (`Roboto:400` or `Roboto:400:italic`).
    pub fn google_key(&self) -> Option<String> {
        self.google_spec().map(|(family, weight, italic)| google_font_key(family, weight, italic))
    }
}

pub fn google_font_key(family: &str, weight: u32, italic: bool) -> String {
    if italic {
        format!("{}:{}:italic", family, weight)
    } else {
        format!("{}:{}", family, weight)
    }
}

/// The family, weight and italic flag encoded in [`google_font_key`].
pub fn parse_google_font_key(key: &str) -> Option<(String, u32, bool)> {
    let mut parts = key.split(':').collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }
    let italic = parts.last() == Some(&"italic");
    if italic {
        parts.pop();
    }
    let weight = parts[1].parse().ok()?;
    Some((parts[0].to_string(), weight, italic))
}

impl Default for LabelFont {
    fn default() -> LabelFont {
        LabelFont::drawland("futural")
    }
}

/// One glyph in a laid-out string, in font units (y down, x from the string's left).
#[derive(Debug, Clone)]
pub struct LabelGlyph {
    pub x: f64,
    pub advance: f64,
    pub strokes: Vec<Vec<(f64, f64)>>,
}

/// A line of text in font units: glyphs and total width; `cap_height` scales to millimetres.
#[derive(Debug, Clone)]
pub struct LabelLayout {
    pub glyphs: Vec<LabelGlyph>,
    pub width: f64,
    pub cap_height: f64,
    /// The line every glyph sits in, y down: the same for all of them, so
    /// they share a baseline.
    pub top: f64,
    pub bottom: f64,
    /// The strokes are closed contours that enclose the letter (an outline
    /// font), not pen paths.
    pub outline: bool,
}

/// Lay out `text` with a draw.land or Google font. Google needs the TTF/OTF
/// bytes of that face (see [`crate::google_fonts::decode_font_bytes`]).
/// Stroke fonts need the file at [`LabelFont::stroke_font_key`] in `stroke_bytes`.
pub fn layout(
    label_font: &LabelFont,
    google_bytes: Option<&[u8]>,
    stroke_bytes: Option<&[u8]>,
    text: &str,
) -> Result<LabelLayout, String> {
    if let Some((family, weight, italic)) = label_font.google_spec() {
        let bytes = google_bytes.ok_or_else(|| {
            format!(
                "labels: google font {:?} ({}) was not loaded",
                family,
                google_font_key(family, weight, italic)
            )
        })?;
        return layout_google(bytes, text);
    }
    if label_font.stroke_font_key().is_some() || label_font.drawland_id().is_some() {
        return layout_stroke_font(label_font, stroke_bytes, text);
    }
    Err("labels: font has no origin".into())
}

pub fn validate_label_font(label_font: &LabelFont) -> Result<(), String> {
    match label_font {
        LabelFont::Drawland(id) => validate_stroke_id(id, None),
        LabelFont::Origin(LabelFontOrigin::Drawland { id, url }) => validate_stroke_id(id, url.as_deref()),
        LabelFont::Origin(LabelFontOrigin::Stroke { url }) => {
            if url.is_empty() {
                return Err("labels: stroke font url is non-empty".into());
            }
            Ok(())
        }
        LabelFont::Origin(LabelFontOrigin::Google { .. }) => Ok(()),
    }
}

fn validate_stroke_id(id: &str, url: Option<&str>) -> Result<(), String> {
    if id == "futural" || url.is_some() || crate::stroke_font::catalog_url(id).is_some() {
        return Ok(());
    }
    Err(format!(
        "labels: unknown drawland font {:?} (built in: {}; catalog: ems-readability, ems-swiss, or pass url)",
        id,
        FONTS.join(", ")
    ))
}

fn stroke_key_for_id(id: &str, url: Option<&str>) -> Option<String> {
    if let Some(u) = url.filter(|s| !s.is_empty()) {
        return Some(u.to_string());
    }
    if id == "futural" {
        return None;
    }
    crate::stroke_font::catalog_url(id).map(str::to_string)
}

fn layout_stroke_font(label_font: &LabelFont, stroke_bytes: Option<&[u8]>, text: &str) -> Result<LabelLayout, String> {
    let fallback = crate::stroke_font::StrokeFont::futural();
    if matches!(
        label_font,
        LabelFont::Drawland(id) if id == "futural",
    ) || matches!(
        label_font,
        LabelFont::Origin(LabelFontOrigin::Drawland { id, .. }) if id == "futural",
    ) {
        return stroke_layout_to_label(crate::stroke_font::layout_stroke(fallback, fallback, text));
    }
    let key = label_font
        .stroke_font_key()
        .ok_or_else(|| "labels: stroke font has no load key".to_string())?;
    let bytes = stroke_bytes.ok_or_else(|| format!("labels: stroke font {:?} was not loaded", key))?;
    let primary = crate::stroke_font::parse_stroke_font_bytes(bytes)?;
    stroke_layout_to_label(crate::stroke_font::layout_stroke(&primary, fallback, text))
}

fn stroke_layout_to_label(sl: crate::stroke_font::StrokeLabelLayout) -> Result<LabelLayout, String> {
    Ok(LabelLayout {
        glyphs: sl
            .glyphs
            .into_iter()
            .map(|g| LabelGlyph { x: g.x, advance: g.advance, strokes: g.strokes })
            .collect(),
        width: sl.width,
        cap_height: sl.cap_height,
        top: sl.top,
        bottom: sl.bottom,
        outline: false,
    })
}

impl Font {
    pub fn parse(src: &str) -> Result<Font, String> {
        let mut glyphs = Vec::new();
        for (i, line) in src.lines().enumerate() {
            let line = line.trim_end();
            if line.is_empty() {
                continue;
            }
            let b = line.as_bytes();
            if b.len() < 10 {
                return Err(format!("line {}: too short for a glyph", i + 1));
            }
            let count: usize = line[5..8]
                .trim()
                .parse()
                .map_err(|_| format!("line {}: bad coordinate count {:?}", i + 1, &line[5..8]))?;
            let body = &b[8..];
            if body.len() < count * 2 {
                return Err(format!("line {}: {} pairs announced, {} found", i + 1, count, body.len() / 2));
            }
            let at = |k: usize| (body[2 * k] as f64 - b'R' as f64, body[2 * k + 1] as f64 - b'R' as f64);
            let (left, right) = at(0);
            let mut strokes = Vec::new();
            let mut run: Vec<(f64, f64)> = Vec::new();
            for k in 1..count {
                if body[2 * k] == b' ' && body[2 * k + 1] == b'R' {
                    if run.len() > 1 {
                        strokes.push(std::mem::take(&mut run));
                    }
                    run.clear();
                } else {
                    let (x, y) = at(k);
                    run.push((x - left, y));
                }
            }
            if run.len() > 1 {
                strokes.push(run);
            }
            glyphs.push(Glyph { left, right, strokes });
        }
        if glyphs.len() < 95 {
            return Err(format!("{} glyphs, expected the 95 printable ASCII ones", glyphs.len()));
        }
        Ok(Font { glyphs })
    }

    /// The glyph for `c`, `?` for anything the font does not have. Accented
    /// letters are drawn bare.
    pub fn glyph(&self, c: char) -> &Glyph {
        let c = fold(c);
        let i = (c as u32).wrapping_sub(32) as usize;
        self.glyphs.get(i).filter(|_| (' '..='~').contains(&c)).unwrap_or(&self.glyphs['?' as usize - 32])
    }

    /// `text` laid out on one line: each glyph with where it starts, and the
    /// whole width, font units.
    pub fn layout(&self, text: &str) -> (Vec<(f64, &Glyph)>, f64) {
        let mut x = 0.0;
        let mut out = Vec::new();
        for c in text.chars() {
            let g = self.glyph(c);
            out.push((x, g));
            x += g.advance();
        }
        (out, x)
    }
}

/// A glyph's contours, each closed, y down.
struct OutlineCollector {
    runs: Vec<Vec<(f64, f64)>>,
    run: Vec<(f64, f64)>,
}

impl OutlineCollector {
    fn new() -> OutlineCollector {
        OutlineCollector { runs: Vec::new(), run: Vec::new() }
    }

    fn note(&mut self, x: f64, y: f64) {
        if self.run.last() != Some(&(x, y)) {
            self.run.push((x, y));
        }
    }

    fn finish_run(&mut self) {
        let mut run = std::mem::take(&mut self.run);
        if run.len() > 2 {
            if run.first() != run.last() {
                run.push(run[0]);
            }
            self.runs.push(run);
        }
    }
}

impl ttf_parser::OutlineBuilder for OutlineCollector {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish_run();
        let y = -y as f64;
        self.note(x as f64, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let y = -y as f64;
        self.note(x as f64, y);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x0, y0) = self.run.last().copied().unwrap_or((0.0, 0.0));
        let (x1, y1, x, y) = (x1 as f64, -y1 as f64, x as f64, -y as f64);
        for i in 1..=8 {
            let t = i as f64 / 8.0;
            let u = 1.0 - t;
            let px = u * u * x0 + 2.0 * u * t * x1 + t * t * x;
            let py = u * u * y0 + 2.0 * u * t * y1 + t * t * y;
            self.note(px, py);
        }
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x0, y0) = self.run.last().copied().unwrap_or((0.0, 0.0));
        let (x1, y1, x2, y2, x, y) = (
            x1 as f64,
            -y1 as f64,
            x2 as f64,
            -y2 as f64,
            x as f64,
            -y as f64,
        );
        for i in 1..=10 {
            let t = i as f64 / 10.0;
            let u = 1.0 - t;
            let px = u * u * u * x0 + 3.0 * u * u * t * x1 + 3.0 * u * t * t * x2 + t * t * t * x;
            let py = u * u * u * y0 + 3.0 * u * u * t * y1 + 3.0 * u * t * t * y2 + t * t * t * y;
            self.note(px, py);
        }
    }

    fn close(&mut self) {
        self.finish_run();
    }
}

/// Pre-parsed outline font face that caches tessellated glyph contours per character.
pub struct CachedGoogleFont<'a> {
    face: ttf_parser::Face<'a>,
    cap_height: f64,
    top: f64,
    bottom: f64,
    missing: ttf_parser::GlyphId,
    glyphs: std::collections::HashMap<char, (f64, Vec<Vec<(f64, f64)>>)>,
}

impl<'a> CachedGoogleFont<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, String> {
        let face = ttf_parser::Face::parse(bytes, 0).map_err(|e| format!("labels: google font did not parse ({e})"))?;
        let units = face.units_per_em() as f64;
        let ascender = face.ascender() as f64;
        let cap_height = face
            .capital_height()
            .map(f64::from)
            .filter(|&h| h > 0.0)
            .unwrap_or(if ascender > 0.0 { ascender * 0.75 } else { units * 0.7 });
        let missing = face.glyph_index('?').unwrap_or(ttf_parser::GlyphId(0));
        Ok(CachedGoogleFont {
            top: -ascender.max(cap_height),
            bottom: -(face.descender() as f64),
            cap_height,
            missing,
            face,
            glyphs: std::collections::HashMap::new(),
        })
    }

    pub fn layout(&mut self, text: &str) -> LabelLayout {
        let mut x = 0.0;
        let mut glyphs = Vec::with_capacity(text.len());
        for c in text.chars() {
            let (advance, strokes) = self
                .glyphs
                .entry(c)
                .or_insert_with(|| {
                    let gid = self.face.glyph_index(c).unwrap_or(self.missing);
                    let advance = self.face.glyph_hor_advance(gid).unwrap_or(0) as f64;
                    let mut col = OutlineCollector::new();
                    if self.face.outline_glyph(gid, &mut col).is_none() && !c.is_whitespace() {
                        col = OutlineCollector::new();
                        self.face.outline_glyph(self.missing, &mut col);
                    }
                    col.finish_run();
                    (advance, col.runs)
                })
                .clone();
            glyphs.push(LabelGlyph { x, advance, strokes });
            x += advance;
        }
        LabelLayout {
            glyphs,
            width: x,
            cap_height: self.cap_height,
            top: self.top,
            bottom: self.bottom,
            outline: true,
        }
    }
}

fn layout_google(bytes: &[u8], text: &str) -> Result<LabelLayout, String> {
    let mut cached = CachedGoogleFont::parse(bytes)?;
    Ok(cached.layout(text))
}

/// The filled shape of an outline glyph from its closed contours, as the font
/// fills it: by the non-zero rule over all of them at once, windings as
/// drawn. Overlapping strokes (variable fonts keep them, even within one
/// contour) merge into one body; counters, wound the other way, stay open.
pub(crate) fn glyph_silhouette(contours: &Lines) -> MultiPolygon<f64> {
    use i_overlay::core::fill_rule::FillRule;
    use i_overlay::float::simplify::SimplifyShape;
    let paths: Vec<Vec<[f64; 2]>> = contours
        .iter()
        .map(|c| {
            let mut p: Vec<[f64; 2]> = c.0.iter().map(|q| [q.x, q.y]).collect();
            if p.len() > 1 && p.first() == p.last() {
                p.pop();
            }
            p
        })
        .filter(|p| p.len() >= 3)
        .collect();
    if paths.is_empty() {
        return geom::empty();
    }
    let ring = |r: &Vec<[f64; 2]>| LineString::from(r.iter().map(|p| Coord { x: p[0], y: p[1] }).collect::<Vec<_>>());
    let polys = paths
        .simplify_shape(FillRule::NonZero)
        .iter()
        .filter_map(|shape| {
            let (outer, holes) = shape.split_first()?;
            Some(Polygon::new(ring(outer), holes.iter().map(ring).collect()))
        })
        .filter(|p| p.unsigned_area() > 0.0)
        .collect();
    MultiPolygon::new(polys)
}

/// The plain letter under a Latin accent, so `é` is drawn as `e`.
fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'È' | 'É' | 'Ê' | 'Ë' => 'E',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'O',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
        'ñ' => 'n',
        'Ñ' => 'N',
        'ç' => 'c',
        'Ç' => 'C',
        '’' | '‘' => '\'',
        '–' | '—' => '-',
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn futural_reads_in_ascii_order() {
        let f = font("futural").unwrap();
        // `A`: an apex at the capitals' top, two feet on the baseline.
        let a = f.glyph('A');
        let ys: Vec<f64> = a.strokes.iter().flatten().map(|p| p.1).collect();
        assert_eq!(ys.iter().cloned().fold(f64::MAX, f64::min), CAP_TOP);
        assert_eq!(ys.iter().cloned().fold(f64::MIN, f64::max), BASELINE);
        assert!(f.glyph(' ').strokes.is_empty());
        assert!(f.glyph('é').strokes.len() == f.glyph('e').strokes.len());
        let (_, w) = f.layout("Ave");
        assert!(w > 0.0);
    }

    #[test]
    fn label_font_deserializes_shorthand_and_origin() {
        let a: LabelFont = serde_json::from_str("\"futural\"").unwrap();
        assert_eq!(a.drawland_id(), Some("futural"));
        let b: LabelFont = serde_json::from_str(r#"{"origin":"google","family":"Roboto","weight":500}"#).unwrap();
        assert_eq!(b.google_key(), Some("Roboto:500".into()));
    }
}
