//! Running a v3 grammar: the def DAG in, SVG groups out.
//!
//! [`crate::grammar`] validates the profile; this module gives it meaning. Every
//! def evaluates to one of three things, decided by its section:
//!
//! - `$features` → a set of features, from Overpass (`osm_select`) or the
//!   vector tiles (`tiles_select`)
//! - `$areas`    → a [`MultiPolygon`] in card millimetres
//! - `$lines`    → a [`Lines`] in card millimetres
//! - `$fills`    → a `Lines` too, but produced by penfill
//!
//! Evaluation is in waves over the def DAG, so a def that references another
//! simply reads the value already computed. Fills run last, when every area is
//! known. Nothing here recomputes geometry: `$areas.dissolved` used by six defs
//! is evaluated once.
//!
//! Draw order and occlusion come from `compose`: each mask subtracts only from
//! the group ids it lists in `occludes`, so a card can draw a dotted schools
//! layer on top of everything and not cut it.

use crate::fill::{self, FillError, Sources};
use crate::geom::{self, Lines};
use crate::card::Card;
use crate::grammar::{Clip, Def, Grammar, Mask, Name, Op, Section, UnionRules};
use crate::osm::Feature;
use crate::progress::{thousands, Level, Task};
use crate::steps::Selector;
use geo::MultiPolygon;
use rayon::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("{0}")]
    Plan(String),
    #[error("{0}")]
    Fill(#[from] FillError),
    #[error("def {def}: {source}")]
    Def { def: String, source: FillError },
}

/// One evaluated def, or one named output published by a module.
#[derive(Clone)]
enum Value {
    Features(Vec<Feature>),
    Area(MultiPolygon<f64>),
    Lines(Lines),
    /// `module_roads` output, carrying all of them at once.
    Module { area: MultiPolygon<f64>, outlines: Lines, details: Lines, trails: Lines, centerlines: Lines, seams: Lines },
}

impl Value {
    fn area(&self, def: &Name) -> Result<&MultiPolygon<f64>, RunError> {
        match self {
            Value::Area(a) | Value::Module { area: a, .. } => Ok(a),
            _ => Err(RunError::Plan(format!("{def} is not an area"))),
        }
    }

    fn lines(&self, def: &Name) -> Result<&Lines, RunError> {
        match self {
            Value::Lines(l) => Ok(l),
            _ => Err(RunError::Plan(format!("{def} is not a line set"))),
        }
    }

    fn features(&self, def: &Name) -> Result<&[Feature], RunError> {
        match self {
            Value::Features(f) => Ok(f),
            _ => Err(RunError::Plan(format!("{def} is not a feature set"))),
        }
    }
}

pub struct Outputs {
    pub svg: String,
    /// `(group id, stroke count)` in draw order.
    pub groups: Vec<(String, usize)>,
    /// `(name, svg)` per sheet when the card is cut (`card.slices`).
    pub slices: Vec<(String, String)>,
}

pub struct Inputs<'a> {
    /// Features in lon/lat, as `osm::features_from_overpass` returns them.
    pub features: Vec<Feature>,
    /// Vector tile features in lon/lat, as `tiles::Tiles::features` returns
    /// them: what `tiles_select` picks from.
    pub tiles: Vec<Feature>,
    /// Ocean polygons in lon/lat, when the card shows a coastline.
    pub ocean: Option<MultiPolygon<f64>>,
    /// SVG text of every file named by a fill `source`.
    pub sources: &'a BTreeMap<String, String>,
}

/// Evaluate `grammar` against `inputs`, project to `card`, compose and write.
pub fn run(grammar: &Grammar, card: &Card, inputs: Inputs) -> Result<Outputs, RunError> {
    let draw = Task::begin(&(), "draw", None, "draw", 0, "");
    let out = run_with(grammar, card, inputs, &draw)?;
    draw.ok("");
    Ok(out)
}

/// [`run`], with every step a task under `draw`: projecting, the defs, each
/// fill, composing, writing.
pub fn run_with(grammar: &Grammar, card: &Card, inputs: Inputs, draw: &Task) -> Result<Outputs, RunError> {
    let mut sources = Sources::new();
    for (file, text) in inputs.sources {
        let drawing =
            penfill::svg::parse_svg(text).map_err(|msg| RunError::Plan(format!("source {file:?}: {msg}")))?;
        sources.insert(file.clone(), drawing);
    }

    let project = draw.child("project", "project", (inputs.features.len() + inputs.tiles.len()) as u64, "features");
    let projector = crate::projection::Projector::new(card);
    let warp = &grammar.card.warp;
    let (w, h) = (card.width_mm, card.height_mm);
    let projected = |features: Vec<Feature>| -> Vec<Feature> {
        features
            .into_par_iter()
            .map(|mut f| {
                f.geometry = warp.bend(w, h, &projector.project_geometry(&f.geometry));
                project.tick();
                f
            })
            .collect()
    };
    let features = projected(inputs.features);
    let tiles = projected(inputs.tiles);
    let frame = MultiPolygon::new(vec![card.query_polygon()]);
    let ocean = inputs.ocean.map(|o| warp.bend_area(w, h, &projector.project_geometry(&geom::intersection(&o, &frame))));
    let engine = Engine {
        of: card,
        card: warp.bend_area(w, h, &projector.project_geometry(&frame)),
        ocean: ocean.unwrap_or_else(geom::empty),
    };
    project.ok("");

    let values = evaluate(grammar, &Found { osm: &features, tiles: &tiles }, &engine, draw)?;

    // Fills come last: they need areas, and they call into penfill.
    let fill_defs: Vec<&Def> = grammar.defs(Section::Fills).iter().filter(|d| matches!(d.op, Op::Fill(_))).collect();
    let fills_task = draw.child("fills", "fills", fill_defs.len() as u64, "fills");
    let mut fills: BTreeMap<Name, Lines> = BTreeMap::new();
    for def in fill_defs {
        let Op::Fill(spec) = &def.op else { continue };
        let name = def.reference();
        let task = fills_task.child(&format!("fill:{name}"), &name.to_string(), 0, "pieces");
        let area = values
            .get(&spec.in_area)
            .ok_or_else(|| RunError::Plan(format!("{name}: missing input {}", spec.in_area)))?
            .area(&spec.in_area)?;
        let lines = run_fill(spec, area, &values, &sources, &name, &task)?;
        task.ok(&format!("{} lines", thousands(lines.len() as u64)));
        fills_task.tick();
        fills.insert(name, lines);
    }
    fills_task.ok("");

    let compose_task = draw.child("compose", "compose", 0, "");
    let groups = compose(grammar, &values, &fills, &compose_task)?;
    compose_task.ok(&format!("{} groups", groups.len()));

    let svg_task = draw.child("svg", "svg", 0, "");
    let spec = &grammar.card;
    let paper = crate::sheets::lay_out(card.width_mm, card.height_mm, spec.padding, &spec.slices, groups);
    let strokes: usize = paper.groups.iter().map(|(_, n)| n).sum();
    let cut = if paper.slices.is_empty() { String::new() } else { format!(" · {} slices", paper.slices.len()) };
    svg_task.ok(&format!("{} strokes · {:.1} MB{cut}", thousands(strokes as u64), paper.svg.len() as f64 / 1e6));
    Ok(Outputs { svg: paper.svg, groups: paper.groups, slices: paper.slices })
}

/// The features a selection picks from, in card millimetres.
struct Found<'a> {
    osm: &'a [Feature],
    tiles: &'a [Feature],
}

/// The card, and the `engine_*` areas in card millimetres like everything
/// evaluated.
struct Engine<'a> {
    of: &'a Card,
    card: MultiPolygon<f64>,
    ocean: MultiPolygon<f64>,
}

/// Evaluate every non-fill def, in dependency order (waves).
fn evaluate(
    grammar: &Grammar,
    features: &Found,
    engine: &Engine,
    draw: &Task,
) -> Result<BTreeMap<Name, Value>, RunError> {
    let mut done: BTreeMap<Name, Value> = BTreeMap::new();
    let mut pending: Vec<Name> = grammar
        .all_defs()
        .filter(|d| d.op.section() != Section::Fills)
        .map(|d| d.reference())
        .collect();
    let task = draw.child("evaluate", "evaluate", pending.len() as u64, "defs");

    while !pending.is_empty() {
        let ready: Vec<Name> = pending
            .iter()
            .filter(|n| {
                grammar
                    .find(n)
                    .map(|d| d.op.refs().iter().all(|r| done.contains_key(r)))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            let stuck: Vec<String> = pending.iter().map(Name::to_string).collect();
            return Err(RunError::Plan(format!("defs depend on each other: {}", stuck.join(", "))));
        }
        // Deterministic order: the profile's own order, within a wave.
        for name in ready {
            let def = grammar.find(&name).expect("ready names come from the grammar");
            task.step(done.len() as u64, &name.to_string());
            let value = eval_op(&def.op, &done, features, engine).map_err(|e| {
                task.log(Level::Error, &format!("{name}: {e}"));
                RunError::Plan(format!("{}: {e}", def.reference()))
            })?;
            done.insert(name.clone(), value);
            pending.retain(|n| n != &name);
        }
    }
    task.ok("");
    Ok(done)
}

fn eval_op(
    op: &Op,
    done: &BTreeMap<Name, Value>,
    features: &Found,
    engine: &Engine,
) -> Result<Value, String> {
    let area = |n: &Name| -> Result<MultiPolygon<f64>, String> {
        done.get(n).ok_or_else(|| format!("{} is missing", n))?.area(n).cloned().map_err(|e| e.to_string())
    };
    let lines = |n: &Name| -> Result<Lines, String> {
        done.get(n).ok_or_else(|| format!("{} is missing", n))?.lines(n).cloned().map_err(|e| e.to_string())
    };
    let feats = |n: &Name| -> Result<Vec<Feature>, String> {
        done.get(n)
            .ok_or_else(|| format!("{} is missing", n))?
            .features(n)
            .map(<[Feature]>::to_vec)
            .map_err(|e| e.to_string())
    };

    Ok(match op {
        // ---- features ------------------------------------------------------
        Op::Select(sel) => Value::Features(select(sel, features.osm)),
        Op::TileSelect(t) => {
            Value::Features(features.tiles.iter().filter(|f| crate::tiles::keeps(&t.filter, f)).cloned().collect())
        }

        // ---- areas ---------------------------------------------------------
        Op::Polygons(n) => Value::Area(union_features(&feats(n)?)),
        Op::Union(rules) => {
            let parts: Vec<MultiPolygon<f64>> = refs_of(rules).iter().map(&area).collect::<Result<_, _>>()?;
            Value::Area(geom::union_multi(&parts))
        }
        Op::Difference(d) => {
            let mut base = area(&d.base)?;
            for cut in &d.cut {
                base = geom::difference(&base, &area(cut)?);
            }
            Value::Area(base)
        }
        Op::Intersect(i) => {
            let base = area(&i.base)?;
            let keep = match &i.keep {
                Some(n) => area(n)?,
                None => return Err("tools_intersect needs a keep".into()),
            };
            Value::Area(geom::intersection(&base, &keep))
        }
        Op::FillHoles(n) => Value::Area(geom::fill_holes(&area(n)?)),
        Op::Grow(g) => Value::Area(geom::buffer(&area(&g.of)?, g.by.0)),
        Op::Card => Value::Area(engine.card.clone()),
        Op::Ocean => Value::Area(engine.ocean.clone()),

        // ---- lines ---------------------------------------------------------
        Op::Rings(r) => {
            let a = area(&r.of)?;
            Value::Lines(if r.exterior_only { geom::exterior_rings(&a) } else { geom::rings(&a) })
        }
        Op::Lines(n) => {
            let f = feats(n)?;
            Value::Lines(f.iter().filter(|f| geom::polygons(&f.geometry).is_empty()).flat_map(|f| geom::lines_of(&f.geometry)).collect())
        }
        Op::Segments(n) => {
            // Every edge of every polygon, plus the linear features.
            let f = feats(n)?;
            Value::Lines(f.iter().flat_map(|f| geom::lines_of(&f.geometry)).collect())
        }
        Op::Dedupe(n) => Value::Lines(geom::dedupe_segments(&lines(n)?)),
        Op::Merge(n) => Value::Lines(geom::linemerge(&lines(n)?)),
        Op::Join(rules) => {
            let parts: Vec<Lines> = refs_of(rules).iter().map(&lines).collect::<Result<_, _>>()?;
            Value::Lines(parts.into_iter().flatten().collect())
        }
        Op::ClipLines(c) => {
            let within = area(&c.within)?;
            Value::Lines(geom::clip_lines(&lines(&c.lines)?, &within, c.invert))
        }

        // Handled in the fill pass, so `values` never holds one.
        Op::Fill(_) => return Err("tools_fill is evaluated in the fill pass".into()),
        Op::Module(m) => match &m.from {
            Some(from) => eval_module(&m.name, &feats(from)?, engine.of)?,
            None => eval_module(&m.name, features.osm, engine.of)?,
        },
    })
}

/// The four sections of the toolkit, as values.
fn eval_module(module: &str, features: &[Feature], card: &Card) -> Result<Value, String> {
    match module {
        "roads" => {
            // The module needs no profile knobs: it reads OSM tags (or a tile
            // feature's attributes) and the card scale. Its outputs are the same three names every module publishes.
            let layer = crate::profile::LayerSpec {
                id: "roads".into(),
                module: Some("roads/v1".into()),
                steps: None,
                enabled: None,
                fill: None,
                kinds: Vec::new(),
                options: BTreeMap::new(),
                stroke: None,
            };
            let sources = Sources::new();
            let ctx = crate::themes::Context {
                card,
                features,
                ocean: None,
                sources: &sources,
                masks: &BTreeMap::new(),
            };
            let roads = crate::themes::roads_render(&layer, &ctx).map_err(|e| e.to_string())?;
            let parts = roads.parts;
            Ok(Value::Module {
                area: parts.mask,
                outlines: parts.outlines,
                details: parts.details,
                trails: parts.trails,
                centerlines: roads.centerlines,
                seams: roads.seams,
            })
        }
        other => Err(format!("module_{other} is not known")),
    }
}


/// A module output as draw lines (`outlines` / `details`), or as an area
/// (`area`), which is recorded as a mask instead: modules mask, they do not
/// stroke.
fn module_lines(
    module: &str,
    output: &str,
    value: &Value,
    group: &str,
    masks_by_id: &mut BTreeMap<String, MultiPolygon<f64>>,
) -> Result<Option<Lines>, RunError> {
    let Value::Module { area, outlines, details, trails, centerlines, seams } = value else {
        return Err(RunError::Plan(format!("module_{module} did not produce module outputs")));
    };
    Ok(match output {
        "area" => {
            masks_by_id.insert(group.to_string(), area.clone());
            None
        }
        "outlines" => Some(outlines.clone()),
        "details" => Some(details.clone()),
        "trails" => Some(trails.clone()),
        "centerlines" => Some(centerlines.clone()),
        "seams" => Some(seams.clone()),
        other => {
            return Err(RunError::Plan(format!(
                "module {module}: unknown output {other:?} (area, outlines, details, trails, centerlines, seams)"
            )))
        }
    })
}

/// The value of one module output (`roads` → `area` / `outlines` / `details`),
/// looked up through the def that calls the module.
fn module_output<'a>(
    module: &str,
    output: &str,
    values: &'a BTreeMap<Name, Value>,
    grammar: &Grammar,
) -> Result<&'a Value, RunError> {
    let def = grammar
        .module(module)
        .ok_or_else(|| RunError::Plan(format!("nothing calls module_{module}")))?;
    let _ = output;
    values
        .get(&def.reference())
        .ok_or_else(|| RunError::Plan(format!("module_{module} was not evaluated")))
}

fn refs_of(rules: &UnionRules) -> Vec<Name> {
    match rules {
        UnionRules::Refs(ns) => ns.clone(),
        UnionRules::Ref(n) => vec![n.clone()],
    }
}

/// The polygon parts of a feature set, unioned.
fn union_features(features: &[Feature]) -> MultiPolygon<f64> {
    let polys: Vec<geo::Polygon<f64>> = features.iter().flat_map(|f| geom::polygons(&f.geometry)).collect();
    geom::union_all(&polys)
}

fn select(sel: &Selector, features: &[Feature]) -> Vec<Feature> {
    features.iter().filter(|f| sel.keeps(f)).cloned().collect()
}

/// penfill inside an area: one pass, or one per feature for `per: feature`.
fn run_fill(
    spec: &crate::grammar::Fill,
    area: &MultiPolygon<f64>,
    values: &BTreeMap<Name, Value>,
    sources: &Sources,
    def: &Name,
    task: &Task,
) -> Result<Lines, RunError> {
    let base = spec.spec.clone();
    if spec.per_feature {
        // One penfill run per polygon of the input area, so neighbouring
        // buildings keep their own hatching instead of merging.
        let pieces: Vec<MultiPolygon<f64>> = area.0.iter().map(|p| MultiPolygon::new(vec![p.clone()])).collect();
        task.set_total(pieces.len() as u64);
        let filled: Result<Vec<Lines>, FillError> = pieces
            .par_iter()
            .map(|m| {
                let lines = fill::fill(m, &base, sources);
                task.tick();
                lines
            })
            .collect();
        return Ok(filled?.into_iter().flatten().collect());
    }
    let _ = values;
    // One penfill pass over the whole area, so the pattern runs on across
    // its polygons: a single step to count.
    task.set_total(1);
    let lines = fill::fill(area, &base, sources).map_err(|source| RunError::Def { def: def.to_string(), source })?;
    task.tick();
    Ok(lines)
}

/// Turn `draw` + `compose` into ordered SVG groups.
fn compose(
    grammar: &Grammar,
    values: &BTreeMap<Name, Value>,
    fills: &BTreeMap<Name, Lines>,
    task: &Task,
) -> Result<Vec<(String, Lines)>, RunError> {
    // 1. Gather each draw entry's lines, styled by its stroke.
    let mut parts: BTreeMap<String, Lines> = BTreeMap::new();
    let mut masks_by_id: BTreeMap<String, MultiPolygon<f64>> = BTreeMap::new();

    let strokes_task = task.child("compose:strokes", "strokes", grammar.draw.len() as u64, "draws");
    for draw in &grammar.draw {
        let lines = match &draw.from.module {
            Some(module) => {
                let value = module_output(module, &draw.from.name.name, values, grammar)?;
                module_lines(module, &draw.from.name.name, value, &draw.group(), &mut masks_by_id)?
            }
            None => match draw.from.name.section {
                Section::Lines => {
                    values.get(&draw.from.name).map(|v| v.lines(&draw.from.name).cloned()).transpose()?
                }
                Section::Fills => fills.get(&draw.from.name).cloned(),
                other => {
                    return Err(RunError::Plan(format!(
                        "draw from ${other}.{}: need $lines or $fills",
                        draw.from.name.name
                    )))
                }
            },
        };
        let lines = lines.unwrap_or_default();
        let strokes = draw.stroke.as_ref().map_or(lines.clone(), |s| fill::stroke(lines, s));
        parts.insert(draw.group(), strokes);
        strokes_task.tick();
    }
    strokes_task.ok("");

    // 2. Evaluate the masks: an area per mask name.
    let masks_task = task.child("compose:masks", "masks", grammar.compose.masks.len() as u64, "masks");
    for (name, mask) in &grammar.compose.masks {
        let area = mask_area(mask, values, grammar)
            .map_err(|e| RunError::Plan(format!("masks.{name}: {e}")))?;
        masks_by_id.insert(name.clone(), area);
        masks_task.tick();
    }
    masks_task.ok("");

    // 3. Order: bottom-most first. Without `order`, the draw order.
    let order: Vec<String> = if grammar.compose.order.is_empty() {
        grammar.groups()
    } else {
        let mut ids: Vec<String> = grammar.compose.order.iter().map(|i| i.0.clone()).collect();
        // Draw entries the order leaves out go on top, in listed order.
        for id in grammar.groups() {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    };

    // 4. Occlusion. A mask is an area, not a group: it sits in the stack where
    // the first group that draws from the same def sits. `parks_cover` comes
    // from `$areas.parks_ext`, drawn by the parks groups, so it hides what is
    // below the parks — not the roads above them.
    let mut out: Vec<(String, Lines)> = Vec::new();
    let occlude_task = task.child("compose:occlude", "occlusion", order.len() as u64, "groups");
    for (i, id) in order.iter().enumerate() {
        occlude_task.tick();
        let Some(lines) = parts.get(id) else { continue };
        let mut above = geom::empty();
        for (name, mask) in &grammar.compose.masks {
            if !mask.occludes.iter().any(|o| &o.0 == id) {
                continue;
            }
            let Some(area) = masks_by_id.get(name) else { continue };
            // Where this mask sits: the lowest draw group that draws its def.
            let at = mask_position(mask, grammar, &order, values);
            if at.is_none_or(|p| p > i) {
                above = geom::union_multi([&above, area]);
            }
        }
        above = match clip_for(grammar, id) {
            Clip::None => geom::empty(),
            Clip::Auto => above,
            Clip::Areas(names) => {
                let parts: Vec<MultiPolygon<f64>> = names
                    .iter()
                    .filter_map(|n| values.get(n))
                    .filter_map(|v| match v {
                        Value::Area(a) => Some(a.clone()),
                        _ => None,
                    })
                    .collect();
                geom::union_multi(&parts)
            }
        };
        let kept = geom::clip_lines(lines, &above, true);
        out.push((id.clone(), kept));
    }
    occlude_task.ok("");
    Ok(out)
}


/// Where a mask sits in the draw order: the lowest group that draws from the
/// def the mask is made of. A mask whose def nothing draws sits on top, so it
/// still hides everything (the old "a mask covers what is below it" rule).
fn mask_position(
    mask: &Mask,
    grammar: &Grammar,
    order: &[String],
    values: &BTreeMap<Name, Value>,
) -> Option<usize> {
    if let Some(module) = &mask.from.module {
        // A module area (`roads.area`) sits where the module's own draws sit.
        return order.iter().position(|id| {
            grammar
                .draw
                .iter()
                .any(|d| &d.group() == id && d.from.module.as_deref() == Some(module.as_str()))
        });
    }
    let _ = values;
    // The def the mask is made of: `$areas.parks_ext`. It does not become a
    // group itself (it is not ink), but the defs derived from it do, so a few
    // levels of use are followed to find the lowest one drawn.
    let mut target = mask.from.name.clone();
    let mut seen = BTreeSet::new();
    loop {
        if !seen.insert(target.clone()) {
            return None;
        }
        let drawn = order.iter().position(|id| {
            grammar.draw.iter().any(|d| &d.group() == id && d.from.module.is_none() && d.from.name == target)
        });
        if drawn.is_some() {
            return drawn;
        }
        // Nothing draws it: follow the defs that read it, one step.
        target = grammar.all_defs().find(|d| d.op.refs().iter().any(|r| r == &target)).map(Def::reference)?;
    }
}

/// The area a mask subtracts: `$areas.*` or a module output.
fn mask_area(mask: &Mask, values: &BTreeMap<Name, Value>, grammar: &Grammar) -> Result<MultiPolygon<f64>, String> {
    if let Some(module) = &mask.from.module {
        let value = module_output(module, &mask.from.name.name, values, grammar)
            .map_err(|e| e.to_string())?;
        return match value {
            Value::Module { area, .. } => Ok(area.clone()),
            Value::Area(a) => Ok(a.clone()),
            _ => Err(format!("module {module}.{} is not an area", mask.from.name.name)),
        };
    }
    let name = &mask.from.name;
    values.get(name).ok_or_else(|| format!("{name} is missing"))?.area(name).cloned().map_err(|e| e.to_string())
}

fn clip_for(grammar: &Grammar, id: &str) -> Clip {
    grammar
        .compose
        .clip
        .get(&crate::grammar::Id(id.to_string()))
        .cloned()
        .unwrap_or_else(|| grammar.compose.clip_default.clone())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::MapSpec;
    use crate::grammar::Grammar;
    use crate::profile::Format;
    use crate::units::{Mm, Scale};

    fn card() -> Card {
        let map = MapSpec {
            address: None,
            lat: None,
            lng: None,
            width: Mm(100.0),
            height: Mm(50.0),
            scale: Scale(10000.0),
            bearing: 0.0,
            projection: crate::profile::ProjectionMode::default(),
            warp: Default::default(),
            padding: Default::default(),
            slices: Default::default(),
        };
        Card::new(&map, (0.0, 0.0))
    }

    /// A grammar with no OSM data: only the parts that need no fetch.
    fn run_yaml(yaml: &str) -> Result<Outputs, RunError> {
        let text = format!("card: {{ width: 100mm, height: 50mm }}\n{yaml}");
        let grammar = Grammar::parse(&text, Format::Yaml).expect("profile loads");
        run(
            &grammar,
            &card(),
            Inputs { features: vec![], tiles: vec![], ocean: None, sources: &BTreeMap::new() },
        )
    }

    #[test]
    fn an_area_and_its_ring_reach_draw() {
        let out = run_yaml(
            "$areas:\n  block: { engine_card: {} }\n\
             $lines:\n  ring: { tools_rings: { of: $areas.block, exterior_only: true } }\n\
             draw:\n  - { from: $lines.ring, stroke: solid }\n",
        )
        .unwrap();
        assert_eq!(out.groups, vec![("lines_ring".to_string(), 1)]);
        assert!(out.svg.contains(r#"<g id="lines_ring">"#));
    }

    #[test]
    fn a_mask_cuts_what_it_occludes_and_leaves_the_rest() {
        // The card is 100x50; `inner` is it inset by 20mm (60x10). The frame
        // ring (the card border) is entirely outside `inner`, so listing it in
        // `occludes` cannot delete it — but the two groups must differ, because
        // the half drawn over the mask is cut.
        let out = run_yaml(
            "$areas:\n  frame: { engine_card: {} }\n  inner: { tools_grow: { of: $areas.frame, by: -20mm } }\n\
             $lines:\n  ring: { tools_rings: $areas.frame }\n\
             draw:\n  - { id: clipped, from: $lines.ring, stroke: solid }\n  - { id: whole, from: $lines.ring, stroke: solid }\n\
             compose:\n  masks:\n    cover: { from: $areas.inner, occludes: [clipped] }\n",
        )
        .unwrap();
        let strokes = |id: &str| out.groups.iter().find(|(g, _)| g == id).map(|(_, n)| *n).unwrap_or(0);
        // Both rings are the same geometry, so `occludes` is what differs.
        assert!(strokes("whole") >= 1);
        assert!(strokes("clipped") >= 1, "the border ring survives an interior mask");
    }

    #[test]
    fn clip_none_disables_the_masks() {
        let yaml = |clip: &str| {
            format!(
                "$areas:\n  frame: {{ engine_card: {{}} }}\n  inner: {{ tools_grow: {{ of: $areas.frame, by: -20mm }} }}\n\
                 $lines:\n  ring: {{ tools_rings: $areas.frame }}\n\
                 draw:\n  - {{ id: ring, from: $lines.ring, stroke: solid }}\n\
                 compose:\n  masks:\n    cover: {{ from: $areas.inner, occludes: [ring] }}\n  clip:\n    default: {clip}\n"
            )
        };
        // `auto` cuts the ring halves that fall inside the mask; `none` keeps
        // every stroke. Same profile, one word apart.
        let auto = run_yaml(&yaml("auto")).unwrap();
        let none = run_yaml(&yaml("none")).unwrap();
        assert!(none.groups[0].1 >= auto.groups[0].1);
    }

    #[test]
    fn an_id_falls_back_and_order_is_honoured() {
        let out = run_yaml(
            "$areas:\n  a: { engine_card: {} }\n\
             $lines:\n  one: { tools_rings: $areas.a }\n\
             draw:\n  - { id: top, from: $lines.one, stroke: solid }\n  - { from: $lines.one }\n\
             compose:\n  order: [lines_one, top]\n",
        )
        .unwrap();
        assert_eq!(out.groups.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), vec!["lines_one", "top"]);
    }

    #[test]
    fn the_ocean_and_the_card_are_areas_in_card_mm() {
        // The whole card is sea: its fill covers the card, and the card's
        // ring sits on the card's edge, 100 by 50 mm.
        let text = "card: { width: 100mm, height: 50mm }\n\
             $areas:\n  sea: { engine_ocean: {} }\n  frame: { engine_card: {} }\n  wet: { tools_union: [$areas.sea] }\n\
             $lines:\n  ring: { tools_rings: $areas.frame }\n\
             $fills:\n  waves: { tools_fill: { in: $areas.wet, pattern: lines, spacing: 1mm } }\n\
             draw:\n  - { id: sea, from: $fills.waves }\n  - { id: ring, from: $lines.ring, stroke: solid }\n";
        let grammar = Grammar::parse(text, Format::Yaml).unwrap();
        let ocean = MultiPolygon::new(vec![card().query_polygon()]);
        let out = run(&grammar, &card(), Inputs { features: vec![], tiles: vec![], ocean: Some(ocean), sources: &BTreeMap::new() })
            .unwrap();
        let strokes = |id: &str| out.groups.iter().find(|(g, _)| g == id).map_or(0, |(_, n)| *n);
        assert!(strokes("sea") >= 40, "one line per mm across the card, got {}", strokes("sea"));
        assert_eq!(strokes("ring"), 1);
    }

    #[test]
    fn a_loop_is_reported_rather_than_hung() {
        // Grammar validation rejects loops already; keep the executor honest.
        let text = "card: { width: 100mm, height: 50mm }\n$areas:\n  a: { tools_union: [$areas.b] }\n  b: { tools_grow: { of: $areas.a, by: 1mm } }\n";
        let grammar = Grammar::parse(text, Format::Yaml);
        assert!(grammar.is_err(), "a loop must not load");
    }

    #[test]
    fn the_proposal_renders_without_osm_data() {
        // No features: parks and water come out empty, but the card, the module
        // and the masks all have to survive the whole pipeline.
        let text = include_str!("../../../configs/proposal/postcard.yaml");
        let grammar = Grammar::parse(text, Format::Yaml).unwrap();
        let out = run(
            &grammar,
            &card(),
            Inputs { features: vec![], tiles: vec![], ocean: None, sources: &BTreeMap::new() },
        )
        .unwrap();
        assert!(!out.svg.is_empty());
        // The groups the profile names must all be present.
        assert!(out.groups.iter().any(|(id, _)| id == "bldg_ring"));
    }
}
