//! The v3 profile grammar: marked sections, namespaced operations, an explicit
//! stack.
//!
//! ```yaml
//! card: { width: 6in, height: 4in, scale: "1:10000" }
//!
//! $features:
//!   bldg: { osm_select: { building: true } }
//! $areas:
//!   footprints: { tools_polygons: $features.bldg }
//!   dissolved:  { tools_union: [$areas.footprints] }
//! $lines:
//!   shell: { tools_rings: $areas.dissolved }
//! $fills:
//!   hatch: { tools_fill: { in: $areas.footprints, per: feature, pattern: zigzag, spacing: 0.5mm } }
//!
//! draw:
//!   - { id: bldg_shell, from: $lines.shell, stroke: solid }
//!   - { from: $fills.hatch }          # id omitted: the group is fills_hatch
//!
//! compose:
//!   order: [bldg_shell, fills_hatch]
//!   masks:
//!     bldg_cover: { from: $areas.dissolved, occludes: [bldg_shell] }
//!   clip:
//!     default: auto
//! ```
//!
//! Four families of names, told apart by their prefix:
//!
//! - `$section.name` — yours, defined in this file. The section gives the type.
//! - `tools_*` — kit operations (this module).
//! - `osm_*` / `engine_*` — sources: OSM selections, the card, the ocean.
//! - `module_*` / `primitives_*` — canned recipes. `module_*` is compiled code
//!   (roads); `primitives_*` expands into `tools_*` and is defined here.
//!
//! Expressions (`~name`) are recognised and rejected: they land in v4.
//!
//! Parsing is strict: unknown sections, operations and names are errors at
//! load, never halfway through a render.

use crate::profile::{FillSpec, StrokeSpec};
use crate::steps::{Selector, TagMatch};
use crate::units::Mm;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::Deserialize;
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
    /// Parse `$<section>.<name>`. Anything else (a bare word, a `~expression`)
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Id(pub String);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/// A tag filter, as `osm_select: { building: true, highway: [primary] }`.
pub type Select = Vec<(String, TagMatch)>;

/// Buffer a shape by a distance, positive or negative.
#[derive(Debug, Clone, PartialEq)]
pub struct Grow {
    pub of: Name,
    pub by: Mm,
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

/// A penfill run. `per: feature` runs one pattern per polygon instead of one
/// on the union.
#[derive(Debug, Clone, PartialEq)]
pub struct Fill {
    pub in_area: Name,
    pub per_feature: bool,
    pub spec: FillSpec,
}

/// One operation. Every variant names the section it produces.
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    // ---- feature sets ----------------------------------------------------
    Select(Selector),

    // ---- areas -----------------------------------------------------------
    Polygons(Name),
    Union(UnionRules),
    Difference(Difference),
    Intersect(Intersect),
    FillHoles(Name),
    Grow(Grow),
    /// The card rectangle.
    Card,
    /// The sea, fetched by the host. Not an OSM tag.
    Ocean,

    // ---- lines -----------------------------------------------------------
    Rings(Rings),
    Lines(Name),
    Segments(Name),
    Dedupe(Name),
    Merge(Name),
    Join(UnionRules),
    ClipLines(ClipLines),

    // ---- fills (lines, produced by penfill) -------------------------------
    Fill(Fill),

    // ---- compiled modules (roads) ----------------------------------------
    /// Recognised and validated, but not yet wired into the render: the module
    /// publishes named outputs (`roads.area`, `roads.outlines`, …) that v3 has
    /// no way to reference. Until they exist, this is a placeholder.
    Module(String),
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
            Op::Select(_) => Section::Features,
            Op::Polygons(_)
            | Op::Union(_)
            | Op::Difference(_)
            | Op::Intersect(_)
            | Op::FillHoles(_)
            | Op::Grow(_)
            | Op::Card
            | Op::Ocean => Section::Areas,
            Op::Rings(_) | Op::Lines(_) | Op::Segments(_) | Op::Dedupe(_) | Op::Merge(_) | Op::Join(_)
            | Op::ClipLines(_) => Section::Lines,
            Op::Fill(_) => Section::Fills,
            // Outputs depend on the module; none exists yet.
            Op::Module(_) => Section::Lines,
        }
    }

    /// The names this operation reads.
    pub fn refs(&self) -> Vec<Name> {
        match self {
            Op::Select(_) | Op::Card | Op::Ocean | Op::Module(_) => vec![],
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
            Op::Rings(r) => vec![r.of.clone()],
            Op::ClipLines(c) => vec![c.lines.clone(), c.within.clone()],
            Op::Fill(f) => vec![f.in_area.clone()],
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
            (Op::Grow(a), Op::Grow(b)) => a.of == b.of,
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

/// A def: the name you chose, and the one operation it runs.
#[derive(Debug, Clone, PartialEq)]
pub struct Def {
    pub name: String,
    pub op: Op,
}

impl Def {
    /// The reference other defs use to reach this one.
    pub fn reference(&self) -> Name {
        Name { section: self.op.section(), name: self.name.clone() }
    }
}

// ---------------------------------------------------------------------------
// draw: and compose:
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Draw {
    /// SVG group id. `None` falls back to the def name (`fills_hatch`).
    pub id: Option<String>,
    pub from: Output,
    pub stroke: Option<StrokeSpec>,
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
    pub from: Output,
    pub occludes: Vec<Id>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Clip {
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

impl Default for Clip {
    fn default() -> Self {
        Clip::Auto
    }
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Grammar {
    pub card: crate::profile::MapSpec,
    /// Sections in the order they were written, each with its defs.
    pub sections: Vec<(Section, Vec<Def>)>,
    pub draw: Vec<Draw>,
    pub compose: Compose,
}

impl Grammar {
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

    /// The SVG group each draw entry writes.
    pub fn groups(&self) -> Vec<String> {
        self.draw.iter().map(Draw::group).collect()
    }
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum GrammarError {
    #[error("YAML: {0}")]
    Yaml(String),
    #[error("JSON5: {0}")]
    Json5(String),
    #[error("profile: {0}")]
    Invalid(String),
}

/// Raw shape: sections as written, before validation.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    card: crate::profile::MapSpec,
    #[serde(default, rename = "$features", deserialize_with = "ordered_defs")]
    features: Vec<(String, RawOp)>,
    #[serde(default, rename = "$areas", deserialize_with = "ordered_defs")]
    areas: Vec<(String, RawOp)>,
    #[serde(default, rename = "$lines", deserialize_with = "ordered_defs")]
    lines: Vec<(String, RawOp)>,
    #[serde(default, rename = "$fills", deserialize_with = "ordered_defs")]
    fills: Vec<(String, RawOp)>,
    /// Recognised so the error is clear, not "unknown field".
    #[serde(default, rename = "$expressions")]
    expressions: Option<Value>,
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
}

/// One operation, as a single-key mapping. The key picks the variant; a def
/// with several keys is an error (one operation per def).
#[derive(Debug)]
struct RawOp(BTreeMap<String, Value>);

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
                while let Some((k, v)) = map.next_entry::<String, Value>()? {
                    entries.insert(k, v);
                }
                if entries.len() != 1 {
                    let keys: Vec<&str> = entries.keys().map(String::as_str).collect();
                    return Err(de::Error::custom(format!(
                        "a def takes exactly one operation, found {}: {}",
                        entries.len(),
                        keys.join(", ")
                    )));
                }
                Ok(RawOp(entries))
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

impl Grammar {
    pub fn parse(text: &str, format: crate::profile::Format) -> Result<Grammar, GrammarError> {
        let raw: Raw = match format {
            crate::profile::Format::Yaml => serde_saphyr::from_str(text).map_err(|e| GrammarError::Yaml(e.to_string()))?,
            crate::profile::Format::Json5 => json5::from_str(text).map_err(|e| GrammarError::Json5(e.to_string()))?,
        };
        if raw.expressions.is_some() {
            return Err(GrammarError::Invalid(
                "$expressions is recognised but not implemented yet; expressions land in v4".into(),
            ));
        }
        build(raw)
    }
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
            let op = parse_op(raw_op, section)?;
            defs.push(Def { name, op });
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

    let grammar = Grammar { card: raw.card, sections, draw, compose };
    validate(&grammar)?;
    Ok(grammar)
}

/// Recognise `~name` early so the error mentions expressions, not a bad name.
fn expr_or_name(text: String) -> GrammarError {
    if text.starts_with('~') {
        GrammarError::Invalid(format!("{text:?} is an expression; expressions land in v4"))
    } else {
        GrammarError::Invalid(format!("{text:?} is not a $section.name reference"))
    }
}

/// `Name::parse` in a context that already returns `GrammarError`.

/// `$lines.x`, `$fills.x`, or `roads.outlines` (a module output).
fn parse_output(text: &str) -> Result<Output, GrammarError> {
    if let Some(rest) = text.strip_prefix('$') {
        return Ok(Output { module: None, name: refname(&format!("${rest}"))? });
    }
    if text.starts_with('~') {
        return Err(GrammarError::Invalid(format!("{text:?} is an expression; expressions land in v4")));
    }
    match text.split_once('.') {
        Some((module, name)) if !name.is_empty() => {
            Ok(Output { module: Some(module.to_string()), name: Name { section: Section::Lines, name: name.to_string() } })
        }
        _ => Err(GrammarError::Invalid(format!(
            "{text:?} is not a reference: write $lines.x, $fills.x or <module>.<output>"
        ))),
    }
}

fn refname(text: &str) -> Result<Name, GrammarError> {
    Name::parse(text).map_err(|_| expr_or_name(text.to_string()))
}

/// A draw/`from` target: `$lines.x` / `$fills.x`, or `roads.outlines` (a module
/// output, which has no `$` because the engine produced it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    /// `None` = a `$section.name` def; `Some(module)` = a module output.
    pub module: Option<String>,
    pub name: Name,
}

fn parse_op(raw: RawOp, section: Section) -> Result<Op, GrammarError> {
    let (key, value) = only_op(raw).map_err(GrammarError::Invalid)?;
    let target = match key.as_str() {
        "osm_select" => Section::Features,
        "tools_polygons" | "tools_union" | "tools_difference" | "tools_intersect" | "tools_fill_holes"
        | "tools_grow" | "engine_card" | "engine_ocean" => Section::Areas,
        "tools_rings" | "tools_lines" | "tools_segments" | "tools_dedupe" | "tools_merge" | "tools_join"
        | "tools_clip" => Section::Lines,
        "tools_fill" => Section::Fills,
        other => {
            if let Some(rest) = other.strip_prefix("module_") {
                return Ok(Op::Module(rest.to_string()));
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
        "engine_card" => Op::Card,
        "engine_ocean" => Op::Ocean,
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
            // No `deny_unknown_fields`: `per` and `in` are ours, everything
            // else belongs to FillSpec, which is permissive by design.
            #[derive(Deserialize)]
            struct Raw {
                #[serde(rename = "in")]
                in_area: String,
                #[serde(default)]
                per: Option<String>,
                #[serde(flatten)]
                spec: FillSpec,
            }
            let raw: Raw = json(&value, "tools_fill")?;
            let per_feature = match raw.per.as_deref() {
                None => false,
                Some("feature") => true,
                Some(other) => {
                    return Err(GrammarError::Invalid(format!(
                        "tools_fill: per: {other:?} is unknown (only `per: feature`)"
                    )))
                }
            };
            Op::Fill(Fill { in_area: refname(&raw.in_area)?, per_feature, spec: raw.spec })
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
// Validation
// ---------------------------------------------------------------------------

fn validate(g: &Grammar) -> Result<(), GrammarError> {
    // Every reference must exist, in the right section.
    for def in g.all_defs() {
        for r in def.op.refs() {
            if g.find(&r).is_none() {
                return Err(GrammarError::Invalid(format!(
                    "{} refers to {r}, which is not defined under ${}",
                    def.reference(),
                    r.section
                )));
            }
        }
    }
    // A draw must point at line output: $lines, $fills, or a module output.
    for d in &g.draw {
        if d.from.module.is_some() {
            continue; // e.g. roads.outlines: the module owns the name
        }
        if !matches!(d.from.name.section, Section::Lines | Section::Fills) {
            return Err(GrammarError::Invalid(format!(
                "draw from {} needs $lines or $fills, not ${}",
                d.from.name, d.from.name.section
            )));
        }
        if g.find(&d.from.name).is_none() {
            return Err(GrammarError::Invalid(format!("draw from {}: no such def", d.from.name)));
        }
    }
    let groups: BTreeSet<String> = g.groups().into_iter().collect();
    if groups.len() != g.draw.len() {
        return Err(GrammarError::Invalid("two draw entries write the same SVG group id".into()));
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
            return Err(GrammarError::Invalid(format!(
                "masks.{name}.from is {}, but a mask must be an area",
                mask.from.name
            )));
        } else if g.find(&mask.from.name).is_none() {
            return Err(GrammarError::Invalid(format!("masks.{name}.from: no such def {}", mask.from.name)));
        }
        for id in &mask.occludes {
            if !groups.contains(&id.0) {
                return Err(GrammarError::Invalid(format!("masks.{name}.occludes names {:?}, which is not a draw id", id.0)));
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
        if marks.get(&def.reference()).is_none() {
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
    use crate::profile::Format;

    /// The example profile, trimmed to the parts the grammar must accept.
    const YAML: &str = r#"
card: { width: 6in, height: 4in, scale: "1:10000" }

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

    /// The tests below write only the part under test; the card is boilerplate.
    fn parse(text: &str) -> Result<Grammar, GrammarError> {
        let body = if text.contains("card:") {
            text.to_string()
        } else {
            format!("card: {{ width: 100mm, height: 50mm }}\n{text}")
        };
        Grammar::parse(&body, Format::Yaml)
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
        let two = "$areas:\n  a: { tools_polygons: $areas.b, engine_card: {} }\n  b: { engine_card: {} }\n";
        assert!(matches!(parse(two), Err(GrammarError::Yaml(m)) if m.contains("exactly one operation")));
    }

    #[test]
    fn expressions_and_modules_are_named_in_the_error() {
        // As a reference, the error names expressions explicitly.
        let expr_ref = "$areas:\n  a: { tools_grow: { of: ~dense, by: 1mm } }\n";
        assert!(matches!(parse(expr_ref), Err(GrammarError::Invalid(m)) if m.contains("v4")));
        // As a scalar value it is not a length, and must not silently parse.
        let expr = "$fills:\n  f: { tools_fill: { in: $areas.a, spacing: ~dense } }\n$areas:\n  a: { engine_card: {} }\n";
        assert!(parse(expr).is_err());
        // A module name is recognised: v3 records it even though its outputs
        // have no syntax yet.
        let module = "$lines:\n  roads: { module_roads: {} }\n";
        let g = parse(module).unwrap();
        assert_eq!(g.defs(Section::Lines)[0].op, Op::Module("roads".into()));
        let block = "$expressions:\n  dense: { when: { area_m2: { \"<\": 50 } }, then: 0.3mm, else: 0.5mm }\n";
        assert!(matches!(parse(block), Err(GrammarError::Invalid(m)) if m.contains("v4")));
        let bad_ref = "$areas:\n  a: { tools_union: [~dense] }\n";
        assert!(matches!(parse(bad_ref), Err(GrammarError::Invalid(m)) if m.contains("v4")));
    }

    #[test]
    fn duplicate_names_and_extra_keys_are_refused() {
        let dup = "$areas:\n  a: { engine_card: {} }\n  a: { engine_card: {} }\n";
        assert!(matches!(parse(dup), Err(GrammarError::Yaml(m)) if m.contains("duplicate mapping key")));
        let extra = "$areas:\n  a: { engine_card: {}, note: hi }\n";
        assert!(parse(extra).is_err());
    }

    #[test]
    fn the_proposal_file_parses() {
        // configs/proposal/postcard.yaml is the grammar's living example; it must
        // stay loadable, or the proposal and the parser have drifted apart.
        let text = include_str!("../../../configs/proposal/postcard.yaml");
        let g = Grammar::parse(text, Format::Yaml).unwrap();
        assert!(g.defs(Section::Areas).len() >= 10, "the example should define the real card");
        assert_eq!(g.compose.order.len(), g.draw.len());
    }
}
