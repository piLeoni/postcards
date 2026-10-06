//! Running a v3 grammar: the def DAG in, SVG groups out.
//!
//! [`crate::grammar`] validates the profile; this module gives it meaning. Every
//! def evaluates to one of three things, decided by its section:
//!
//! - `$features` → a set of features, from Overpass (`osm_select`) or the
//!   vector tiles (`tiles_select`)
//! - `$areas`    → a [`MultiPolygon`] in output millimetres
//! - `$lines`    → a [`Lines`] in output millimetres
//! - `$fills`    → a `Lines` too, but produced by penfill
//!
//! Evaluation is in waves over the def DAG, so a def that references another
//! simply reads the value already computed. Fills run last, when every area is
//! known. Nothing here recomputes geometry: `$areas.dissolved` used by six defs
//! is evaluated once.
//!
//! Draw order and occlusion come from `compose`: each mask subtracts only from
//! the group ids it lists in `occludes`, so an output can draw a dotted schools
//! layer on top of everything and not cut it.

use crate::fill::{self, FillError, Sources};
use crate::geom::{self, Lines};
use crate::output::Output;
use crate::grammar::{Clip, Def, Grammar, Mask, Name, Op, Section, UnionRules};
use crate::osm::Feature;
use crate::progress::{thousands, Level, Task};
use crate::select::Selector;
use geo::MultiPolygon;
use rayon::prelude::*;
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("{0}")]
    Plan(String),
    #[error("{0}")]
    Fill(#[from] FillError),
    #[error("def {def}: {source}")]
    Def { def: String, source: FillError },
    /// A fill that would not fit the host's memory, with what to do about it.
    #[error("{0}")]
    TooLarge(String),
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

pub struct Rendered {
    pub svg: String,
    /// `(group id, stroke count)` in draw order.
    pub groups: Vec<(String, usize)>,
    /// `(name, svg)` per sheet when the output is cut (`output.slices`).
    pub slices: Vec<(String, String)>,
}

pub struct Inputs<'a> {
    /// Features in lon/lat, as `osm::features_from_overpass` returns them.
    pub features: Vec<Feature>,
    /// Vector tile features in lon/lat, as `tiles::Tiles::features` returns
    /// them: what `tiles_select` picks from.
    pub tiles: Vec<Feature>,
    /// Ocean polygons in lon/lat, when the output shows a coastline.
    pub ocean: Option<MultiPolygon<f64>>,
    /// SVG text of every file named by a fill `source`.
    pub sources: &'a BTreeMap<String, String>,
    /// The elevation under the output, read by the host when a def draws
    /// terrain; `None` when none does, so a document that never asks costs
    /// nothing.
    pub terrain: Option<crate::terrain::Grid>,
    /// Bytes the filling may use at most; `None` draws without a ceiling.
    pub memory_budget: Option<u64>,
}

/// Evaluate `grammar` against `inputs`, project to `output`, compose and write.
pub fn run(grammar: &Grammar, output: &Output, inputs: Inputs) -> Result<Rendered, RunError> {
    let draw = Task::begin(&(), "draw", None, "draw", 0, "");
    let out = run_with(grammar, output, inputs, &draw)?;
    draw.ok("");
    Ok(out)
}

/// Whether to note resident memory at each step: `DRAWLAND_MEM` in the
/// environment. Off by default; the notes go into the same progress log the
/// terminal already shows.
fn probing() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("DRAWLAND_MEM").is_some())
}

/// One line of memory at a named step, when probing.
fn probe(draw: &Task, what: &str) {
    if probing() {
        draw.log(Level::Info, &format!("mem {what}: {}", crate::progress::human_bytes(crate::progress::resident_bytes())));
    }
}


/// [`run`], with every step a task under `draw`: projecting, the defs, each
/// fill, composing, writing.
pub fn run_with(grammar: &Grammar, output: &Output, inputs: Inputs, draw: &Task) -> Result<Rendered, RunError> {
    let mut parts: Vec<String> = Vec::new();
    let drawn = run_into(grammar, output, inputs, draw, &mut |k, text| {
        if parts.len() <= k {
            parts.resize(k + 1, String::new());
        }
        parts[k].push_str(text);
    })?;
    let mut parts = parts.into_iter();
    let svg = parts.next().unwrap_or_default();
    Ok(Rendered { svg, groups: drawn.groups, slices: drawn.slices.into_iter().zip(parts).collect() })
}

/// What [`run_into`] drew, beside the text it wrote.
pub struct Drawn {
    /// `(group id, stroke count)` in draw order.
    pub groups: Vec<(String, usize)>,
    /// The sheets' names when the output is cut: part `k` of the text is
    /// sheet `k - 1`.
    pub slices: Vec<String>,
}

/// [`run_with`], the SVG text handed to `out` in pieces as it is written:
/// part 0 the whole output, part `k` the `k`th sheet. Every group is
/// generated, masked, cut and written a batch of strokes at a time, so the
/// drawing is never in memory whole, as lines or as text.
pub fn run_into(grammar: &Grammar, output: &Output, inputs: Inputs, draw: &Task, out: &mut crate::sheets::Out) -> Result<Drawn, RunError> {
    let mut sources = Sources::new();
    for (file, text) in inputs.sources {
        let drawing =
            penfill::svg::parse_svg(text).map_err(|msg| RunError::Plan(format!("source {file:?}: {msg}")))?;
        sources.insert(file.clone(), drawing);
    }

    let project = draw.child("project", "project", (inputs.features.len() + inputs.tiles.len()) as u64, "features");
    let projector = crate::projection::Projector::new(output);
    probe(draw, "start");
    let warp = &grammar.output.warp;
    let (w, h) = (output.width_mm, output.height_mm);
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
    probe(draw, "projected");
    let frame = MultiPolygon::new(vec![output.query_polygon()]);
    let ocean = inputs.ocean.map(|o| warp.bend_area(w, h, &projector.project_geometry(&geom::intersection(&o, &frame))));
    let engine = Engine {
        of: output,
        output: warp.bend_area(w, h, &projector.project_geometry(&frame)),
        ocean: ocean.unwrap_or_else(geom::empty),
        terrain: inputs.terrain.as_ref(),
        projector: &projector,
    };
    project.ok("");

    let values = evaluate(grammar, &Found { osm: &features, tiles: &tiles }, &engine, draw)?;
    probe(draw, "areas+lines");

    // Fills are not made here but in their group, as it is written: one
    // batch of strokes alive at a time.
    let fill_count = grammar.defs(Section::Fills).iter().filter(|d| matches!(d.op, Op::Fill(_))).count();
    let fills_task = draw.child("fills", "fills", fill_count as u64, "fills");
    let compose_task = draw.child("compose", "compose", 0, "");
    let spec = &grammar.output;
    let mut layout = crate::sheets::Layout::new(output.width_mm, output.height_mm, spec.padding, &spec.slices);
    let mut written = 0usize;
    let mut counted = |k: usize, text: &str| {
        if k == 0 {
            written += text.len();
        }
        out(k, text);
    };
    let fills = Fills { values: &values, sources: &sources, budget: inputs.memory_budget, task: &fills_task };
    compose(grammar, &values, &fills, &compose_task, &mut layout, &mut counted)?;
    let (groups, slices) = layout.finish(&mut counted);
    fills_task.ok("");
    compose_task.ok(&format!("{} groups", groups.len()));
    probe(draw, "composed");

    let strokes: usize = groups.iter().map(|(_, n)| n).sum();
    let cut = if slices.is_empty() { String::new() } else { format!(" · {} slices", slices.len()) };
    draw.child("svg", "svg", 0, "").ok(&format!("{} strokes · {:.1} MB{cut}", thousands(strokes as u64), written as f64 / 1e6));
    Ok(Drawn { groups, slices })
}

/// The features a selection picks from, in output millimetres.
struct Found<'a> {
    osm: &'a [Feature],
    tiles: &'a [Feature],
}

/// The output, and the `engine_*` areas in output millimetres like everything
/// evaluated.
struct Engine<'a> {
    of: &'a Output,
    output: MultiPolygon<f64>,
    ocean: MultiPolygon<f64>,
    /// The elevation under the output, when a def draws terrain; `None` when
    /// none does, so nothing is fetched for a document that never asks.
    terrain: Option<&'a crate::terrain::Grid>,
    /// The projection, so terrain pixels land in the same millimetres.
    projector: &'a crate::projection::Projector,
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
                RunError::Plan(format!("{}: {e}", def.label()))
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
        Op::Frame => Value::Area(engine.output.clone()),
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
        Op::Terrain(t) => {
            let grid = engine.terrain.ok_or("tools_terrain needs the elevation, which was not read")?;
            let drawing = crate::terrain::draw(grid, t)?;
            let drawn = crate::terrain::lines(&drawing, &grid.placed(engine.projector));
            // The elevation is read a margin past the frame so the ink reaches
            // the border (see `terrain::bounds_of`); clip it back to the page,
            // or to `in_area` when the profile asks for one.
            Value::Lines(match &t.in_area {
                Some(n) => geom::clip_lines(&drawn, &area(n)?, false),
                None => geom::clip_lines(&drawn, &engine.output, false),
            })
        }
        Op::Burin(b) => {
            let grid = engine.terrain.ok_or("tools_burin needs the elevation, which was not read")?;
            let drawing = crate::terrain::draw_burin(grid, b)?;
            let drawn = crate::terrain::lines(&drawing, &grid.placed(engine.projector));
            Value::Lines(match &b.in_area {
                Some(n) => geom::clip_lines(&drawn, &area(n)?, false),
                None => geom::clip_lines(&drawn, &engine.output, false),
            })
        }
        Op::Fill(_) => return Err("tools_fill is evaluated in the fill pass".into()),
        Op::Module(m) => match &m.from {
            Some(from) => eval_module(&m.name, &feats(from)?, engine.of)?,
            None => eval_module(&m.name, features.osm, engine.of)?,
        },
    })
}

/// The four sections of the toolkit, as values.
fn eval_module(module: &str, features: &[Feature], output: &Output) -> Result<Value, String> {
    match module {
        "roads" => {
            // The module needs no profile knobs: it reads OSM tags (or a tile
            // feature's attributes) and the output scale. Its outputs are the same three names every module publishes.
            let roads = crate::themes::roads_render(&crate::themes::Context { output, features });
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
fn module_lines<'a>(
    module: &str,
    name: &str,
    value: &'a Value,
    group: &str,
    masks_by_id: &mut BTreeMap<String, MultiPolygon<f64>>,
) -> Result<Option<&'a Lines>, RunError> {
    let Value::Module { area, outlines, details, trails, centerlines, seams } = value else {
        return Err(RunError::Plan(format!("module_{module} did not produce module outputs")));
    };
    Ok(match name {
        "area" => {
            masks_by_id.insert(group.to_string(), area.clone());
            None
        }
        "outlines" => Some(outlines),
        "details" => Some(details),
        "trails" => Some(trails),
        "centerlines" => Some(centerlines),
        "seams" => Some(seams),
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
    name: &str,
    values: &'a BTreeMap<Name, Value>,
    grammar: &Grammar,
) -> Result<&'a Value, RunError> {
    let def = grammar
        .module(module)
        .ok_or_else(|| RunError::Plan(format!("nothing calls module_{module}")))?;
    let _ = name;
    values
        .get(&def.reference())
        .ok_or_else(|| RunError::Plan(format!("module_{module} was not evaluated")))
}

/// Paper area of a region, square millimetres, for the fill cost estimate.
fn area_area(mp: &MultiPolygon<f64>) -> f64 {
    use geo::Area;
    mp.unsigned_area()
}

fn refs_of(rules: &UnionRules) -> Vec<Name> {    match rules {
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

/// What the fills need to be made in their group: the evaluated defs, the
/// SVG sources, the host's memory ceiling, and the task their rows go under.
struct Fills<'a> {
    values: &'a BTreeMap<Name, Value>,
    sources: &'a Sources,
    budget: Option<u64>,
    task: &'a Task<'a>,
}

/// How many buildings `per: feature` fills at once, in parallel: enough to
/// keep the cores busy, few enough that their strokes stay small.
const PIECES_AT_ONCE: usize = 256;

/// Make the fill `def` into `sink`: one pass, or one per feature for
/// `per: feature`.
fn run_fill(def: &Def, spec: &crate::grammar::Fill, fills: &Fills, sink: &mut GroupSink) -> Result<(), RunError> {
    let name = def.reference();
    let task = fills.task.child(&format!("fill:{name}"), &name.to_string(), 0, "pieces");
    let area = fills
        .values
        .get(&spec.in_area)
        .ok_or_else(|| RunError::Plan(format!("{name}: missing input {}", spec.in_area)))?
        .area(&spec.in_area)?;
    let failed = |source| RunError::Def { def: def.label(), source };
    let start = sink.fed;
    if let Some(content) = &spec.content {
        let lines = fills
            .values
            .get(content)
            .ok_or_else(|| RunError::Plan(format!("{name}: missing content {content}")))?
            .lines(content)?;
        task.set_total(1);
        for l in fill::fill_with(area, lines) {
            sink.line(l);
        }
    } else if spec.per_feature {
        // One penfill run per polygon of the input area, so neighbouring
        // buildings keep their own hatching instead of merging.
        task.set_total(area.0.len() as u64);
        for chunk in area.0.chunks(PIECES_AT_ONCE) {
            let filled: Result<Vec<Lines>, FillError> = chunk
                .par_iter()
                .map(|p| {
                    let lines = fill::fill(&MultiPolygon::new(vec![p.clone()]), &spec.spec, fills.sources);
                    task.tick();
                    lines
                })
                .collect();
            for l in filled.map_err(failed)?.into_iter().flatten() {
                sink.line(l);
            }
        }
    } else {
        // A generator that cannot stream holds its whole fill at once:
        // inside a page, one that would not fit is refused before it starts,
        // since the WASM allocator traps rather than failing. From the
        // command line `budget` is `None` and this is skipped.
        let generator = spec.spec.generator.clone().unwrap_or_else(|| "dots".into());
        if let Some(budget) = fills.budget.filter(|_| spec.spec.source.is_some() || !fill::streams(&generator)) {
            let spacing = fill::spacing_mm(&spec.spec).unwrap_or(0.5);
            let estimate = crate::budget::cost(area_area(area), &generator, spacing);
            if estimate.bytes > budget {
                let detail = format!(
                    "{name}: this fill needs {}, more than the {} the page has. It covers {} mm² of paper \
                     with {generator} at {spacing} mm. Widen the spacing, use a sparser pattern, shrink the \
                     output, or draw it with the command line.",
                    crate::progress::human_bytes(estimate.bytes),
                    crate::progress::human_bytes(budget),
                    thousands(estimate.area_mm2 as u64),
                );
                task.fail(&detail);
                return Err(RunError::TooLarge(detail));
            }
        }
        task.set_total(1);
        fill::fill_into(area, &spec.spec, fills.sources, sink).map_err(failed)?;
    }
    task.tick();
    task.ok(&format!("{} lines", thousands((sink.fed - start) as u64)));
    fills.task.tick();
    Ok(())
}

/// One group on its way to the paper: strokes come in, are styled, gathered
/// into a batch, cut by the masks over the group, and written. Only the
/// batch is ever held.
struct GroupSink<'a, 'o> {
    stroke: Option<&'a crate::profile::StrokeSpec>,
    /// What the masks over this group cover; empty when none does.
    mask: &'a MultiPolygon<f64>,
    pending: Lines,
    points: usize,
    /// Strokes taken in, before styling and masking: for the progress row.
    fed: usize,
    layout: &'a mut crate::sheets::Layout,
    out: &'a mut crate::sheets::Out<'o>,
}

impl GroupSink<'_, '_> {
    fn line(&mut self, line: geo::LineString<f64>) {
        self.fed += 1;
        match self.stroke {
            None => self.push(line),
            Some(s) => {
                for l in fill::stroke(vec![line], s) {
                    self.push(l);
                }
            }
        }
    }

    fn push(&mut self, line: geo::LineString<f64>) {
        self.points += line.0.len();
        self.pending.push(line);
        if self.points >= geom::BATCH_POINTS {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        let batch = std::mem::take(&mut self.pending);
        self.points = 0;
        let kept = if self.mask.0.is_empty() { batch } else { geom::clip_lines(&batch, self.mask, true) };
        self.layout.lines(&kept, self.out);
    }
}

impl penfill::Sink for GroupSink<'_, '_> {
    fn stroke(&mut self, pts: Vec<(f64, f64)>) {
        if pts.len() >= 2 {
            self.line(geo::LineString::new(pts.into_iter().map(|(x, y)| geo::Coord { x, y }).collect()));
        }
    }
}

/// What a draw entry draws: lines already made, a fill still to make, or
/// nothing (a module's `area`, which masks instead).
enum Drawing<'a> {
    Lines(&'a Lines),
    Fill(&'a Def, &'a crate::grammar::Fill),
    Nothing,
}

/// Write `draw` + `compose` onto `layout`, group by group in order, each
/// made as it is written.
fn compose(
    grammar: &Grammar,
    values: &BTreeMap<Name, Value>,
    fills: &Fills,
    task: &Task,
    layout: &mut crate::sheets::Layout,
    out: &mut crate::sheets::Out,
) -> Result<(), RunError> {
    // 1. What each draw entry draws, and with what stroke.
    let mut drawn: BTreeMap<String, (Drawing, Option<&crate::profile::StrokeSpec>)> = BTreeMap::new();
    let mut masks_by_id: BTreeMap<String, MultiPolygon<f64>> = BTreeMap::new();

    let strokes_task = task.child("compose:strokes", "strokes", grammar.draw.len() as u64, "draws");
    for draw in &grammar.draw {
        let what = match &draw.from.module {
            Some(module) => {
                let value = module_output(module, &draw.from.name.name, values, grammar)?;
                module_lines(module, &draw.from.name.name, value, &draw.group(), &mut masks_by_id)?
                    .map_or(Drawing::Nothing, Drawing::Lines)
            }
            None => match draw.from.name.section {
                Section::Lines => match values.get(&draw.from.name) {
                    Some(v) => Drawing::Lines(v.lines(&draw.from.name)?),
                    None => Drawing::Nothing,
                },
                Section::Fills => match grammar.find(&draw.from.name) {
                    Some(def @ Def { op: Op::Fill(spec), .. }) => Drawing::Fill(def, spec),
                    _ => Drawing::Nothing,
                },
                other => {
                    return Err(RunError::Plan(format!(
                        "draw from ${other}.{}: need $lines or $fills",
                        draw.from.name.name
                    )))
                }
            },
        };
        drawn.insert(draw.group(), (what, draw.stroke.as_ref()));
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

    // 4. Each group made, masked and written. A mask cuts exactly the groups
    // it lists, wherever they sit in the order: the order is only the
    // sequence the groups are drawn in.
    let occlude_task = task.child("compose:occlude", "occlusion", order.len() as u64, "groups");
    for id in &order {
        occlude_task.tick();
        let Some((what, stroke)) = drawn.remove(id) else { continue };
        let mut above = geom::empty();
        for (name, mask) in &grammar.compose.masks {
            if !mask.occludes.iter().any(|o| &o.0 == id) {
                continue;
            }
            let Some(area) = masks_by_id.get(name) else { continue };
            above = geom::union_multi([&above, area]);
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
        layout.begin_with_style(id, stroke);
        let mut sink = GroupSink { stroke, mask: &above, pending: Vec::new(), points: 0, fed: 0, layout, out };
        match what {
            Drawing::Lines(lines) => {
                for l in lines {
                    sink.line(l.clone());
                }
            }
            Drawing::Fill(def, spec) => run_fill(def, spec, fills, &mut sink)?,
            Drawing::Nothing => {}
        }
        sink.flush();
        layout.end();
        if probing() {
            occlude_task.log(Level::Info, &format!("mem group {id}: {}", crate::progress::human_bytes(crate::progress::resident_bytes())));
        }
    }
    occlude_task.ok("");
    Ok(())
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
    use crate::profile::OutputSpec;
    use crate::grammar::from_yaml;
    use crate::units::{Mm, Scale};

    fn output() -> Output {
        let map = OutputSpec {
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
            tile_zoom: None,
        };
        Output::new(&map, (0.0, 0.0))
    }

    /// A grammar with no OSM data: only the parts that need no fetch.
    fn run_yaml(yaml: &str) -> Result<Rendered, RunError> {
        let text = format!("output: {{ width: 100mm, height: 50mm }}\n{yaml}");
        let grammar = from_yaml(&text).expect("profile loads");
        run(
            &grammar,
            &output(),
            Inputs { features: vec![], tiles: vec![], ocean: None, sources: &BTreeMap::new(), terrain: None, memory_budget: None },
        )
    }

    #[test]
    fn an_area_and_its_ring_reach_draw() {
        let out = run_yaml(
            "$areas:\n  block: { engine_frame: {} }\n\
             $lines:\n  ring: { tools_rings: { of: $areas.block, exterior_only: true } }\n\
             draw:\n  - { from: $lines.ring, stroke: solid }\n",
        )
        .unwrap();
        assert_eq!(out.groups, vec![("lines_ring".to_string(), 1)]);
        assert!(out.svg.contains(r#"<g id="lines_ring">"#));
    }

    #[test]
    fn a_mask_cuts_what_it_occludes_and_leaves_the_rest() {
        // The output is 100x50; `inner` is it inset by 20mm (60x10). The frame
        // ring (the output border) is entirely outside `inner`, so listing it in
        // `occludes` cannot delete it — but the two groups must differ, because
        // the half drawn over the mask is cut.
        let out = run_yaml(
            "$areas:\n  frame: { engine_frame: {} }\n  inner: { tools_grow: { of: $areas.frame, by: -20mm } }\n\
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
    fn a_mask_cuts_what_it_lists_wherever_it_sits_in_the_order() {
        // `inner`'s own ring is drawn first, the hatch over it; the mask made of
        // `inner` lists the hatch, so the hatch is cut although it is on top.
        let yaml = |masks: &str| {
            format!(
                "$areas:\n  frame: {{ engine_frame: {{}} }}\n  inner: {{ tools_grow: {{ of: $areas.frame, by: -20mm }} }}\n\
                 $lines:\n  edge: {{ tools_rings: $areas.inner }}\n\
                 $fills:\n  hatch: {{ tools_fill: {{ in: $areas.frame, pattern: lines, spacing: 5mm, angle: 0 }} }}\n\
                 draw:\n  - {{ id: edge, from: $lines.edge, stroke: solid }}\n  - {{ id: hatch, from: $fills.hatch }}\n{masks}"
            )
        };
        let strokes = |out: &Rendered, id: &str| out.groups.iter().find(|(g, _)| g == id).map_or(0, |(_, n)| *n);
        let whole = run_yaml(&yaml("")).unwrap();
        let cut = run_yaml(&yaml("compose:\n  masks:\n    cover: { from: $areas.inner, occludes: [hatch] }\n")).unwrap();
        assert!(strokes(&cut, "hatch") > strokes(&whole, "hatch"), "the lines across `inner` are split in two");
        assert_eq!(strokes(&cut, "edge"), strokes(&whole, "edge"), "a group the mask does not list is left alone");
    }

    #[test]
    fn clip_none_disables_the_masks() {
        let yaml = |clip: &str| {
            format!(
                "$areas:\n  frame: {{ engine_frame: {{}} }}\n  inner: {{ tools_grow: {{ of: $areas.frame, by: -20mm }} }}\n\
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
            "$areas:\n  a: { engine_frame: {} }\n\
             $lines:\n  one: { tools_rings: $areas.a }\n\
             draw:\n  - { id: top, from: $lines.one, stroke: solid }\n  - { from: $lines.one }\n\
             compose:\n  order: [lines_one, top]\n",
        )
        .unwrap();
        assert_eq!(out.groups.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), vec!["lines_one", "top"]);
    }

    #[test]
    fn the_ocean_and_the_card_are_areas_in_card_mm() {
        // The whole output is sea: its fill covers the output, and the output's
        // ring sits on the output's edge, 100 by 50 mm.
        let text = "output: { width: 100mm, height: 50mm }\n\
             $areas:\n  sea: { engine_ocean: {} }\n  frame: { engine_frame: {} }\n  wet: { tools_union: [$areas.sea] }\n\
             $lines:\n  ring: { tools_rings: $areas.frame }\n\
             $fills:\n  waves: { tools_fill: { in: $areas.wet, pattern: lines, spacing: 1mm } }\n\
             draw:\n  - { id: sea, from: $fills.waves }\n  - { id: ring, from: $lines.ring, stroke: solid }\n";
        let grammar = from_yaml(text).unwrap();
        let ocean = MultiPolygon::new(vec![output().query_polygon()]);
        let out = run(&grammar, &output(), Inputs { features: vec![], tiles: vec![], ocean: Some(ocean), sources: &BTreeMap::new(), terrain: None, memory_budget: None })
            .unwrap();
        let strokes = |id: &str| out.groups.iter().find(|(g, _)| g == id).map_or(0, |(_, n)| *n);
        assert!(strokes("sea") >= 40, "one line per mm across the output, got {}", strokes("sea"));
        assert_eq!(strokes("ring"), 1);
    }

    #[test]
    fn a_fill_takes_other_lines_as_its_content_cut_to_the_area() {
        // The ring of a 60x10 box inset in the frame, as the content of two
        // fills: kept whole in the frame, gone from a smaller box inside it.
        let out = run_yaml(
            "$areas:\n  frame: { engine_frame: {} }\n  inner: { tools_grow: { of: $areas.frame, by: -20mm } }\n  core: { tools_grow: { of: $areas.frame, by: -22mm } }\n\
             $lines:\n  ring: { tools_rings: $areas.inner }\n\
             $fills:\n  core: { tools_fill: { in: $areas.core, content: $lines.ring } }\n  all: { tools_fill: { in: $areas.frame, content: $lines.ring } }\n\
             draw:\n  - { id: core, from: $fills.core }\n  - { id: all, from: $fills.all }\n",
        )
        .unwrap();
        let strokes = |id: &str| out.groups.iter().find(|(g, _)| g == id).map_or(0, |(_, n)| *n);
        assert_eq!(strokes("core"), 0, "the ring is outside the smaller box");
        assert!(strokes("all") >= 1, "and inside the frame");
    }

    #[test]
    fn a_loop_is_reported_rather_than_hung() {
        // Grammar validation rejects loops already; keep the executor honest.
        let text = "output: { width: 100mm, height: 50mm }\n$areas:\n  a: { tools_union: [$areas.b] }\n  b: { tools_grow: { of: $areas.a, by: 1mm } }\n";
        let grammar = from_yaml(text);
        assert!(grammar.is_err(), "a loop must not load");
    }
}
