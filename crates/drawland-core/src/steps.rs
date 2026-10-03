//! Layers written as a recipe instead of a module.
//!
//! A recipe is a list of steps run in order over a small working state: the
//! selected features, an area (polygons) and some lines. Steps either change
//! that state (`select`, `union`, `buffer`, `outline`, …) or put it into the
//! layer's parts (`emit`, `fill`). Distances are card millimetres.
//!
//! ```yaml
//! - id: rail
//!   steps:
//!     - select: { railway: [rail, light_rail] }
//!     - lines
//!     - stroke: { style: dash, dash: 1mm, gap: 0.5mm }
//!     - emit: outlines
//! ```

use crate::fill::{self, FillError, Sources};
use crate::geom::{self, Lines};
use crate::osm::Feature;
use crate::profile::{FillSpec, StrokeSpec};
use crate::themes::LayerParts;
use crate::units::parse_length_mm;
use geo::{MultiLineString, MultiPolygon, Polygon, Rect};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// Which features a `select` keeps: any listed key matching, none of the
/// `except` keys matching, and not underground unless asked.
#[derive(Debug, Clone, PartialEq)]
pub struct Selector {
    pub any: Vec<(String, TagMatch)>,
    pub except: Vec<(String, TagMatch)>,
    pub underground: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TagMatch {
    /// `key: true` — the tag is present (any value); `false` — absent.
    Present(bool),
    Values(Vec<String>),
}

impl TagMatch {
    fn matches(&self, value: Option<&str>) -> bool {
        match self {
            TagMatch::Present(p) => value.is_some() == *p,
            TagMatch::Values(vs) => value.is_some_and(|v| vs.iter().any(|w| w == v)),
        }
    }
}

impl Selector {
    pub fn keeps(&self, f: &Feature) -> bool {
        let hit = |rules: &[(String, TagMatch)]| rules.iter().any(|(k, m)| m.matches(f.tag(k)));
        hit(&self.any) && !hit(&self.except) && (self.underground || !crate::themes::is_underground(f))
    }

    /// Keys whose presence can select a feature (what Overpass must fetch).
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.any.iter().filter(|(_, m)| *m != TagMatch::Present(false)).map(|(k, _)| k.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegionKind {
    /// The whole card.
    Card,
    /// The card minus the areas of every layer drawn above this one.
    Leftover,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Outlines,
    Details,
    Mask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferOf {
    Area,
    Lines,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Buffer {
    pub distance: f64,
    pub of: BufferOf,
    /// Flat ends for buffered lines (round otherwise).
    pub flat: bool,
}

#[derive(Debug, Clone)]
pub enum Step {
    Select(Selector),
    Region(RegionKind),
    /// area ← union of the selection's polygons.
    Union,
    /// lines ← the selection's linear features.
    Lines,
    /// lines ← the area's rings (`exterior`: outer rings only).
    Outline { exterior: bool },
    Buffer(Buffer),
    FillHoles,
    Difference(String),
    Intersect(String),
    /// Draw the lines as the stroke says; unset fields come from the layer's `stroke`.
    Stroke(StrokeSpec),
    Emit(Vec<Slot>),
    /// Fill the area; unset fields come from the layer's `fill`.
    Fill(FillSpec),
    /// Fill each selected feature's polygons on their own.
    FillEach(FillSpec),
}

fn step_err(name: &str, msg: impl std::fmt::Display) -> String {
    format!("step {name:?}: {msg}")
}

fn length(v: &Value, name: &str) -> Result<f64, String> {
    match v {
        Value::Number(n) => n.as_f64().ok_or_else(|| step_err(name, "bad number")),
        Value::String(s) => parse_length_mm(s).map_err(|e| step_err(name, e)),
        _ => Err(step_err(name, "expected a length")),
    }
}

fn tag_rules(v: &Value, name: &str) -> Result<Vec<(String, TagMatch)>, String> {
    let Value::Object(map) = v else { return Err(step_err(name, "expected a mapping of tag keys")) };
    map.iter()
        .map(|(k, v)| {
            let scalar = |v: &Value| match v {
                Value::String(s) => Ok(s.clone()),
                Value::Number(n) => Ok(n.to_string()),
                // YAML reads a bare `yes` in a list as a boolean.
                Value::Bool(b) => Ok(if *b { "yes" } else { "no" }.to_string()),
                _ => Err(step_err(name, format!("{k}: values must be strings"))),
            };
            let m = match v {
                Value::Bool(b) => TagMatch::Present(*b),
                Value::Array(a) => TagMatch::Values(a.iter().map(scalar).collect::<Result<_, _>>()?),
                other => TagMatch::Values(vec![scalar(other)?]),
            };
            Ok((k.clone(), m))
        })
        .collect()
}

fn from_value<T: serde::de::DeserializeOwned>(v: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(v.clone()).map_err(|e| step_err(name, e))
}

impl TryFrom<Value> for Step {
    type Error = String;

    fn try_from(v: Value) -> Result<Step, String> {
        let (name, arg) = match &v {
            Value::String(s) => (s.clone(), Value::Null),
            Value::Object(m) if m.len() == 1 => {
                let (k, a) = m.iter().next().unwrap();
                (k.clone(), a.clone())
            }
            _ => return Err("a step is a name (`- union`) or a one-key mapping (`- buffer: 0.3mm`)".into()),
        };
        let none = |step: Step| if arg.is_null() { Ok(step) } else { Err(step_err(&name, "takes no argument")) };
        let n = name.as_str();
        match n {
            "select" => {
                let Value::Object(map) = &arg else { return Err(step_err(n, "expected a mapping of tag keys")) };
                let mut any = Value::Object(map.clone());
                let except = any.as_object_mut().unwrap().remove("except");
                let underground = any.as_object_mut().unwrap().remove("underground");
                Ok(Step::Select(Selector {
                    any: tag_rules(&any, n)?,
                    except: except.map(|e| tag_rules(&e, n)).transpose()?.unwrap_or_default(),
                    underground: match underground {
                        None => false,
                        Some(Value::Bool(b)) => b,
                        Some(_) => return Err(step_err(n, "underground: expected true or false")),
                    },
                }))
            }
            "region" => match arg.as_str() {
                Some("card") => Ok(Step::Region(RegionKind::Card)),
                Some("leftover") => Ok(Step::Region(RegionKind::Leftover)),
                _ => Err(step_err(n, "expected card or leftover")),
            },
            "union" => none(Step::Union),
            "lines" => none(Step::Lines),
            "fill_holes" => none(Step::FillHoles),
            "outline" => match &arg {
                Value::Null => Ok(Step::Outline { exterior: false }),
                Value::String(s) if s == "all" => Ok(Step::Outline { exterior: false }),
                Value::String(s) if s == "exterior" => Ok(Step::Outline { exterior: true }),
                _ => Err(step_err(n, "expected all or exterior")),
            },
            "buffer" => match &arg {
                Value::Object(m) => {
                    for key in m.keys() {
                        if !["distance", "of", "cap"].contains(&key.as_str()) {
                            return Err(step_err(n, format!("unknown field {key:?} (distance, of, cap)")));
                        }
                    }
                    let distance = length(m.get("distance").ok_or_else(|| step_err(n, "needs a distance"))?, n)?;
                    let of = match m.get("of").and_then(Value::as_str).unwrap_or("area") {
                        "area" => BufferOf::Area,
                        "lines" => BufferOf::Lines,
                        other => return Err(step_err(n, format!("of: {other:?}: use area or lines"))),
                    };
                    let flat = match m.get("cap").and_then(Value::as_str).unwrap_or("round") {
                        "round" => false,
                        "flat" => true,
                        other => return Err(step_err(n, format!("cap: {other:?}: use round or flat"))),
                    };
                    Ok(Step::Buffer(Buffer { distance, of, flat }))
                }
                other => Ok(Step::Buffer(Buffer { distance: length(other, n)?, of: BufferOf::Area, flat: false })),
            },
            "difference" | "intersect" => {
                let id = arg.as_str().ok_or_else(|| step_err(n, "expected a layer id"))?.to_string();
                Ok(if n == "difference" { Step::Difference(id) } else { Step::Intersect(id) })
            }
            "stroke" => Ok(Step::Stroke(if arg.is_null() { StrokeSpec::default() } else { from_value(&arg, n)? })),
            "emit" => {
                let slot = |v: &Value| match v.as_str() {
                    Some("outlines") => Ok(Slot::Outlines),
                    Some("details") => Ok(Slot::Details),
                    Some("mask") => Ok(Slot::Mask),
                    _ => Err(step_err(n, "slots are outlines, details, mask (fills go through `fill`)")),
                };
                let slots = match &arg {
                    Value::Array(a) => a.iter().map(slot).collect::<Result<_, _>>()?,
                    other => vec![slot(other)?],
                };
                Ok(Step::Emit(slots))
            }
            "fill" | "fill_each" => {
                let spec: FillSpec = if arg.is_null() { FillSpec::default() } else { from_value(&arg, n)? };
                Ok(if n == "fill" { Step::Fill(spec) } else { Step::FillEach(spec) })
            }
            other => Err(format!(
                "unknown step {other:?} (select, region, union, lines, outline, buffer, fill_holes, \
                 difference, intersect, stroke, emit, fill, fill_each)"
            )),
        }
    }
}

impl<'de> Deserialize<'de> for Step {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Step, D::Error> {
        Step::try_from(Value::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

/// What a recipe needs from other layers before it can run.
pub fn dependencies(steps: &[Step]) -> (Vec<String>, bool) {
    let mut ids = Vec::new();
    let mut leftover = false;
    for s in steps {
        match s {
            Step::Difference(id) | Step::Intersect(id) if !ids.contains(id) => ids.push(id.clone()),
            Step::Region(RegionKind::Leftover) => leftover = true,
            _ => {}
        }
    }
    (ids, leftover)
}

/// Every fill a recipe runs, merged over the layer's `fill`.
pub fn fill_specs(steps: &[Step], layer_fill: Option<&FillSpec>) -> Vec<FillSpec> {
    steps
        .iter()
        .filter_map(|s| match s {
            Step::Fill(spec) | Step::FillEach(spec) => Some(merge_fill(layer_fill, spec)),
            _ => None,
        })
        .collect()
}

fn merge_fill(layer_fill: Option<&FillSpec>, spec: &FillSpec) -> FillSpec {
    layer_fill.map_or_else(|| spec.clone(), |base| base.merged(spec))
}

/// What the recipe runs against: projected features, the card, the masks of
/// the layers it depends on.
pub struct Env<'a> {
    pub features: &'a [Feature],
    pub card_mm: (f64, f64),
    pub masks: &'a BTreeMap<String, MultiPolygon<f64>>,
    /// Ids of the layers drawn above this one, for `region: leftover`.
    pub above: &'a [String],
    pub sources: &'a Sources,
    pub layer_fill: Option<&'a FillSpec>,
    pub layer_stroke: Option<&'a StrokeSpec>,
}

pub fn run(steps: &[Step], env: &Env) -> Result<LayerParts, FillError> {
    let mut selection: Vec<&Feature> = Vec::new();
    let mut area: MultiPolygon<f64> = geom::empty();
    let mut lines: Lines = Vec::new();
    let mut parts = LayerParts::default();
    let empty = geom::empty();
    let mask_of = |id: &str| env.masks.get(id).unwrap_or(&empty);

    for step in steps {
        match step {
            Step::Select(sel) => selection = env.features.iter().filter(|f| sel.keeps(f)).collect(),
            Step::Region(kind) => {
                let (w, h) = env.card_mm;
                let card = MultiPolygon::new(vec![Rect::new((0.0, 0.0), (w, h)).to_polygon()]);
                area = match kind {
                    RegionKind::Card => card,
                    RegionKind::Leftover => {
                        let above: Vec<&MultiPolygon<f64>> = env.above.iter().map(|id| mask_of(id)).collect();
                        geom::difference(&card, &geom::union_multi(above))
                    }
                };
            }
            Step::Union => {
                let polys: Vec<Polygon<f64>> = selection.iter().flat_map(|f| geom::polygons(&f.geometry)).collect();
                area = geom::union_all(&polys);
            }
            Step::Lines => {
                lines = selection
                    .iter()
                    .filter(|f| geom::polygons(&f.geometry).is_empty())
                    .flat_map(|f| geom::lines_of(&f.geometry))
                    .collect();
            }
            Step::Outline { exterior } => {
                lines = if *exterior { geom::exterior_rings(&area) } else { geom::rings(&area) };
            }
            Step::Buffer(b) => match b.of {
                BufferOf::Area => area = geom::buffer(&area, b.distance),
                BufferOf::Lines if b.flat => {
                    let pieces: Vec<MultiPolygon<f64>> =
                        geom::linemerge(&lines).iter().map(|l| geom::buffer_line_flat(l, b.distance)).collect();
                    area = geom::union_multi(&pieces);
                }
                BufferOf::Lines => {
                    use geo::algorithm::buffer::Buffer as _;
                    area = if lines.is_empty() { geom::empty() } else { MultiLineString::new(lines.clone()).buffer(b.distance) };
                }
            },
            Step::FillHoles => area = geom::fill_holes(&area),
            Step::Difference(id) => area = geom::difference(&area, mask_of(id)),
            Step::Intersect(id) => area = geom::intersection(&area, mask_of(id)),
            Step::Stroke(spec) => {
                let spec = env.layer_stroke.map_or_else(|| spec.clone(), |base| base.merged(spec));
                lines = fill::stroke(std::mem::take(&mut lines), &spec);
            }
            Step::Emit(slots) => {
                for slot in slots {
                    match slot {
                        Slot::Outlines => parts.outlines.extend(lines.iter().cloned()),
                        Slot::Details => parts.details.extend(lines.iter().cloned()),
                        Slot::Mask => parts.mask = geom::union_multi([&parts.mask, &area]),
                    }
                }
            }
            Step::Fill(spec) => {
                parts.filling.extend(fill::fill(&area, &merge_fill(env.layer_fill, spec), env.sources)?);
            }
            Step::FillEach(spec) => {
                use rayon::prelude::*;
                let spec = merge_fill(env.layer_fill, spec);
                let each: Vec<MultiPolygon<f64>> = selection
                    .iter()
                    .map(|f| MultiPolygon::new(geom::polygons(&f.geometry)))
                    .filter(|m| !m.0.is_empty())
                    .collect();
                let filled: Result<Vec<Lines>, FillError> =
                    each.par_iter().map(|m| fill::fill(m, &spec, env.sources)).collect();
                parts.filling.extend(filled?.into_iter().flatten());
            }
        }
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(yaml: &str) -> Vec<Step> {
        serde_saphyr::from_str(yaml).unwrap()
    }

    #[test]
    fn steps_parse_bare_and_with_arguments() {
        let steps = parse(
            "- select: { building: true, except: { building: [roof] } }\n\
             - union\n\
             - buffer: 0.3mm\n\
             - buffer: { distance: 0.5, of: lines, cap: flat }\n\
             - outline: exterior\n\
             - emit: [outlines, mask]\n\
             - fill: { generator: zigzag, spacing: 0.75mm }\n",
        );
        assert_eq!(steps.len(), 7);
        let Step::Select(sel) = &steps[0] else { panic!() };
        assert_eq!(sel.any, vec![("building".into(), TagMatch::Present(true))]);
        assert_eq!(sel.except, vec![("building".into(), TagMatch::Values(vec!["roof".into()]))]);
        assert!(matches!(steps[2], Step::Buffer(Buffer { distance, of: BufferOf::Area, flat: false }) if distance == 0.3));
        assert!(matches!(steps[3], Step::Buffer(Buffer { of: BufferOf::Lines, flat: true, .. })));
        assert!(matches!(steps[4], Step::Outline { exterior: true }));
        assert!(matches!(&steps[5], Step::Emit(s) if s == &vec![Slot::Outlines, Slot::Mask]));
    }

    #[test]
    fn dependencies_are_the_referenced_layers_once() {
        let steps = parse("- region: leftover\n- difference: roads\n- intersect: parks\n- difference: roads\n");
        assert_eq!(dependencies(&steps), (vec!["roads".to_string(), "parks".to_string()], true));
        assert_eq!(dependencies(&parse("- region: card\n- union\n")), (vec![], false));
    }

    #[test]
    fn leftover_is_the_card_minus_the_masks_above() {
        use geo::Area;
        let square = |x: f64, y: f64, s: f64| MultiPolygon::new(vec![Rect::new((x, y), (x + s, y + s)).to_polygon()]);
        let masks = BTreeMap::from([("a".to_string(), square(0.0, 0.0, 10.0)), ("b".to_string(), square(50.0, 20.0, 20.0))]);
        let sources = Sources::new();
        let mask_area = |steps: &str, above: &[String]| {
            let env = Env {
                features: &[],
                card_mm: (100.0, 50.0),
                masks: &masks,
                above,
                sources: &sources,
                layer_fill: None,
                layer_stroke: None,
            };
            run(&parse(steps), &env).unwrap().mask.unsigned_area()
        };

        let leftover = "- region: leftover\n- emit: mask\n";
        assert!((mask_area(leftover, &["a".into(), "b".into()]) - 4500.0).abs() < 1e-6);
        assert!((mask_area(leftover, &["b".into(), "missing".into()]) - 4600.0).abs() < 1e-6);
        assert!((mask_area(leftover, &[]) - 5000.0).abs() < 1e-6);
        assert!((mask_area("- region: card\n- intersect: b\n- difference: a\n- emit: mask\n", &[]) - 400.0).abs() < 1e-6);
    }

    #[test]
    fn unknown_steps_and_fields_are_errors() {
        assert!(serde_saphyr::from_str::<Vec<Step>>("- unoin\n").is_err());
        assert!(serde_saphyr::from_str::<Vec<Step>>("- buffer: { distanse: 1 }\n").is_err());
        assert!(serde_saphyr::from_str::<Vec<Step>>("- union: 3\n").is_err());
        assert!(serde_saphyr::from_str::<Vec<Step>>("- emit: filling\n").is_err());
    }
}
