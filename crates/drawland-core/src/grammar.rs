//! The graph a profile script builds (`drawland-script`), and its JSON form:
//! named nodes in four typed sections, the draws, and the composition.
//!
//! ```json
//! { "output": { "width": "6in", "height": "4in", "scale": "1:10000" },
//!   "$features": { "bldg_1": { "tiles_select": "buildings", "at": [3, 14] } },
//!   "$areas": { "polygons_2": { "tools_polygons": "$features.bldg_1", "at": [4, 19] } },
//!   "$lines": { "rings_3": { "tools_rings": "$areas.polygons_2", "at": [5, 15] } },
//!   "draw": [{ "id": "bldg_ring", "from": "$lines.rings_3", "stroke": "solid", "at": [6, 1] }],
//!   "compose": { "order": ["bldg_ring"] } }
//! ```
//!
//! A node refers to another by `$section.name`; the section is its type.
//! Operations are namespaced: `tools_*` (this module), `osm_*` / `tiles_*` /
//! `engine_*` (sources: Overpass, vector tiles, the output, the ocean) and
//! `module_*` (compiled recipes such as roads, whose outputs are drawn as
//! `roads.outlines`). `at` is where the script made the node; errors about it
//! carry that line and column.
//!
//! Loading is strict: unknown sections, operations and names are errors at
//! load, never halfway through a render.

use crate::profile::{FillSpec, StrokeSpec};
use crate::select::{Selector, TagMatch, TagTest};
use crate::units::Mm;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/// Which section a name lives in. The section is the type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Section {
    Features,
    Areas,
    Lines,
    Fills,
}

impl Section {
    pub const ALL: [Section; 4] = [Section::Features, Section::Areas, Section::Lines, Section::Fills];

    pub fn key(self) -> &'static str {
        match self {
            Section::Features => "features",
            Section::Areas => "areas",
            Section::Lines => "lines",
            Section::Fills => "fills",
        }
    }
}

impl fmt::Display for Section {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(self.key())
    }
}

/// A reference such as `$areas.river` or `$fills.hatch`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Name {
    pub section: Section,
    pub name: String,
}

impl Name {
    /// Parse `$<section>.<name>`. Anything else (a bare word)
    /// is not a reference the grammar resolver understands.
    pub fn parse(text: &str) -> Result<Name, String> {
        let rest = text.strip_prefix('$').ok_or_else(|| format!("{text:?} is not a $section.name reference"))?;
        let (section, name) = rest
            .split_once('.')
            .ok_or_else(|| format!("{text:?} has no section (expected $section.name)"))?;
        let section = Section::ALL
            .into_iter()
            .find(|s| s.key() == section)
            .ok_or_else(|| format!("unknown section {section:?} in {text:?}"))?;
        if name.is_empty() {
            return Err(format!("{text:?} has an empty name"));
        }
        Ok(Name { section, name: name.to_string() })
    }
}

impl fmt::Display for Name {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "${}.{}", self.section.key(), self.name)
    }
}

/// An SVG group id: a label, not a variable, so it carries no marker.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Id(pub String);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// A tag filter, as `osm_select: { building: true, highway: [primary] }`.
pub type Select = Vec<(String, TagMatch)>;

/// A vector tile selection, as `tiles_select: [buildings, landcover:park]`:
/// terramask presets and `layer:class` rules, a class or a subclass by name.
#[derive(Debug, Clone, PartialEq)]
pub struct TileSelect {
    /// As written.
    pub items: Vec<String>,
    pub filter: terramask::Filter,
}

/// `tools_where`: the features of `of` whose tags pass every test, as
/// `{ of: $features.b, tags: { render_height: { min: 20, max: 40 } } }`.
#[derive(Debug, Clone, PartialEq)]
pub struct Where {
    pub of: Name,
    pub tags: Vec<(String, TagTest)>,
}

/// A compiled module, reading `from` when given, else every OSM feature.
#[derive(Debug, Clone, PartialEq)]
pub struct Module {
    pub name: String,
    pub from: Option<Name>,
}

/// Buffer a shape by a distance, positive or negative.
#[derive(Debug, Clone, PartialEq)]
pub struct Grow {
    pub of: Name,
    pub by: Mm,
}

/// How `tools_buffer_lines` ends each stroke.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineBufferCap {
    #[default]
    Round,
    Flat,
}

/// Buffer lines by a half-width, merged into one area. Caps and joins are round
/// unless `cap` is `flat` (butt caps; joins stay round).
#[derive(Debug, Clone, PartialEq)]
pub struct BufferLines {
    pub lines: Name,
    pub by: Mm,
    pub cap: LineBufferCap,
}

/// Close the thin gaps between `of` and the edges of `within` (tile polygons
/// that stop just short of the card border); `gap_mm` is the widest closed.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtendToFrame {
    pub of: Name,
    pub within: Name,
    pub gap_mm: Option<Mm>,
}

/// `tools_terrain`: pen-and-ink terrain in an area, drawn by burin from the
/// elevation under the output.
#[derive(Debug, Clone, PartialEq)]
pub struct Terrain {
    /// The area to draw in, or `None` for the whole output.
    pub in_area: Option<Name>,
    /// The colour at each dash, as burin writes one: a hex colour, or a tree.
    pub color: Option<serde_json::Value>,
    /// The line width at each dash, as a multiple of the pen.
    pub width: Option<serde_json::Value>,
    /// The field the streamlines run along, degrees.
    pub angle: f64,
    /// What to call the layer; `terrain` without one.
    pub layer: Option<String>,
    /// Style parameters, as burin names them.
    pub style: serde_json::Map<String, serde_json::Value>,
    /// Draw the shore (the zero contour) as well.
    pub shore: bool,
    /// The heights a fill keeps to, as burin writes them: `elevMin`, `elevMax`
    /// and the depths. Empty for streamlines, which cover the ground they can.
    pub band: serde_json::Map<String, serde_json::Value>,
    /// What to draw: streamlines along the slope, or a fill of the band.
    pub draw: TerrainDraw,
}

/// What a `tools_terrain` def draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TerrainDraw {
    /// Pen-and-ink hatching along the slope; the default.
    #[default]
    Lines,
    /// A flat fill of the band: what a contour belt between two heights is.
    Fill,
    /// Stippling, denser where the shading is darker.
    Dots,
}

/// `tools_burin`: a whole burin document, built by burin's own language inside
/// a draw.land profile, drawn by the engine from the elevation under the
/// output. The atlas is burin's own JSON — the same thing `burin.draw()`
/// yields at burin's front ends — so no vocabulary is repeated here.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Burin {
    /// The burin atlas, as `burin.json()` writes it: batches and water passes.
    pub atlas: serde_json::Value,
    /// The area the drawing is kept to, or `None` for the whole output.
    pub in_area: Option<Name>,
    /// Regions batches name in `within` / `outside`, by name, in output mm.
    pub regions: std::collections::BTreeMap<String, Name>,
    /// What to call the layer; `burin` without one.
    pub layer: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Difference {
    pub base: Name,
    /// Named defs to subtract (empty when `cut_rule` is used).
    pub cut: Vec<Name>,
    /// `cut: { tools_rings: $areas.a }` — a rule written on the line.
    pub cut_rule: Option<Box<Op>>,
}

/// What `tools_union` / `tools_join` read.
#[derive(Debug, Clone, PartialEq)]
pub enum UnionRules {
    /// `tools_union: [$areas.a, $areas.b]`
    Refs(Vec<Name>),
    /// `tools_union: $areas.a` — one reference, `list: false`
    Ref(Name),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Intersect {
    pub base: Name,
    /// A named def (empty when `keep_rule` is used).
    pub keep: Option<Name>,
    pub keep_rule: Option<Box<Op>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rings {
    pub of: Name,
    pub exterior_only: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClipLines {
    pub lines: Name,
    pub within: Name,
    pub invert: bool,
}

/// Read strokes or the covered area from a `$lines` labels def, optionally
/// one rule bucket (`rule: "park"` matches `modules.labels` `rules[].id`).
#[derive(Debug, Clone, PartialEq)]
pub struct LabelPick {
    pub of: Name,
    pub rule: Option<String>,
}

/// `tools_labels`: the names of `from`, placed so that none covers another,
/// as the pen strokes of their letters. What the letters cover is read from
/// it by `tools_label_area` / `tools_label_lines`.
#[derive(Debug, Clone, PartialEq)]
pub struct Labels {
    /// Placed together, so no set's labels cover another's.
    pub from: Vec<Name>,
    pub style: crate::labels::Style,
}

/// A penfill run. `per: feature` runs one pattern per polygon instead of one
/// on the union. `content` fills the area with lines made elsewhere (burin's,
/// or any `$lines`), cut to it, instead of a pattern.
#[derive(Debug, Clone, PartialEq)]
pub struct Fill {
    pub in_area: Name,
    pub per_feature: bool,
    pub content: Option<Name>,
    pub spec: FillSpec,
}

/// One operation. Every variant names the section it produces.
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    // ---- feature sets ----------------------------------------------------
    Select(Selector),
    TileSelect(TileSelect),
    Where(Where),

    // ---- areas -----------------------------------------------------------
    Polygons(Name),
    Union(UnionRules),
    Difference(Difference),
    Intersect(Intersect),
    FillHoles(Name),
    Grow(Grow),
    BufferLines(BufferLines),
    /// What the letters of a `$lines` labels def cover.
    LabelArea(LabelPick),
    /// The output rectangle.
    Frame,
    ExtendToFrame(ExtendToFrame),

    // ---- lines -----------------------------------------------------------
    Rings(Rings),
    Lines(Name),
    Segments(Name),
    Dedupe(Name),
    Merge(Name),
    Join(UnionRules),
    ClipLines(ClipLines),
    /// Pen-and-ink terrain, drawn by burin from the elevation.
    Terrain(Terrain),
    /// A whole burin document, drawn from the elevation.
    Burin(Burin),
    /// Names on the map, as pen strokes.
    Labels(Labels),
    /// Strokes from a labels def, or one of its rule buckets.
    LabelLines(LabelPick),

    // ---- fills (lines, produced by penfill) -------------------------------
    Fill(Fill),

    // ---- compiled modules (roads) ----------------------------------------
    /// Publishes named outputs (`roads.area`, `roads.outlines`, …).
    Module(Module),
}

impl Clip {
    pub fn auto() -> Clip {
        Clip::Auto
    }
}

impl Op {
    /// What a def holding this operation defines.
    pub fn section(&self) -> Section {
        match self {
            Op::Select(_) | Op::TileSelect(_) | Op::Where(_) => Section::Features,
            Op::Polygons(_)
            | Op::Union(_)
            | Op::Difference(_)
            | Op::Intersect(_)
            | Op::FillHoles(_)
            | Op::Grow(_)
            | Op::BufferLines(_)
            | Op::LabelArea(_)
            | Op::Frame
            | Op::ExtendToFrame(_) => Section::Areas,
            Op::Rings(_)
            | Op::Lines(_)
            | Op::Segments(_)
            | Op::Dedupe(_)
            | Op::Merge(_)
            | Op::Join(_)
            | Op::ClipLines(_)
            | Op::Terrain(_)
            | Op::Burin(_)
            | Op::Labels(_)
            | Op::LabelLines(_) => Section::Lines,
            Op::Fill(_) => Section::Fills,
            // A module is called from $areas: its headline output is an area,
            // and the rest are reached by output name (`roads.outlines`).
            Op::Module(_) => Section::Areas,
        }
    }

    /// The names this operation reads.
    pub fn refs(&self) -> Vec<Name> {
        match self {
            Op::Select(_) | Op::TileSelect(_) | Op::Frame => vec![],
            Op::Module(m) => m.from.iter().cloned().collect(),
            Op::Polygons(n) | Op::FillHoles(n) | Op::Dedupe(n) | Op::Merge(n) | Op::Lines(n) | Op::Segments(n) => {
                vec![n.clone()]
            }
            Op::Union(UnionRules::Refs(ns)) | Op::Join(UnionRules::Refs(ns)) => ns.clone(),
            Op::Union(UnionRules::Ref(n)) | Op::Join(UnionRules::Ref(n)) => vec![n.clone()],
            Op::Difference(d) => std::iter::once(d.base.clone())
                .chain(d.cut.iter().cloned())
                .chain(d.cut_rule.as_deref().map(Op::refs).unwrap_or_default())
                .collect(),
            Op::Intersect(i) => std::iter::once(i.base.clone())
                .chain(i.keep.iter().cloned())
                .chain(i.keep_rule.as_deref().map(Op::refs).unwrap_or_default())
                .collect(),
            Op::Grow(g) => vec![g.of.clone()],
            Op::BufferLines(b) => vec![b.lines.clone()],
            Op::ExtendToFrame(e) => vec![e.of.clone(), e.within.clone()],
            Op::Where(w) => vec![w.of.clone()],
            Op::Rings(r) => vec![r.of.clone()],
            Op::ClipLines(c) => vec![c.lines.clone(), c.within.clone()],
            Op::Terrain(t) => t.in_area.iter().cloned().collect(),
            Op::Burin(b) => b
                .in_area
                .iter()
                .cloned()
                .chain(b.regions.values().cloned())
                .collect(),
            Op::Labels(l) => l.from.clone(),
            Op::LabelLines(p) | Op::LabelArea(p) => vec![p.of.clone()],
            Op::Fill(f) => std::iter::once(f.in_area.clone()).chain(f.content.iter().cloned()).collect(),
        }
    }

    /// Same rule shape and the same inputs: the only difference is where the
    /// inputs live (a named def vs. on the line).
    pub fn same_semantics(&self, other: &Op) -> bool {
        match (self, other) {
            (Op::Polygons(a), Op::Polygons(b)) => a == b,
            (Op::Union(a), Op::Union(b)) => a == b,
            (Op::Difference(a), Op::Difference(b)) => a.base == b.base && a.cut.len() == b.cut.len(),
            (Op::Intersect(a), Op::Intersect(b)) => a.base == b.base && a.keep == b.keep,
            (Op::FillHoles(a), Op::FillHoles(b)) => a == b,
            (Op::LabelArea(a), Op::LabelArea(b)) => a == b,
            (Op::LabelLines(a), Op::LabelLines(b)) => a == b,
            (Op::Grow(a), Op::Grow(b)) => a.of == b.of,
            (Op::BufferLines(a), Op::BufferLines(b)) => a.lines == b.lines && a.by == b.by && a.cap == b.cap,
            (Op::Rings(a), Op::Rings(b)) => a.of == b.of,
            (Op::Lines(a), Op::Lines(b)) => a == b,
            (Op::Segments(a), Op::Segments(b)) => a == b,
            (Op::Dedupe(a), Op::Dedupe(b)) => a == b,
            (Op::Merge(a), Op::Merge(b)) => a == b,
            (Op::Join(a), Op::Join(b)) => a == b,
            (Op::ClipLines(a), Op::ClipLines(b)) => a.lines == b.lines,
            // A selection, an engine source or a module cannot be inlined in v3.
            _ => false,
        }
    }
}

/// Where a script wrote something: line and column, from 1. Written as
/// `line 12 column 5`, the form the web editor's markers read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct At(pub u32, pub u32);

impl fmt::Display for At {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "line {} column {}", self.0, self.1)
    }
}

/// `what`, followed by ` (line 12 column 5)` when the script position is known.
pub fn located(what: &str, at: Option<At>) -> String {
    match at {
        Some(at) => format!("{what} ({at})"),
        None => what.to_string(),
    }
}

/// A def: the name you chose, and the one operation it runs.
#[derive(Debug, Clone, PartialEq)]
pub struct Def {
    pub name: String,
    pub op: Op,
    pub at: Option<At>,
}

impl Def {
    /// The reference other defs use to reach this one.
    pub fn reference(&self) -> Name {
        Name { section: self.op.section(), name: self.name.clone() }
    }

    /// The reference, with the script line that made it.
    pub fn label(&self) -> String {
        located(&self.reference().to_string(), self.at)
    }
}

// ---------------------------------------------------------------------------
// draw: and compose:
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Draw {
    /// SVG group id. `None` falls back to the def name (`fills_hatch`).
    pub id: Option<String>,
    pub from: Target,
    pub stroke: Option<StrokeSpec>,
    pub at: Option<At>,
}

impl Draw {
    /// The group name this entry writes: explicit `id`, else the def reference
    /// with `$` dropped and the dot turned into an underscore.
    pub fn group(&self) -> String {
        match &self.id {
            Some(id) => id.clone(),
            None => match &self.from.module {
                Some(m) => format!("{m}_{}", self.from.name.name),
                None => format!("{}_{}", self.from.name.section.key(), self.from.name.name),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Mask {
    pub from: Target,
    pub occludes: Vec<Id>,
    pub at: Option<At>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub enum Clip {
    #[default]
    Auto,
    None,
    /// Subtract exactly these areas.
    Areas(Vec<Name>),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Compose {
    /// Bottom-most first. Empty means the order of `draw`.
    pub order: Vec<Id>,
    pub masks: Vec<(String, Mask)>,
    pub clip: BTreeMap<Id, Clip>,
    pub clip_default: Clip,
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Grammar {
    /// A name for the profile, carried with it when shared; nothing draws it.
    pub title: Option<String>,
    pub output: crate::profile::OutputSpec,
    /// Sections in the order they were written, each with its defs.
    pub sections: Vec<(Section, Vec<Def>)>,
    pub draw: Vec<Draw>,
    pub compose: Compose,
}

impl Grammar {
    /// The `tools_terrain` defs, in file order: what the host reads the
    /// elevation for.
    pub fn terrains(&self) -> Vec<&Terrain> {
        self.all_defs()
            .filter_map(|d| match &d.op {
                Op::Terrain(t) => Some(t),
                _ => None,
            })
            .collect()
    }

    /// The `tools_burin` defs: whole burin documents the engine draws.
    pub fn burins(&self) -> Vec<&Burin> {
        self.all_defs()
            .filter_map(|d| match &d.op {
                Op::Burin(b) => Some(b),
                _ => None,
            })
            .collect()
    }

    /// Whether any def draws the elevation — terrain, or a burin document.
    /// What turns the terrain fetch on.
    pub fn draws_terrain(&self) -> bool {
        !self.terrains().is_empty() || !self.burins().is_empty()
    }

    pub fn defs(&self, section: Section) -> &[Def] {
        self.sections
            .iter()
            .find(|(s, _)| *s == section)
            .map(|(_, d)| d.as_slice())
            .unwrap_or(&[])
    }

    /// Every def, in section order.
    pub fn all_defs(&self) -> impl Iterator<Item = &Def> {
        self.sections.iter().flat_map(|(_, defs)| defs.iter())
    }

    pub fn find(&self, name: &Name) -> Option<&Def> {
        self.defs(name.section).iter().find(|d| d.name == name.name)
    }

    /// The def holding `module_<module>`, if the profile calls one.
    pub fn module(&self, module: &str) -> Option<&Def> {
        self.all_defs().find(|d| matches!(&d.op, Op::Module(m) if m.name == module))
    }

    /// The SVG group each draw entry writes.
    pub fn groups(&self) -> Vec<String> {
        self.draw.iter().map(Draw::group).collect()
    }

    /// Every OSM key the profile can select on: what Overpass must fetch.
    ///
    /// Modules read tags the profile never names (`module_roads` needs
    /// `highway`), so they contribute their keys too, unless they read a
    /// feature set of their own (`from`). Empty: the profile needs no
    /// Overpass at all.
    pub fn osm_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = Vec::new();
        fn add(keys: &mut Vec<String>, k: &str) {
            if !keys.iter().any(|x| x == k) {
                keys.push(k.to_string());
            }
        }
        let defs: Vec<&Def> = self.all_defs().collect();
        for def in defs {
            match &def.op {
                Op::Select(sel) => sel.keys().for_each(|k| add(&mut keys, k)),
                Op::Module(Module { name, from: None }) => {
                    crate::themes::osm_keys(name).iter().for_each(|k| add(&mut keys, k))
                }
                _ => {}
            }
        }
        keys
    }

    /// Every `tiles_select` item: what to read from the vector tiles.
    pub fn tile_selectors(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for def in self.all_defs() {
            if let Op::TileSelect(t) = &def.op {
                out.extend(t.items.iter().filter(|i| !out.contains(i)).cloned().collect::<Vec<_>>());
            }
        }
        out
    }

    /// Whether the profile reads open-sea polygons from the vector tiles.
    pub fn draws_ocean(&self) -> bool {
        self.tile_selectors().iter().any(|s| s == "ocean")
    }

    /// SVG files named by a fill `source`, for the host to read.
    pub fn source_files(&self) -> Vec<String> {
        let mut out = Vec::new();
        for def in self.defs(Section::Fills) {
            if let Op::Fill(f) = &def.op {
                if let Some(src) = &f.spec.source {
                    if !out.contains(&src.file) {
                        out.push(src.file.clone());
                    }
                }
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum GrammarError {
    #[error("graph JSON: {0}")]
    Json(String),
    #[error("profile: {0}")]
    Invalid(String),
}

/// Raw shape: sections as written, before validation.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    #[serde(default)]
    title: Option<String>,
    output: crate::profile::OutputSpec,
    #[serde(default, rename = "$features", deserialize_with = "ordered_defs")]
    features: Vec<(String, RawOp)>,
    #[serde(default, rename = "$areas", deserialize_with = "ordered_defs")]
    areas: Vec<(String, RawOp)>,
    #[serde(default, rename = "$lines", deserialize_with = "ordered_defs")]
    lines: Vec<(String, RawOp)>,
    #[serde(default, rename = "$fills", deserialize_with = "ordered_defs")]
    fills: Vec<(String, RawOp)>,
    /// Recognised so the error is clear, not "unknown field".
    #[serde(default)]
    draw: Vec<RawDraw>,
    #[serde(default)]
    compose: RawCompose,
}


/// `Vec<(String, T)>` from a YAML/JSON **mapping**, keeping the written order.
/// Used for the `$sections` (def name → operation) and for `compose.masks`.
fn ordered_defs<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(String, RawOp)>, D::Error> {
    ordered_map(d)
}

fn ordered_masks<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(String, RawMask)>, D::Error> {
    ordered_map(d)
}

fn ordered_map<'de, D, T>(d: D) -> Result<Vec<(String, T)>, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    struct V<T>(std::marker::PhantomData<T>);
    impl<'de, T: serde::de::DeserializeOwned> Visitor<'de> for V<T> {
        type Value = Vec<(String, T)>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a mapping of name to value")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::new();
            while let Some((k, v)) = map.next_entry::<String, T>()? {
                out.push((k, v));
            }
            Ok(out)
        }
        /// `$features:` with nothing under it is an empty section, not an error.
        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }
    }
    d.deserialize_any(V(std::marker::PhantomData))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDraw {
    #[serde(default)]
    id: Option<String>,
    from: String,
    #[serde(default)]
    stroke: Option<StrokeSpec>,
    #[serde(default)]
    at: Option<At>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCompose {
    #[serde(default)]
    order: Vec<String>,
    #[serde(default, deserialize_with = "ordered_masks")]
    masks: Vec<(String, RawMask)>,
    #[serde(default)]
    clip: ClipBlock,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClipBlock {
    #[serde(default)]
    default: Option<ClipValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum ClipValue {
    Keyword(String),
    List(Vec<String>),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMask {
    from: String,
    #[serde(default)]
    occludes: Vec<String>,
    #[serde(default)]
    at: Option<At>,
}

/// One operation, as a single-key mapping. The key picks the variant; a def
/// with several keys is an error (one operation per def).
/// `at: [line, column]` may sit next to the operation key: where the script
/// made the def.
#[derive(Debug)]
struct RawOp(BTreeMap<String, Value>, Option<At>);

impl<'de> Deserialize<'de> for RawOp {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = RawOp;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a mapping with exactly one operation key")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<RawOp, A::Error> {
                let mut entries = BTreeMap::new();
                let mut at = None;
                while let Some((k, v)) = map.next_entry::<String, Value>()? {
                    if k == "at" {
                        at = Some(serde_json::from_value(v).map_err(de::Error::custom)?);
                    } else {
                        entries.insert(k, v);
                    }
                }
                if entries.len() != 1 {
                    let keys: Vec<&str> = entries.keys().map(String::as_str).collect();
                    return Err(de::Error::custom(format!(
                        "a def takes exactly one operation, found {}: {}",
                        entries.len(),
                        keys.join(", ")
                    )));
                }
                Ok(RawOp(entries, at))
            }
            /// `def: name` with no body (an alias style) is not supported here.
            fn visit_str<E: de::Error>(self, v: &str) -> Result<RawOp, E> {
                Err(de::Error::custom(format!(
                    "expected an operation, found the bare name {v:?}; write `tools_union: [{v}]` or a real op"
                )))
            }
        }
        d.deserialize_any(V)
    }
}

/// Peak at the operation key without consuming the rest.
fn only_op(raw: RawOp) -> Result<(String, Value), String> {
    let (k, v) = raw.0.into_iter().next().ok_or("empty operation")?;
    Ok((k, v))
}

fn json<T: serde::de::DeserializeOwned>(value: &Value, what: &str) -> Result<T, GrammarError> {
    serde_json::from_value(value.clone()).map_err(|e| GrammarError::Invalid(format!("{what}: {e}")))
}

/// Tests write graphs as YAML, the op form's shortest spelling; the engine
/// itself reads only JSON.
#[cfg(test)]
pub(crate) fn from_yaml(text: &str) -> Result<Grammar, GrammarError> {
    let value: Value = serde_saphyr::from_str(text).map_err(|e| GrammarError::Json(e.to_string()))?;
    Grammar::from_json(&value.to_string())
}

fn build(raw: Raw) -> Result<Grammar, GrammarError> {
    let mut sections: Vec<(Section, Vec<Def>)> = Vec::new();
    for (section, entries) in [
        (Section::Features, raw.features),
        (Section::Areas, raw.areas),
        (Section::Lines, raw.lines),
        (Section::Fills, raw.fills),
    ] {
        if entries.is_empty() {
            continue;
        }
        let mut seen = BTreeSet::new();
        let mut defs = Vec::new();
        for (name, raw_op) in entries {
            if !seen.insert(name.clone()) {
                return Err(GrammarError::Invalid(format!("${}.{} is defined twice", section, name)));
            }
            let at = raw_op.1;
            let op = parse_op(raw_op, section).map_err(|e| match e {
                GrammarError::Invalid(m) => GrammarError::Invalid(located(&format!("${section}.{name}: {m}"), at)),
                other => other,
            })?;
            defs.push(Def { name, op, at });
        }
        sections.push((section, defs));
    }

    let draw = raw
        .draw
        .into_iter()
        .map(|d| {
            Ok(Draw {
                from: parse_output(&d.from)?,
                id: d.id,
                stroke: d.stroke,
                at: d.at,
            })
        })
        .collect::<Result<Vec<_>, GrammarError>>()?;

    let mut masks = Vec::new();
    for (name, m) in raw.compose.masks {
        masks.push((
            name,
            Mask {
                from: parse_output(&m.from)?,
                occludes: m.occludes.into_iter().map(Id).collect(),
                at: m.at,
            },
        ));
    }

    let clip_default = match &raw.compose.clip.default {
        None => Clip::Auto,
        Some(ClipValue::Keyword(k)) => match k.as_str() {
            "auto" => Clip::Auto,
            "none" => Clip::None,
            other => {
                return Err(GrammarError::Invalid(format!(
                    "clip default {other:?} is unknown: write auto, none, or a list of $areas.*"
                )))
            }
        },
        Some(ClipValue::List(names)) => Clip::Areas(
            names
                .iter()
                .map(|n| refname(n))
                .collect::<Result<Vec<_>, _>>()?,
        ),
    };

    let compose = Compose {
        order: raw.compose.order.into_iter().map(Id).collect(),
        masks,
        clip: BTreeMap::new(),
        clip_default,
    };

    let grammar = Grammar { title: raw.title, output: raw.output, sections, draw, compose };
    validate(&grammar)?;
    Ok(grammar)
}

fn not_a_reference(text: String) -> GrammarError {
    GrammarError::Invalid(format!("{text:?} is not a $section.name reference"))
}

/// `$lines.x`, `$fills.x`, or `roads.outlines` (a module output).
fn parse_output(text: &str) -> Result<Target, GrammarError> {
    if let Some(rest) = text.strip_prefix('$') {
        return Ok(Target { module: None, name: refname(&format!("${rest}"))? });
    }
    match text.split_once('.') {
        Some((module, name)) if !name.is_empty() => {
            Ok(Target { module: Some(module.to_string()), name: Name { section: Section::Lines, name: name.to_string() } })
        }
        _ => Err(GrammarError::Invalid(format!(
            "{text:?} is not a reference: write $lines.x, $fills.x or <module>.<output>"
        ))),
    }
}

fn refname(text: &str) -> Result<Name, GrammarError> {
    Name::parse(text).map_err(|_| not_a_reference(text.to_string()))
}

/// A draw/`from` target: `$lines.x` / `$fills.x`, or `roads.outlines` (a module
/// output, which has no `$` because the engine produced it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    /// `None` = a `$section.name` def; `Some(module)` = a module output.
    pub module: Option<String>,
    pub name: Name,
}

fn parse_op(raw: RawOp, section: Section) -> Result<Op, GrammarError> {
    let (key, value) = only_op(raw).map_err(GrammarError::Invalid)?;
    let target = match key.as_str() {
        "osm_select" | "tiles_select" | "tools_where" => Section::Features,
        "tools_polygons" | "tools_union" | "tools_difference" | "tools_intersect" | "tools_fill_holes"
        | "tools_grow" | "tools_buffer_lines" | "tools_label_area" | "tools_extend_to_frame" | "engine_frame" => {
            Section::Areas
        }
        "tools_rings" | "tools_lines" | "tools_segments" | "tools_dedupe" | "tools_merge" | "tools_join"
        | "tools_clip" | "tools_terrain" | "tools_burin" | "tools_labels" | "tools_label_lines" => Section::Lines,
        "tools_fill" => Section::Fills,
        other => {
            if let Some(rest) = other.strip_prefix("module_") {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Raw {
                    #[serde(default)]
                    from: Option<String>,
                }
                let raw: Raw = json(&value, &key)?;
                let from = raw.from.as_deref().map(refname).transpose()?;
                if let Some(f) = &from {
                    if f.section != Section::Features {
                        return Err(GrammarError::Invalid(format!("{key}.from is {f}, but it must be a $features set")));
                    }
                }
                return Ok(Op::Module(Module { name: rest.to_string(), from }));
            }
            if let Some(rest) = other.strip_prefix("primitives_") {
                return Err(GrammarError::Invalid(format!(
                    "primitives_{rest} is not defined in this build"
                )));
            }
            return Err(GrammarError::Invalid(format!("unknown operation {other:?}")));
        }
    };
    if target != section {
        return Err(GrammarError::Invalid(format!(
            "{key} produces {target}, but it is written under ${section}"
        )));
    }
    let _ = target;
    let op = match key.as_str() {
        "osm_select" => Op::Select(parse_selector(&value)?),
        "tiles_select" => Op::TileSelect(parse_tile_select(&value)?),
        "tools_where" => Op::Where(parse_where(&value)?),
        "engine_frame" => Op::Frame,
        "tools_polygons" => Op::Polygons(name_ref(&value, "tools_polygons")?),
        "tools_union" => Op::Union(union_rules(&value, "tools_union")?),
        "tools_difference" => {
            #[derive(Deserialize)]
            struct Raw {
                base: String,
                cut: OneOrMany,
            }
            let raw: Raw = json(&value, "tools_difference")?;
            let (cut, cut_rule) = cut_rules(&raw.cut.into_vec(), "tools_difference.cut")?;
            Op::Difference(Difference { base: refname(&raw.base)?, cut, cut_rule })
        }
        "tools_intersect" => {
            #[derive(Deserialize)]
            struct Raw {
                base: String,
                #[serde(default)]
                keep: Option<String>,
                #[serde(default)]
                keep_rule: Option<RawOp>,
            }
            let raw: Raw = json(&value, "tools_intersect")?;
            if raw.keep.is_some() == raw.keep_rule.is_some() {
                return Err(GrammarError::Invalid(
                    "tools_intersect needs exactly one of `keep: $areas.x` or `keep_rule: { ... }`".into(),
                ));
            }
            let keep_rule = match raw.keep_rule {
                Some(op) => Some(Box::new(parse_op(op, Section::Areas)?)),
                None => None,
            };
            Op::Intersect(Intersect {
                base: refname(&raw.base)?,
                keep: raw.keep.as_deref().map(refname).transpose()?,
                keep_rule,
            })
        }
        "tools_fill_holes" => Op::FillHoles(name_ref(&value, "tools_fill_holes")?),
        "tools_label_area" => Op::LabelArea(parse_label_pick(&value, "tools_label_area")?),
        "tools_label_lines" => Op::LabelLines(parse_label_pick(&value, "tools_label_lines")?),
        "tools_grow" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                of: String,
                by: Mm,
            }
            let raw: Raw = json(&value, "tools_grow")?;
            Op::Grow(Grow { of: refname(&raw.of)?, by: raw.by })
        }
        "tools_buffer_lines" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                lines: String,
                by: Mm,
                #[serde(default)]
                cap: LineBufferCap,
            }
            let raw: Raw = json(&value, "tools_buffer_lines")?;
            Op::BufferLines(BufferLines { lines: refname(&raw.lines)?, by: raw.by, cap: raw.cap })
        }
        "tools_extend_to_frame" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                of: String,
                within: String,
                // Read and ignored: saved graphs still carry it.
                #[serde(rename = "min_height_frac")]
                _min_height_frac: Option<f64>,
                gap_mm: Option<Mm>,
            }
            let raw: Raw = json(&value, "tools_extend_to_frame")?;
            Op::ExtendToFrame(ExtendToFrame {
                of: refname(&raw.of)?,
                within: refname(&raw.within)?,
                gap_mm: raw.gap_mm,
            })
        }
        "tools_terrain" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                #[serde(default)]
                in_area: Option<String>,
                #[serde(default)]
                color: Option<serde_json::Value>,
                #[serde(default)]
                width: Option<serde_json::Value>,
                #[serde(default)]
                angle: Option<f64>,
                #[serde(default)]
                layer: Option<String>,
                #[serde(default)]
                shore: Option<bool>,
                #[serde(default)]
                style: Option<serde_json::Map<String, serde_json::Value>>,
                #[serde(default)]
                r#where: Option<serde_json::Map<String, serde_json::Value>>,
                #[serde(default)]
                draw: Option<String>,
            }
            let raw: Raw = json(&value, "tools_terrain")?;
            Op::Terrain(Terrain {
                in_area: raw.in_area.as_deref().map(refname).transpose()?,
                color: raw.color,
                width: raw.width,
                angle: raw.angle.unwrap_or(0.0),
                layer: raw.layer,
                style: raw.style.unwrap_or_default(),
                shore: raw.shore.unwrap_or(false),
                band: raw.r#where.unwrap_or_default(),
                draw: match raw.draw.as_deref() {
                    None | Some("lines") => TerrainDraw::Lines,
                    Some("fill") => TerrainDraw::Fill,
                    Some("dots") => TerrainDraw::Dots,
                    Some(other) => {
                        return Err(GrammarError::Invalid(format!(
                            "tools_terrain draws lines, a fill or dots, not {other:?}"
                        )))
                    }
                },
            })
        }
        "tools_burin" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                /// The atlas, as `burin.json()` writes it: a list, or the JSON
                /// string of one (the library hands a string).
                atlas: Value,
                #[serde(default)]
                in_area: Option<String>,
                #[serde(default)]
                regions: std::collections::BTreeMap<String, String>,
                #[serde(default)]
                layer: Option<String>,
            }
            let raw: Raw = json(&value, "tools_burin")?;
            let regions = raw
                .regions
                .into_iter()
                .map(|(name, r)| {
                    let n = refname(&r)?;
                    if n.section != Section::Areas {
                        return Err(GrammarError::Invalid(format!(
                            "tools_burin.regions.{name} must be an area, not {n}"
                        )));
                    }
                    Ok((name, n))
                })
                .collect::<Result<_, _>>()?;
            let atlas = match raw.atlas {
                Value::String(text) => {
                    serde_json::from_str(&text).map_err(|e| GrammarError::Invalid(format!("tools_burin atlas: {e}")))?
                }
                other => other,
            };
            if !atlas.is_array() {
                return Err(GrammarError::Invalid("tools_burin atlas is a list of batches and water passes".into()));
            }
            Op::Burin(Burin {
                atlas,
                in_area: raw.in_area.as_deref().map(refname).transpose()?,
                regions,
                layer: raw.layer,
            })
        }
        "tools_labels" => {
            let mut body = match value {
                Value::Object(m) => m,
                _ => return Err(GrammarError::Invalid("tools_labels takes { from, ...style }".into())),
            };
            let from: Vec<Name> = match body.remove("from") {
                Some(Value::String(s)) => vec![refname(&s)?],
                Some(Value::Array(items)) if !items.is_empty() => items
                    .iter()
                    .map(|v| v.as_str().ok_or_else(|| not_a_reference(v.to_string())).and_then(refname))
                    .collect::<Result<_, _>>()?,
                _ => return Err(GrammarError::Invalid("tools_labels needs from: $features.x or a list of them".into())),
            };
            if let Some(f) = from.iter().find(|f| f.section != Section::Features) {
                return Err(GrammarError::Invalid(format!("tools_labels.from has {f}, but it reads $features sets")));
            }
            let style: crate::labels::Style = json(&Value::Object(body), "tools_labels")?;
            crate::labels::validate_style(&style).map_err(GrammarError::Invalid)?;
            Op::Labels(Labels { from, style })
        }
        "tools_rings" => match &value {
            Value::String(s) => Op::Rings(Rings { of: refname(s)?, exterior_only: false }),
            _ => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Raw {
                    of: String,
                    #[serde(default)]
                    exterior_only: bool,
                }
                let raw: Raw = json(&value, "tools_rings")?;
                Op::Rings(Rings { of: refname(&raw.of)?, exterior_only: raw.exterior_only })
            }
        },
        "tools_lines" => Op::Lines(name_ref(&value, "tools_lines")?),
        "tools_segments" => Op::Segments(name_ref(&value, "tools_segments")?),
        "tools_dedupe" => Op::Dedupe(name_ref(&value, "tools_dedupe")?),
        "tools_merge" => Op::Merge(name_ref(&value, "tools_merge")?),
        "tools_join" => Op::Join(union_rules(&value, "tools_join")?),
        "tools_clip" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                lines: String,
                within: String,
                #[serde(default)]
                invert: bool,
            }
            let raw: Raw = json(&value, "tools_clip")?;
            Op::ClipLines(ClipLines { lines: refname(&raw.lines)?, within: refname(&raw.within)?, invert: raw.invert })
        }
        "tools_fill" => {
            // The v3 toolkit writes `pattern:` (dots, waves, zigzag…), the spec
            // calls it `generator:`; one rename and the rest is FillSpec.
            #[derive(Deserialize)]
            struct Raw {
                #[serde(rename = "in")]
                in_area: String,
                #[serde(default)]
                per: Option<String>,
                #[serde(default)]
                pattern: Option<String>,
                #[serde(default)]
                content: Option<String>,
                #[serde(flatten)]
                spec: FillSpec,
            }
            let mut raw: Raw = json(&value, "tools_fill")?;
            if let Some(pattern) = raw.pattern.take() {
                if raw.spec.generator.is_none() {
                    raw.spec.generator = Some(pattern);
                }
            }
            let per_feature = match raw.per.as_deref() {
                None => false,
                Some("feature") => true,
                Some(other) => {
                    return Err(GrammarError::Invalid(format!(
                        "tools_fill: per: {other:?} is unknown (only `per: feature`)"
                    )))
                }
            };
            let content = raw.content.as_deref().map(refname).transpose()?;
            if content.as_ref().is_some_and(|c| c.section != Section::Lines) {
                return Err(GrammarError::Invalid("tools_fill: content must be $lines".into()));
            }
            Op::Fill(Fill { in_area: refname(&raw.in_area)?, per_feature, content, spec: raw.spec })
        }
        _ => unreachable!("keys are matched above"),
    };
    Ok(op)
}

/// `tools_difference.cut`: a list of references, or one inline rule.
fn cut_rules(items: &[String], what: &str) -> Result<(Vec<Name>, Option<Box<Op>>), GrammarError> {
    if items.is_empty() {
        return Err(GrammarError::Invalid(format!("{what} needs at least one input")));
    }
    if items.len() == 1 {
        if let Ok(op) = serde_json::from_str::<RawOp>(&items[0]) {
            return Err(GrammarError::Invalid(format!(
                "{what}: inline rules are not supported yet; define it under $areas and use $areas.name ({op:?})"
            )));
        }
    }
    Ok((items.iter().map(|s| refname(s)).collect::<Result<_, _>>()?, None))
}

fn name_ref(value: &Value, op: &str) -> Result<Name, GrammarError> {
    let s: String = json(value, op)?;
    refname(&s)
}

fn parse_label_pick(value: &Value, op: &str) -> Result<LabelPick, GrammarError> {
    match value {
        Value::String(s) => {
            let of = refname(s)?;
            if of.section != Section::Lines {
                return Err(GrammarError::Invalid(format!("{op} reads {of}, but labels live under $lines")));
            }
            Ok(LabelPick { of, rule: None })
        }
        _ => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Raw {
                of: String,
                #[serde(default)]
                rule: Option<String>,
            }
            let raw: Raw = json(value, op)?;
            let of = refname(&raw.of)?;
            if of.section != Section::Lines {
                return Err(GrammarError::Invalid(format!("{op}.of is {of}, but labels live under $lines")));
            }
            Ok(LabelPick { of, rule: raw.rule })
        }
    }
}

fn label_pick_json(pick: &LabelPick) -> Value {
    if pick.rule.is_none() {
        Value::String(pick.of.to_string())
    } else {
        use serde_json::json;
        json!({ "of": pick.of.to_string(), "rule": pick.rule })
    }
}

/// `tools_union`: a list of references, or one reference with `list: false`.
fn union_rules(value: &Value, op: &str) -> Result<UnionRules, GrammarError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Raw {
        #[serde(default)]
        refs: Vec<String>,
        #[serde(default, rename = "ref")]
        single: Option<String>,
        #[serde(default)]
        list: Option<bool>,
        #[serde(default)]
        rule: Option<RawOp>,
    }
    match value {
        // The plain form: `tools_union: [{ tools_polygons: ... }, ...]`
        Value::Array(items) => {
            if items.is_empty() {
                return Err(GrammarError::Invalid(format!("{op} needs at least one input")));
            }
            Ok(UnionRules::Refs(inline_list(items, op)?))
        }
        Value::String(s) => Ok(UnionRules::Ref(refname(s)?)),
        Value::Object(_) => {
            let raw: Raw = json(value, op)?;
            if let Some(rule) = raw.rule {
                let parsed = parse_op(rule, Section::Areas)?;
                if parsed.section() != Section::Areas {
                    return Err(GrammarError::Invalid(format!(
                        "{op}: `rule` must produce an area"
                    )));
                }
                return Ok(UnionRules::Refs(parsed.refs()));
            }
            match (raw.single, raw.list, raw.refs.is_empty()) {
                (Some(s), Some(false), true) => Ok(UnionRules::Ref(refname(&s)?)),
                (Some(s), _, true) => Ok(UnionRules::Ref(refname(&s)?)),
                (None, _, false) => Ok(UnionRules::Refs(
                    raw.refs.iter().map(|s| refname(s)).collect::<Result<_, _>>()?,
                )),
                _ => Err(GrammarError::Invalid(format!(
                    "{op} needs a list of references (or `list: false` with one)"
                ))),
            }
        }
        other => Err(GrammarError::Invalid(format!("{op}: unexpected {other}"))),
    }
}

/// A list that may contain `$refs` and/or one inline rule.
/// v3 allows exactly one form: if a rule is present it must be the only item.
fn inline_list(items: &[Value], op: &str) -> Result<Vec<Name>, GrammarError> {
    let mut refs = Vec::new();
    let mut rules = 0usize;
    for item in items {
        match item {
            Value::String(s) => refs.push(refname(s)?),
            Value::Object(_) => rules += 1,
            other => return Err(GrammarError::Invalid(format!("{op}: unexpected item {other}"))),
        }
    }
    if rules > 1 || (rules == 1 && !refs.is_empty()) {
        return Err(GrammarError::Invalid(format!(
            "{op}: write one inline rule, or a list of $refs, not both"
        )));
    }
    Ok(refs)
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

impl OneOrMany {
    fn into_vec(self) -> Vec<String> {
        match self {
            OneOrMany::One(s) => vec![s],
            OneOrMany::Many(v) => v,
        }
    }
}

fn parse_tile_select(value: &Value) -> Result<TileSelect, GrammarError> {
    let items: Vec<String> = json::<OneOrMany>(value, "tiles_select")?
        .into_vec()
        .iter()
        .flat_map(|s| s.split(|c: char| c.is_whitespace()).map(str::to_string).collect::<Vec<_>>())
        .filter(|s| !s.is_empty())
        .collect();
    if items.is_empty() {
        return Err(GrammarError::Invalid("tiles_select needs a preset or a layer:class rule".into()));
    }
    let filter = terramask::Filter::parse(&items).map_err(|e| GrammarError::Invalid(format!("tiles_select: {e}")))?;
    Ok(TileSelect { items, filter })
}

fn parse_where(value: &Value) -> Result<Where, GrammarError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Raw {
        of: String,
        tags: serde_json::Map<String, Value>,
    }
    let raw: Raw = json(value, "tools_where")?;
    let of = refname(&raw.of)?;
    if of.section != Section::Features {
        return Err(GrammarError::Invalid(format!("tools_where.of is {of}, but it must be a $features set")));
    }
    if raw.tags.is_empty() {
        return Err(GrammarError::Invalid("tools_where needs at least one tag".into()));
    }
    let tags = crate::select::parse_tag_tests(raw.tags).map_err(|e| GrammarError::Invalid(format!("tools_where: {e}")))?;
    Ok(Where { of, tags })
}

fn parse_selector(value: &Value) -> Result<Selector, GrammarError> {
    #[derive(Deserialize)]
    struct Raw {
        #[serde(flatten)]
        any: BTreeMap<String, OneOrManyOrBool>,
        #[serde(default)]
        except: BTreeMap<String, OneOrManyOrBool>,
        #[serde(default)]
        underground: bool,
    }
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrManyOrBool {
        Bool(bool),
        One(String),
        Many(Vec<String>),
    }
    impl OneOrManyOrBool {
        fn to_match(&self) -> TagMatch {
            match self {
                OneOrManyOrBool::Bool(p) => TagMatch::Present(*p),
                OneOrManyOrBool::One(v) => TagMatch::Values(vec![v.clone()]),
                OneOrManyOrBool::Many(vs) => TagMatch::Values(vs.clone()),
            }
        }
    }
    let raw: Raw = json(value, "osm_select")?;
    if raw.any.is_empty() {
        return Err(GrammarError::Invalid("osm_select needs at least one tag".into()));
    }
    Ok(Selector {
        any: raw.any.iter().map(|(k, v)| (k.clone(), v.to_match())).collect(),
        except: raw.except.iter().map(|(k, v)| (k.clone(), v.to_match())).collect(),
        underground: raw.underground,
    })
}

// ---------------------------------------------------------------------------
// JSON: the graph saved and loaded
// ---------------------------------------------------------------------------

/// One operation from its JSON form, `{ "tools_union": ["$areas.a"] }`, as
/// the def it will be in `section`.
pub fn op_from_json(section: Section, op: Value) -> Result<Op, GrammarError> {
    let Value::Object(map) = op else {
        return Err(GrammarError::Invalid(format!("an operation is an object, not {op}")));
    };
    let raw = RawOp(map.into_iter().collect(), None);
    if raw.0.len() != 1 {
        return Err(GrammarError::Invalid("an operation has exactly one key".into()));
    }
    parse_op(raw, section)
}

fn tag_json(m: &TagMatch) -> Value {
    match m {
        TagMatch::Present(p) => Value::Bool(*p),
        TagMatch::Values(vs) if vs.len() == 1 => Value::String(vs[0].clone()),
        TagMatch::Values(vs) => vs.iter().cloned().map(Value::String).collect(),
    }
}

fn refs_json(names: &[Name]) -> Value {
    names.iter().map(|n| Value::String(n.to_string())).collect()
}

/// The JSON form [`op_from_json`] reads back.
pub fn op_to_json(op: &Op) -> Value {
    use serde_json::json;
    let union = |u: &UnionRules| match u {
        UnionRules::Refs(ns) => refs_json(ns),
        UnionRules::Ref(n) => Value::String(n.to_string()),
    };
    let (key, value) = match op {
        Op::Select(sel) => {
            let mut body: serde_json::Map<String, Value> =
                sel.any.iter().map(|(k, m)| (k.clone(), tag_json(m))).collect();
            if !sel.except.is_empty() {
                body.insert("except".into(), sel.except.iter().map(|(k, m)| (k.clone(), tag_json(m))).collect());
            }
            if sel.underground {
                body.insert("underground".into(), Value::Bool(true));
            }
            ("osm_select", Value::Object(body))
        }
        Op::TileSelect(t) => ("tiles_select", t.items.iter().cloned().map(Value::String).collect()),
        Op::Where(w) => {
            let tags: serde_json::Map<String, Value> = w
                .tags
                .iter()
                .map(|(k, t)| {
                    let v = match t {
                        TagTest::Match(m) => tag_json(m),
                        TagTest::Range { min, max } => {
                            let mut r = serde_json::Map::new();
                            if let Some(lo) = min {
                                r.insert("min".into(), json!(lo));
                            }
                            if let Some(hi) = max {
                                r.insert("max".into(), json!(hi));
                            }
                            Value::Object(r)
                        }
                    };
                    (k.clone(), v)
                })
                .collect();
            ("tools_where", json!({ "of": w.of.to_string(), "tags": tags }))
        }
        Op::Polygons(n) => ("tools_polygons", Value::String(n.to_string())),
        Op::Union(u) => ("tools_union", union(u)),
        Op::Difference(d) => ("tools_difference", json!({ "base": d.base.to_string(), "cut": refs_json(&d.cut) })),
        Op::Intersect(i) => (
            "tools_intersect",
            json!({ "base": i.base.to_string(), "keep": i.keep.as_ref().map(Name::to_string) }),
        ),
        Op::FillHoles(n) => ("tools_fill_holes", Value::String(n.to_string())),
        Op::LabelArea(p) => ("tools_label_area", label_pick_json(p)),
        Op::LabelLines(p) => ("tools_label_lines", label_pick_json(p)),
        Op::Terrain(t) => {
            let mut body = serde_json::Map::new();
            if let Some(a) = &t.in_area {
                body.insert("in_area".into(), Value::String(a.to_string()));
            }
            if let Some(c) = &t.color {
                body.insert("color".into(), c.clone());
            }
            if let Some(w) = &t.width {
                body.insert("width".into(), w.clone());
            }
            if t.angle != 0.0 {
                body.insert("angle".into(), json!(t.angle));
            }
            if let Some(l) = &t.layer {
                body.insert("layer".into(), Value::String(l.clone()));
            }
            if t.shore {
                body.insert("shore".into(), Value::Bool(true));
            }
            if !t.style.is_empty() {
                body.insert("style".into(), Value::Object(t.style.clone()));
            }
            if !t.band.is_empty() {
                body.insert("where".into(), Value::Object(t.band.clone()));
            }
            match t.draw {
                TerrainDraw::Lines => {}
                TerrainDraw::Fill => {
                    body.insert("draw".into(), Value::String("fill".into()));
                }
                TerrainDraw::Dots => {
                    body.insert("draw".into(), Value::String("dots".into()));
                }
            }
            ("tools_terrain", Value::Object(body))
        }
        Op::Burin(b) => {
            let mut body = serde_json::Map::new();
            body.insert("atlas".into(), b.atlas.clone());
            if let Some(a) = &b.in_area {
                body.insert("in_area".into(), Value::String(a.to_string()));
            }
            if !b.regions.is_empty() {
                body.insert(
                    "regions".into(),
                    Value::Object(
                        b.regions
                            .iter()
                            .map(|(k, v)| (k.clone(), Value::String(v.to_string())))
                            .collect(),
                    ),
                );
            }
            if let Some(l) = &b.layer {
                body.insert("layer".into(), Value::String(l.clone()));
            }
            ("tools_burin", Value::Object(body))
        }
        Op::Labels(l) => {
            let mut body = serde_json::to_value(&l.style).unwrap_or_else(|_| json!({}));
            body["from"] = refs_json(&l.from);
            ("tools_labels", body)
        }
        Op::Grow(g) => ("tools_grow", json!({ "of": g.of.to_string(), "by": g.by })),
        Op::BufferLines(b) => {
            let mut body = serde_json::Map::from_iter([
                ("lines".into(), Value::String(b.lines.to_string())),
                ("by".into(), json!(b.by)),
            ]);
            if b.cap == LineBufferCap::Flat {
                body.insert("cap".into(), json!("flat"));
            }
            ("tools_buffer_lines", Value::Object(body))
        }
        Op::Frame => ("engine_frame", json!({})),
        Op::ExtendToFrame(e) => (
            "tools_extend_to_frame",
            json!({
                "of": e.of.to_string(),
                "within": e.within.to_string(),
                "gap_mm": e.gap_mm,
            }),
        ),
        Op::Rings(r) => ("tools_rings", json!({ "of": r.of.to_string(), "exterior_only": r.exterior_only })),
        Op::Lines(n) => ("tools_lines", Value::String(n.to_string())),
        Op::Segments(n) => ("tools_segments", Value::String(n.to_string())),
        Op::Dedupe(n) => ("tools_dedupe", Value::String(n.to_string())),
        Op::Merge(n) => ("tools_merge", Value::String(n.to_string())),
        Op::Join(u) => ("tools_join", union(u)),
        Op::ClipLines(c) => (
            "tools_clip",
            json!({ "lines": c.lines.to_string(), "within": c.within.to_string(), "invert": c.invert }),
        ),
        Op::Fill(f) => {
            let mut body = serde_json::to_value(&f.spec).unwrap_or_else(|_| json!({}));
            body["in"] = Value::String(f.in_area.to_string());
            if f.per_feature {
                body["per"] = Value::String("feature".into());
            }
            if let Some(c) = &f.content {
                body["content"] = Value::String(c.to_string());
            }
            ("tools_fill", body)
        }
        Op::Module(m) => {
            let key = format!("module_{}", m.name);
            let body = match &m.from {
                Some(from) => json!({ "from": from.to_string() }),
                None => json!({}),
            };
            return json!({ key: body });
        }
    };
    json!({ key: value })
}

impl Target {
    fn to_json(&self) -> Value {
        match &self.module {
            Some(m) => Value::String(format!("{m}.{}", self.name.name)),
            None => Value::String(self.name.to_string()),
        }
    }
}

impl Grammar {
    /// The graph as JSON: what a script built, for presets, `--dump-graph`
    /// and the page's worker. [`Grammar::from_json`] reads it back.
    pub fn to_json(&self) -> Value {
        use serde_json::json;
        let mut out = serde_json::Map::new();
        if let Some(t) = &self.title {
            out.insert("title".into(), Value::String(t.clone()));
        }
        out.insert("output".into(), serde_json::to_value(&self.output).unwrap_or(Value::Null));
        for (section, defs) in &self.sections {
            let body: serde_json::Map<String, Value> = defs
                .iter()
                .map(|d| {
                    let mut op = op_to_json(&d.op);
                    if let Some(at) = d.at {
                        op["at"] = json!(at);
                    }
                    (d.name.clone(), op)
                })
                .collect();
            out.insert(format!("${}", section.key()), Value::Object(body));
        }
        let draw: Vec<Value> = self
            .draw
            .iter()
            .map(|d| {
                let mut v = json!({ "from": d.from.to_json() });
                if let Some(id) = &d.id {
                    v["id"] = json!(id);
                }
                if let Some(s) = &d.stroke {
                    v["stroke"] = json!(s);
                }
                if let Some(at) = d.at {
                    v["at"] = json!(at);
                }
                v
            })
            .collect();
        out.insert("draw".into(), Value::Array(draw));
        let masks: serde_json::Map<String, Value> = self
            .compose
            .masks
            .iter()
            .map(|(name, m)| {
                let mut v = json!({
                    "from": m.from.to_json(),
                    "occludes": m.occludes.iter().map(|i| i.0.clone()).collect::<Vec<_>>(),
                });
                if let Some(at) = m.at {
                    v["at"] = json!(at);
                }
                (name.clone(), v)
            })
            .collect();
        let clip = match &self.compose.clip_default {
            Clip::Auto => json!("auto"),
            Clip::None => json!("none"),
            Clip::Areas(ns) => refs_json(ns),
        };
        out.insert(
            "compose".into(),
            json!({
                "order": self.compose.order.iter().map(|i| i.0.clone()).collect::<Vec<_>>(),
                "masks": masks,
                "clip": { "default": clip },
            }),
        );
        Value::Object(out)
    }

    pub fn from_json(text: &str) -> Result<Grammar, GrammarError> {
        let raw: Raw = serde_json::from_str(text).map_err(|e| GrammarError::Json(e.to_string()))?;
        build(raw)
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn validate_label_pick(g: &Grammar, def: &Def, pick: &LabelPick) -> Result<(), GrammarError> {
    let labels = g.find(&pick.of).ok_or_else(|| {
        GrammarError::Invalid(format!("{} reads {}, which is not defined", def.label(), pick.of))
    })?;
    if !matches!(&labels.op, Op::Labels(_)) {
        return Err(GrammarError::Invalid(format!("{} reads {}, which is not a labels def", def.label(), pick.of)));
    }
    if let Some(rule) = &pick.rule {
        let Op::Labels(l) = &labels.op else { unreachable!() };
        if !l.style.rule_ids().iter().any(|id| id == rule) {
            return Err(GrammarError::Invalid(format!(
                "{}: rule {:?} is not a labels.rules[].id on {}",
                def.label(),
                rule,
                pick.of
            )));
        }
    }
    Ok(())
}

/// Every reference defined in the right section, draw ids unique, order and
/// masks naming draw ids, no loops.
pub fn validate(g: &Grammar) -> Result<(), GrammarError> {
    // Every reference must exist, in the right section.
    for def in g.all_defs() {
        for r in def.op.refs() {
            if g.find(&r).is_none() {
                return Err(GrammarError::Invalid(format!(
                    "{} refers to {r}, which is not defined under ${}",
                    def.label(),
                    r.section
                )));
            }
        }
        if let Op::LabelArea(pick) | Op::LabelLines(pick) = &def.op {
            validate_label_pick(g, def, pick)?;
        }
    }
    // A draw must point at line output: $lines, $fills, or a module output.
    for d in &g.draw {
        if d.from.module.is_some() {
            continue; // e.g. roads.outlines: the module owns the name
        }
        if !matches!(d.from.name.section, Section::Lines | Section::Fills) {
            return Err(GrammarError::Invalid(located(
                &format!("draw from {} needs $lines or $fills, not ${}", d.from.name, d.from.name.section),
                d.at,
            )));
        }
        if g.find(&d.from.name).is_none() {
            return Err(GrammarError::Invalid(format!("draw from {}: no such def", d.from.name)));
        }
    }
    let mut groups: BTreeSet<String> = BTreeSet::new();
    for d in &g.draw {
        if !groups.insert(d.group()) {
            return Err(GrammarError::Invalid(located(
                &format!("two draw entries write the same SVG group id {:?}", d.group()),
                d.at,
            )));
        }
    }
    // Order and occludes must name draw groups.
    for id in &g.compose.order {
        if !groups.contains(&id.0) {
            return Err(GrammarError::Invalid(format!("compose.order names {:?}, which is not a draw id", id.0)));
        }
    }
    for (name, mask) in &g.compose.masks {
        if mask.from.module.is_some() {
            // e.g. roads.area: an area published by a module.
        } else if mask.from.name.section != Section::Areas {
            return Err(GrammarError::Invalid(located(
                &format!("masks.{name}.from is {}, but a mask must be an area", mask.from.name),
                mask.at,
            )));
        } else if g.find(&mask.from.name).is_none() {
            return Err(GrammarError::Invalid(located(
                &format!("masks.{name}.from: no such def {}", mask.from.name),
                mask.at,
            )));
        }
        for id in &mask.occludes {
            if !groups.contains(&id.0) {
                return Err(GrammarError::Invalid(located(
                    &format!("masks.{name}.occludes names {:?}, which is not a draw id", id.0),
                    mask.at,
                )));
            }
        }
    }
    for (id, clip) in &g.compose.clip {
        if !groups.contains(&id.0) {
            return Err(GrammarError::Invalid(format!("compose.clip names {:?}, which is not a draw id", id.0)));
        }
        if let Clip::Areas(names) = clip {
            for n in names {
                if n.section != Section::Areas || g.find(n).is_none() {
                    return Err(GrammarError::Invalid(format!("compose.clip[{:?}]: {n} is not an area def", id.0)));
                }
            }
        }
    }
    // No loops across defs.
    if let Some(cycle) = find_cycle(g) {
        return Err(GrammarError::Invalid(format!("loop between defs: {}", cycle.join(" → "))));
    }
    Ok(())
}

fn find_cycle(g: &Grammar) -> Option<Vec<String>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Open,
        Done,
    }
    fn visit(
        g: &Grammar,
        name: &Name,
        marks: &mut BTreeMap<Name, Mark>,
        path: &mut Vec<Name>,
    ) -> Option<Vec<String>> {
        match marks.get(name) {
            Some(Mark::Done) => return None,
            Some(Mark::Open) => {
                let at = path.iter().position(|p| p == name).unwrap_or(0);
                let mut loop_names: Vec<String> = path[at..].iter().map(Name::to_string).collect();
                loop_names.push(name.to_string());
                return Some(loop_names);
            }
            None => {}
        }
        marks.insert(name.clone(), Mark::Open);
        path.push(name.clone());
        if let Some(def) = g.find(name) {
            for r in def.op.refs() {
                if let Some(cycle) = visit(g, &r, marks, path) {
                    return Some(cycle);
                }
            }
        }
        path.pop();
        marks.insert(name.clone(), Mark::Done);
        None
    }

    let mut marks = BTreeMap::new();
    let mut path = Vec::new();
    for def in g.all_defs() {
        if !marks.contains_key(&def.reference()) {
            if let Some(cycle) = visit(g, &def.reference(), &mut marks, &mut path) {
                return Some(cycle);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The example profile, trimmed to the parts the grammar must accept.
    const YAML: &str = r#"
output: { width: 6in, height: 4in, scale: "1:10000" }

$features:
  garden: { osm_select: { leisure: garden } }
  bldg:   { osm_select: { building: true } }

$areas:
  garden:     { tools_polygons: $features.garden }
  parks:      { tools_union: [$areas.garden] }
  parks_ext:  { tools_fill_holes: $areas.parks }
  footprints: { tools_polygons: $features.bldg }
  dissolved:  { tools_union: [$areas.footprints] }
  inner_band: { tools_grow: { of: $areas.dissolved, by: -0.1mm } }
  wet:        { tools_union: [$areas.garden] }

$lines:
  parks_edge: { tools_rings: { of: $areas.parks_ext, exterior_only: true } }
  bldg_lines: { tools_segments: $features.bldg }
  bldg_dedupe: { tools_dedupe: $lines.bldg_lines }
  walls:      { tools_clip: { lines: $lines.bldg_dedupe, within: $areas.inner_band } }

$fills:
  hatch: { tools_fill: { in: $areas.footprints, per: feature, pattern: zigzag, spacing: 0.5mm, angle: 45 } }

draw:
  - { id: parks_ring, from: $lines.parks_edge, stroke: { style: dash, dash: 0.45mm, gap: 0.40mm } }
  - { from: $fills.hatch }
  - { id: bldg_wall, from: $lines.walls, stroke: solid }

compose:
  order: [parks_ring, fills_hatch, bldg_wall]
  masks:
    bldg_cover: { from: $areas.dissolved, occludes: [parks_ring] }
  clip:
    default: auto
"#;

    /// The tests below write only the part under test; the output is boilerplate.
    fn parse(text: &str) -> Result<Grammar, GrammarError> {
        let body = if text.contains("output:") {
            text.to_string()
        } else {
            format!("output: {{ width: 100mm, height: 50mm }}\n{text}")
        };
        from_yaml(&body)
    }

    #[test]
    fn parses_the_example_and_types_its_sections() {
        let g = parse(YAML).unwrap();
        assert_eq!(g.defs(Section::Features).len(), 2);
        assert_eq!(g.defs(Section::Areas).len(), 7);
        assert_eq!(g.defs(Section::Lines).len(), 4);
        assert_eq!(g.defs(Section::Fills).len(), 1);
        let dissolved = Name::parse("$areas.dissolved").unwrap();
        assert_eq!(g.find(&dissolved).unwrap().op.section(), Section::Areas);
    }

    #[test]
    fn a_title_is_optional_and_kept_as_written() {
        assert_eq!(parse(YAML).unwrap().title, None);
        let g = parse(&format!("title: \"Parks: and buildings\"\n{YAML}")).unwrap();
        assert_eq!(g.title.as_deref(), Some("Parks: and buildings"));
    }

    #[test]
    fn ids_fall_back_to_the_def_name() {
        let g = parse(YAML).unwrap();
        assert_eq!(g.groups(), vec!["parks_ring", "fills_hatch", "bldg_wall"]);
    }

    #[test]
    fn a_reference_must_exist_and_carry_its_section() {
        let bad = "$areas:\n  a: { tools_polygons: $features.nope }\n";
        assert!(matches!(parse(bad), Err(GrammarError::Invalid(m)) if m.contains("$features.nope")));
        let bad = "$areas:\n  a: { tools_polygons: $lines.nope }\n";
        assert!(matches!(parse(bad), Err(GrammarError::Invalid(m)) if m.contains("$lines.nope")));
    }

    #[test]
    fn an_operation_must_match_its_section() {
        // tools_rings makes lines; under $areas it is an error.
        let bad = "$areas:\n  a: { tools_rings: $areas.b }\n";
        assert!(matches!(
            parse(bad),
            Err(GrammarError::Invalid(m)) if m.contains("lines") && m.contains("areas")
        ));
    }

    #[test]
    fn draw_needs_line_output_and_masks_need_areas() {
        let base = "$features:\n  f: { osm_select: { building: true } }\n\
                    $areas:\n  a: { tools_polygons: $features.f }\n\
                    $lines:\n  l: { tools_rings: $areas.a }\n";
        // draw from an area: refused
        assert!(parse(&format!("{base}draw:\n  - {{ from: $areas.a }}\n")).is_err());
        // mask from a line set: refused
        let text = format!("{base}draw:\n  - {{ from: $lines.l }}\ncompose:\n  masks:\n    m: {{ from: $lines.l }}\n");
        assert!(matches!(parse(&text), Err(GrammarError::Invalid(m)) if m.contains("must be an area")));
    }

    #[test]
    fn loops_and_unknown_operations_are_load_errors() {
        let looped = "$areas:\n  a: { tools_union: [$areas.b] }\n  b: { tools_grow: { of: $areas.a, by: 1mm } }\n";
        assert!(matches!(parse(looped), Err(GrammarError::Invalid(m)) if m.contains("loop")));
        let unknown = "$areas:\n  a: { tools_bogus: 1 }\n";
        assert!(matches!(parse(unknown), Err(GrammarError::Invalid(m)) if m.contains("unknown operation")));
    }

    #[test]
    fn one_operation_per_def() {
        let two = "$areas:\n  a: { tools_polygons: $areas.b, engine_frame: {} }\n  b: { engine_frame: {} }\n";
        assert!(matches!(parse(two), Err(GrammarError::Json(m)) if m.contains("exactly one operation")));
    }

    #[test]
    fn modules_are_recorded_and_bad_references_named() {
        let module = "$lines:\n  roads: { module_roads: {} }\n";
        let g = parse(module).unwrap();
        assert_eq!(g.defs(Section::Lines)[0].op, Op::Module(Module { name: "roads".into(), from: None }));
        let bad_ref = "$areas:\n  a: { tools_union: [dense] }\n";
        assert!(matches!(parse(bad_ref), Err(GrammarError::Invalid(m)) if m.contains("\"dense\" is not a $section.name reference")));
        let bad_len = "$fills:\n  f: { tools_fill: { in: $areas.a, spacing: dense } }\n$areas:\n  a: { engine_frame: {} }\n";
        assert!(parse(bad_len).is_err());
    }

    #[test]
    fn tile_selections_and_modules_reading_them() {
        let text = "$features:\n  bldg: { tiles_select: buildings }\n  ways: { tiles_select: [roads, \"paths\"] }\n  sea: { tiles_select: ocean }\n\
                    $areas:\n  roads: { module_roads: { from: $features.ways } }\n";
        let g = parse(text).unwrap();
        assert_eq!(g.tile_selectors(), ["buildings", "roads", "paths", "ocean"]);
        assert!(g.osm_keys().is_empty(), "nothing reads Overpass");
        assert!(g.draws_ocean());
        assert_eq!(g.find(&Name::parse("$areas.roads").unwrap()).unwrap().op.refs(), [Name::parse("$features.ways").unwrap()]);
        let osm = parse("$areas:\n  roads: { module_roads: {} }\n").unwrap();
        assert!(osm.osm_keys().contains(&"highway".to_string()) && osm.tile_selectors().is_empty());
        assert!(matches!(parse("$features:\n  a: { tiles_select: forrest }\n"), Err(GrammarError::Invalid(m)) if m.contains("preset")));
        assert!(parse("$areas:\n  r: { module_roads: { from: $areas.r } }\n").is_err());
        assert!(parse("$areas:\n  r: { module_roads: { form: $features.x } }\n").is_err());
    }

    #[test]
    fn duplicate_names_and_extra_keys_are_refused() {
        let dup = r#"{ "output": {}, "$areas": { "a": { "engine_frame": {} }, "a": { "engine_frame": {} } } }"#;
        assert!(matches!(Grammar::from_json(dup), Err(GrammarError::Invalid(m)) if m.contains("defined twice")));
        let extra = "$areas:\n  a: { engine_frame: {}, note: hi }\n";
        assert!(parse(extra).is_err());
    }

    #[test]
    fn the_graph_round_trips_through_json() {
        let g = parse(YAML).unwrap();
        let json = g.to_json().to_string();
        let back = Grammar::from_json(&json).unwrap();
        assert_eq!(back, g);
        assert_eq!(back.to_json().to_string(), json);
    }

    #[test]
    fn script_positions_ride_along_and_label_errors() {
        let mut g = parse(YAML).unwrap();
        g.sections[1].1[0].at = Some(At(12, 5));
        let back = Grammar::from_json(&g.to_json().to_string()).unwrap();
        assert_eq!(back.sections[1].1[0].at, Some(At(12, 5)));
        assert_eq!(back.sections[1].1[0].label(), "$areas.garden (line 12 column 5)");
        let mut bad = g.to_json();
        bad["$areas"]["garden"]["tools_polygons"] = Value::String("$features.nope".into());
        let err = Grammar::from_json(&bad.to_string()).unwrap_err().to_string();
        assert!(err.contains("line 12 column 5"), "{err}");
    }

    #[test]
    fn label_area_accepts_a_rule_bucket_object() {
        let text = r#"{
          "output": { "width": "100mm", "height": "50mm" },
          "$features": { "p": { "tiles_select": ["parks"] } },
          "$lines": { "names": { "tools_labels": { "from": ["$features.p"], "rules": [{ "id": "park", "tags": { "class": "park" } }] } } },
          "$areas": { "park": { "tools_label_area": { "of": "$lines.names", "rule": "park" } } }
        }"#;
        let g = Grammar::from_json(text).unwrap();
        let def = g.defs(Section::Areas).iter().find(|d| d.name == "park").unwrap();
        let Op::LabelArea(pick) = &def.op else { panic!("label area") };
        assert_eq!(pick.rule.as_deref(), Some("park"));
    }
}
