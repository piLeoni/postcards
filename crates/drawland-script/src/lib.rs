//! draw.land profiles in JavaScript.
//!
//! A profile is a script that calls our library (`library.js`, over the
//! natives below); running it builds the operation graph the engine draws.
//! The script never touches geometry: by the time anything is drawn, the
//! interpreter is gone and only the graph is left.
//!
//! ```js
//! const bldg = features.osm({ building: true })
//! const foot = areas.polygons(bldg)
//! draw({ id: "bldg_fill", from: fills.fill({ in: foot, pattern: "zigzag", spacing: "0.5mm", per: "feature" }) })
//! ```
//!
//! Every node remembers the script line that made it, and every error (a
//! syntax error, a wrong argument, a bad reference found by validation) comes
//! back as `line N column M: …`, the form the web editor underlines.
//!
//! The sandbox is the bare language plus the library: no network, files,
//! timers or console, no `Date` or `Math.random` (the same script always
//! draws the same map), and loops and recursion are capped.

use boa_engine::{js_string, Context, JsError, JsNativeError, JsResult, JsValue, NativeFunction, Source};
use drawland_core::grammar::{self, At, Clip, Compose, Def, Draw, Grammar, Id, Mask, Name, Section, Target};
use drawland_core::profile::{OutputSpec, StrokeSpec};
use serde_json::Value;
use std::cell::RefCell;
use std::fmt;

const LIBRARY: &str = include_str!("library.js");

include!(concat!(env!("OUT_DIR"), "/presets.rs"));

/// How deep views may nest (a view drawing a preset that has views of its own).
const VIEW_DEPTH: usize = 4;

/// The name scripts run under; positions in other sources (the library) are
/// not the user's.
pub const SCRIPT_PATH: &str = "profile.js";
const LIBRARY_PATH: &str = "drawland:library";

/// The most loop iterations one loop may run, and the deepest recursion: a
/// mistaken `while (true)` ends with an error instead of hanging the page.
pub const LOOP_LIMIT: u64 = 1_000_000;
pub const RECURSION_LIMIT: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptError {
    pub message: String,
    pub at: Option<At>,
}

impl fmt::Display for ScriptError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self.at {
            Some(at) => write!(f, "{at}: {}", self.message),
            None => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for ScriptError {}

/// Run `source` and return the graph it built, validated.
pub fn evaluate(source: &str) -> Result<Grammar, ScriptError> {
    BUILDER.with(|b| b.borrow_mut().clear());
    BUILDER.with(|b| b.borrow_mut().push(Builder::default()));
    let result = run(source);
    let builder = BUILDER.with(|b| b.borrow_mut().pop()).unwrap_or_default();
    BUILDER.with(|b| b.borrow_mut().clear());
    result?;
    builder.finish()
}

fn run(source: &str) -> Result<(), ScriptError> {
    let mut ctx = Context::default();
    let limits = ctx.runtime_limits_mut();
    limits.set_loop_iteration_limit(LOOP_LIMIT);
    limits.set_recursion_limit(RECURSION_LIMIT);
    install(&mut ctx).map_err(|e| ScriptError { message: format!("library: {e}"), at: None })?;
    let script = Source::from_bytes(source).with_path(std::path::Path::new(SCRIPT_PATH));
    ctx.eval(script).map(|_| ()).map_err(|e| script_error(e, source, &mut ctx))
}

/// The sandbox, the natives and the library.
fn install(ctx: &mut Context) -> JsResult<()> {
    ctx.eval(Source::from_bytes(
        "delete globalThis.Date; delete Math.random; delete globalThis.WeakRef; delete globalThis.FinalizationRegistry;",
    ))?;
    let natives: [(&str, usize, fn(&JsValue, &[JsValue], &mut Context) -> JsResult<JsValue>); 13] = [
        ("node", 2, native_node),
        ("draw", 1, native_draw),
        ("order", 1, native_order),
        ("mask", 1, native_mask),
        ("clip", 1, native_clip),
        ("optimize", 1, native_optimize),
        ("output", 1, native_output),
        ("title", 1, native_title),
        ("fail", 1, native_fail),
        ("burin", 1, native_burin),
        ("viewBegin", 1, native_view_begin),
        ("viewEnd", 1, native_view_end),
        ("viewPreset", 2, native_view_preset),
    ];
    let dl = boa_engine::object::ObjectInitializer::new(ctx).build();
    for (name, arity, f) in natives {
        let function = boa_engine::object::FunctionObjectBuilder::new(ctx.realm(), NativeFunction::from_fn_ptr(f))
            .name(js_string!(name))
            .length(arity)
            .build();
        dl.set(js_string!(name), function, false, ctx)?;
    }
    ctx.register_global_property(js_string!("__drawland"), dl, boa_engine::property::Attribute::all())?;
    ctx.eval(Source::from_bytes(LIBRARY).with_path(std::path::Path::new(LIBRARY_PATH)))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// What the script has built so far
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Builder {
    title: Option<String>,
    output: Option<OutputSpec>,
    defs: Vec<Def>,
    count: usize,
    draw: Vec<Draw>,
    order: Vec<Id>,
    order_at: Option<At>,
    masks: Vec<(String, Mask)>,
    clip: Option<Clip>,
    optimize: Vec<drawland_core::optimize::OptimizeStep>,
    views: Vec<grammar::View>,
    /// For a view: its id, corner, and the output keys that override what
    /// the style itself asks (the place, the rectangle's size, no padding).
    view: Option<ViewHead>,
    /// The last error a native raised, with the user's line: a JS error
    /// thrown from the library would otherwise point inside the library.
    failure: Option<(String, Option<At>)>,
}

thread_local! {
    /// The graph being built, innermost last: a view builds its own.
    static BUILDER: RefCell<Vec<Builder>> = const { RefCell::new(Vec::new()) };
}

fn with<T>(f: impl FnOnce(&mut Builder) -> T) -> T {
    BUILDER.with(|b| f(b.borrow_mut().last_mut().expect("natives run inside evaluate")))
}

impl Builder {
    fn finish(self) -> Result<Grammar, ScriptError> {
        let output = match (self.output, &self.view) {
            (Some(o), _) => o,
            // A view whose style never called `output`: its own keys are all.
            (None, Some((_, _, keys, _))) => serde_json::from_value(Value::Object(keys.clone()))
                .map_err(|e| ScriptError { message: format!("view: {e}"), at: None })?,
            (None, None) => serde_json::from_value(Value::Object(Default::default())).expect("an empty output is valid"),
        };
        let mut sections: Vec<(Section, Vec<Def>)> = Vec::new();
        for section in Section::ALL {
            let defs: Vec<Def> = self.defs.iter().filter(|d| d.op.section() == section).cloned().collect();
            if !defs.is_empty() {
                sections.push((section, defs));
            }
        }
        let groups: Vec<String> = self.draw.iter().map(Draw::group).collect();
        if let Some(missing) = self.order.iter().find(|id| !groups.contains(&id.0)) {
            return Err(ScriptError {
                message: format!("compose.order names {:?}, which no draw writes", missing.0),
                at: self.order_at,
            });
        }
        let compose = Compose {
            order: self.order,
            masks: self.masks,
            clip: Default::default(),
            clip_default: self.clip.unwrap_or(Clip::Auto),
            optimize: self.optimize,
        };
        let graph = Grammar { title: self.title, output, sections, draw: self.draw, compose, views: self.views };
        grammar::validate(&graph).map_err(|e| {
            let message = e.to_string();
            ScriptError { at: find_at(&message), message }
        })?;
        Ok(graph)
    }
}

// ---------------------------------------------------------------------------
// Natives
// ---------------------------------------------------------------------------

/// Where the user's script is in the call stack: the innermost call in the
/// profile, skipping the library's own. Read from an `Error`'s `stack`, which
/// records call sites (the frames' own positions lag inside functions).
fn user_at(ctx: &mut Context) -> Option<At> {
    let error = ctx.intrinsics().constructors().error().constructor();
    let error = error.construct(&[], None, ctx).ok()?;
    let stack = error.get(js_string!("stack"), ctx).ok()?.to_string(ctx).ok()?.to_std_string_escaped();
    let marker = format!("({SCRIPT_PATH}:");
    stack.lines().find_map(|line| {
        let spot = &line[line.find(&marker)? + marker.len()..];
        let (l, c) = spot.trim_end_matches(')').split_once(':')?;
        Some(At(l.parse().ok()?, c.parse().ok()?))
    })
}

fn fail(ctx: &mut Context, message: impl Into<String>) -> JsError {
    let message = message.into();
    let at = user_at(ctx);
    with(|b| b.failure = Some((message.clone(), at)));
    JsNativeError::typ().with_message(message).into()
}

fn json_arg(args: &[JsValue], i: usize, ctx: &mut Context) -> JsResult<Value> {
    let value = args.get(i).cloned().unwrap_or_default();
    Ok(value.to_json(ctx)?.unwrap_or(Value::Null))
}

fn string_arg(args: &[JsValue], i: usize, ctx: &mut Context) -> JsResult<String> {
    Ok(args.get(i).cloned().unwrap_or_default().to_string(ctx)?.to_std_string_escaped())
}

/// `dl.node(section, { op_key: … })` → the new def's reference.
fn native_node(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let section = string_arg(args, 0, ctx)?;
    let op = json_arg(args, 1, ctx)?;
    let at = user_at(ctx);
    let section = Section::ALL.into_iter().find(|s| s.key() == section).ok_or_else(|| fail(ctx, "unknown section"))?;
    let key = op.as_object().and_then(|o| o.keys().next().cloned()).unwrap_or_default();
    let parsed = grammar::op_from_json(section, op).map_err(|e| fail(ctx, strip_kind(&e.to_string())))?;
    let short = key
        .strip_prefix("tools_")
        .or_else(|| key.strip_prefix("engine_"))
        .or_else(|| key.strip_suffix("_select"))
        .unwrap_or(&key);
    let name = match key.strip_prefix("module_") {
        Some(module) => {
            if with(|b| b.defs.iter().any(|d| d.name == module)) {
                return Err(fail(ctx, format!("modules.{module} is called twice; call it once and reuse its outputs")));
            }
            module.to_string()
        }
        None => with(|b| {
            b.count += 1;
            format!("{short}_{}", b.count)
        }),
    };
    let def = Def { name, op: parsed, at };
    let reference = def.reference().to_string();
    with(|b| b.defs.push(def));
    Ok(JsValue::from(js_string!(reference)))
}

/// `dl.burin(callback)` → the atlas JSON the burin document built.
///
/// The callback is a real function in this engine, so a burin document written
/// here has the same errors, positions and editor hints as anywhere else; the
/// atlas it builds is burin's own, and the engine draws it later.
fn native_burin(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let callback = args.first().cloned().unwrap_or_default();
    match burin_map_script::run_builder(ctx, &callback, SCRIPT_PATH) {
        Ok(atlas) => Ok(JsValue::from(js_string!(atlas.to_string()))),
        Err(e) => {
            let message = e.message;
            let at = e.at.map(|a| At(a.0, a.1));
            with(|b| b.failure = Some((message.clone(), at)));
            Err(JsNativeError::typ().with_message(message).into())
        }
    }
}

/// `$lines.x`, `$fills.x` or `roads.outlines`.
fn target(text: &str) -> Result<Target, String> {
    if text.starts_with('$') {
        return Name::parse(text).map(|name| Target { module: None, name });
    }
    match text.split_once('.') {
        Some((module, output)) => Ok(Target {
            module: Some(module.to_string()),
            name: Name { section: Section::Lines, name: output.to_string() },
        }),
        None => Err(format!("{text:?} is not a reference")),
    }
}

fn native_draw(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let spec = json_arg(args, 0, ctx)?;
    let at = user_at(ctx);
    let from = target(spec["from"].as_str().unwrap_or_default()).map_err(|e| fail(ctx, format!("draw: {e}")))?;
    let stroke = match spec.get("stroke") {
        None => None,
        Some(s) => Some(
            serde_json::from_value::<StrokeSpec>(s.clone())
                .map_err(|e| fail(ctx, format!("draw: stroke {s}: {e}; write solid, dash, dotted, none or {{ style, dash, gap, mark, color, width, cap, join }}")))?,
        ),
    };
    let id = spec.get("id").and_then(Value::as_str).map(str::to_string);
    let draw = Draw { id, from, stroke, at };
    let group = draw.group();
    if with(|b| b.draw.iter().any(|d| d.group() == group)) {
        return Err(fail(ctx, format!("draw: the id {group:?} is already drawn")));
    }
    with(|b| b.draw.push(draw));
    Ok(JsValue::from(js_string!(group)))
}

fn native_order(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let ids: Vec<String> = serde_json::from_value(json_arg(args, 0, ctx)?).unwrap_or_default();
    let at = user_at(ctx);
    with(|b| {
        b.order = ids.into_iter().map(Id).collect();
        b.order_at = at;
    });
    Ok(JsValue::undefined())
}

fn native_mask(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let spec = json_arg(args, 0, ctx)?;
    let at = user_at(ctx);
    let from = target(spec["from"].as_str().unwrap_or_default()).map_err(|e| fail(ctx, format!("compose.mask: {e}")))?;
    let occludes: Vec<String> = serde_json::from_value(spec["occludes"].clone()).unwrap_or_default();
    let name = with(|b| match spec["name"].as_str() {
        Some(n) => n.to_string(),
        None => format!("mask_{}", b.masks.len() + 1),
    });
    if with(|b| b.masks.iter().any(|(n, _)| *n == name)) {
        return Err(fail(ctx, format!("compose.mask: the name {name:?} is already used")));
    }
    with(|b| b.masks.push((name, Mask { from, occludes: occludes.into_iter().map(Id).collect(), at })));
    Ok(JsValue::undefined())
}

fn native_clip(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let clip = match json_arg(args, 0, ctx)? {
        Value::String(s) if s == "auto" => Clip::Auto,
        Value::String(s) if s == "none" => Clip::None,
        Value::Array(items) => Clip::Areas(
            items
                .iter()
                .map(|v| Name::parse(v.as_str().unwrap_or_default()))
                .collect::<Result<_, _>>()
                .map_err(|e| fail(ctx, format!("compose.clip: {e}")))?,
        ),
        other => return Err(fail(ctx, format!("compose.clip: {other} is not auto, none or a list of areas"))),
    };
    with(|b| b.clip = Some(clip));
    Ok(JsValue::undefined())
}

fn native_optimize(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let spec = json_arg(args, 0, ctx)?;
    let at = user_at(ctx);
    let raw: grammar::RawOptimizeStep = serde_json::from_value(spec)
        .map_err(|e| fail(ctx, format!("compose: {}", strip_kind(&e.to_string()))))?;
    let step = drawland_core::optimize::OptimizeStep {
        layers: raw.layers.into_iter().map(Id).collect(),
        except: raw.except.into_iter().map(Id).collect(),
        op: raw.op,
        at,
    };
    with(|b| b.optimize.push(step));
    Ok(JsValue::undefined())
}

/// `dl.output(spec)` → the output as it will be: inside a view, the view's
/// place and rectangle win over what the style asks, so a preset drawn in a
/// view keeps its paper-independent look (pens, patterns) at the view's place.
fn native_output(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let mut spec = json_arg(args, 0, ctx)?;
    if let (Some(obj), Some(keys)) = (spec.as_object_mut(), with(|b| b.view.as_ref().map(|v| v.2.clone()))) {
        for k in ["address", "slices"] {
            obj.remove(k);
        }
        obj.extend(keys);
    }
    let output: OutputSpec = serde_json::from_value(spec.clone()).map_err(|e| fail(ctx, format!("output: {e}")))?;
    if with(|b| b.output.replace(output).is_some()) {
        return Err(fail(ctx, "output is set twice"));
    }
    JsValue::from_json(&spec, ctx)
}

/// A view's id, corner, ink, and the output keys its spec sets.
type ViewHead = (String, (f64, f64), serde_json::Map<String, Value>, Option<String>);

/// The output keys a view's spec sets: `{ id, at: [x, y], size: [w, h] }` in
/// page mm, and the place (`lat`, `lng`, `scale`, `bearing`, `tileZoom`,
/// `projection`). The view's id and corner, and those keys.
fn view_keys(spec: &Value) -> Result<ViewHead, String> {
    let o = spec.as_object().ok_or("view takes { at, size, lat, lng, scale, … }")?;
    let pair = |k: &str| -> Result<(f64, f64), String> {
        match o.get(k).and_then(Value::as_array).map(|a| a.iter().map(Value::as_f64).collect::<Vec<_>>()) {
            Some(v) if v.len() == 2 && v.iter().all(Option::is_some) => Ok((v[0].unwrap(), v[1].unwrap())),
            _ => Err(format!("view.{k} is [x, y] in millimetres")),
        }
    };
    let at = pair("at")?;
    let (w, h) = pair("size")?;
    if w <= 0.0 || h <= 0.0 {
        return Err("view.size must be positive".into());
    }
    let id = o.get("id").and_then(Value::as_str).ok_or("view.id names the view, as compose.mask occludes it")?.to_string();
    let mut keys = serde_json::Map::new();
    keys.insert("width".into(), Value::String(format!("{w}mm")));
    keys.insert("height".into(), Value::String(format!("{h}mm")));
    keys.insert("padding".into(), Value::from(0));
    for k in ["lat", "lng", "scale", "bearing", "tileZoom", "projection"] {
        if let Some(v) = o.get(k) {
            keys.insert(k.into(), v.clone());
        }
    }
    let ink = match o.get("ink") {
        None | Some(Value::Null) => None,
        Some(Value::String(c)) if !c.trim().is_empty() => Some(c.trim().to_string()),
        Some(v) => return Err(format!("view.ink is a colour like \"#e4572e\", got {v}")),
    };
    Ok((id, at, keys, ink))
}

/// `dl.viewBegin(spec)`: the graph the next calls build is the view's.
fn native_view_begin(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let spec = json_arg(args, 0, ctx)?;
    let view = view_keys(&spec).map_err(|e| fail(ctx, e))?;
    if BUILDER.with(|b| b.borrow().len()) > VIEW_DEPTH {
        return Err(fail(ctx, "views nest too deep"));
    }
    if with(|b| b.views.iter().any(|v| v.id == view.0)) {
        return Err(fail(ctx, format!("two views are called {:?}", view.0)));
    }
    BUILDER.with(|b| b.borrow_mut().push(Builder { view: Some(view), ..Builder::default() }));
    Ok(JsValue::undefined())
}

/// `dl.viewEnd(ok)`: the view's graph is done; it joins the page's views
/// (`ok`), or is dropped (the style threw).
fn native_view_end(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let ok = args.first().is_some_and(JsValue::to_boolean);
    let inner = BUILDER.with(|b| if b.borrow().len() > 1 { b.borrow_mut().pop() } else { None });
    let Some(inner) = inner else { return Err(fail(ctx, "viewEnd without viewBegin")) };
    if !ok {
        return Ok(JsValue::undefined());
    }
    attach(inner, ctx)
}

/// `dl.viewPreset(spec, id)`: a view drawn in a built-in preset, run on its
/// own (its top-level names never meet the page's).
fn native_view_preset(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let spec = json_arg(args, 0, ctx)?;
    let id = string_arg(args, 1, ctx)?;
    let view = view_keys(&spec).map_err(|e| fail(ctx, e))?;
    let Some((_, source)) = PRESETS.iter().find(|(p, _)| *p == id) else {
        let known: Vec<&str> = PRESETS.iter().map(|(p, _)| *p).collect();
        return Err(fail(ctx, format!("no preset {id:?}; one of {}", known.join(", "))));
    };
    if BUILDER.with(|b| b.borrow().len()) > VIEW_DEPTH {
        return Err(fail(ctx, "views nest too deep"));
    }
    let view_id = view.0.clone();
    BUILDER.with(|b| b.borrow_mut().push(Builder { view: Some(view), ..Builder::default() }));
    let result = run(source);
    let inner = BUILDER.with(|b| b.borrow_mut().pop()).expect("pushed above");
    if let Err(e) = result {
        return Err(fail(ctx, format!("view {view_id} ({id}): {e}")));
    }
    attach(inner, ctx)
}

/// A finished view's graph, added to the page's views; its id back.
fn attach(inner: Builder, ctx: &mut Context) -> JsResult<JsValue> {
    let (id, at, _, ink) = inner.view.clone().expect("a view builder");
    let grammar = inner.finish().map_err(|e| fail(ctx, format!("view {id}: {}", e.message)))?;
    with(|b| b.views.push(grammar::View { id: id.clone(), at, grammar: Box::new(grammar), ink }));
    Ok(JsValue::from(js_string!(id)))
}

fn native_title(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let text = string_arg(args, 0, ctx)?;
    with(|b| b.title = Some(text));
    Ok(JsValue::undefined())
}

fn native_fail(_: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let message = string_arg(args, 0, ctx)?;
    Err(fail(ctx, message))
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// `profile: …` and the like: the grammar's own prefixes mean nothing to a
/// script author.
fn strip_kind(message: &str) -> String {
    message.strip_prefix("profile: ").unwrap_or(message).to_string()
}

/// The first `line N column M` in a message.
fn find_at(message: &str) -> Option<At> {
    let start = message.find("line ")?;
    let rest = &message[start + 5..];
    let (line, rest) = rest.split_once(" column ")?;
    let column: String = rest.chars().take_while(char::is_ascii_digit).collect();
    Some(At(line.parse().ok()?, column.parse().ok()?))
}

fn script_error(err: JsError, source: &str, ctx: &mut Context) -> ScriptError {
    let native = err.try_native(ctx).ok();
    let message = native.as_ref().map(|n| n.message().to_string());
    if let (Some(message), Some((failed, at))) = (&message, with(|b| b.failure.take())) {
        if *message == failed {
            return ScriptError { message: failed, at };
        }
    }
    let text = err.to_string();
    let first = text.lines().next().unwrap_or_default();
    let kind = native.as_ref().map(|n| format!("{}", n.kind())).unwrap_or_default();
    let message = match (&message, kind.is_empty()) {
        (Some(m), false) => format!("{kind}: {m}"),
        _ => first.split(" (").next().unwrap_or(first).to_string(),
    };
    // `x is not defined` comes without a reliable position: the first use of
    // the name.
    if let Some(name) = message.strip_prefix("ReferenceError: ").and_then(|m| m.strip_suffix(" is not defined")) {
        if let Some(at) = first_use(source, name) {
            return ScriptError { at: Some(at), message };
        }
    }
    // Runtime errors: `TypeError: … (profile.js:2:7)`.
    let marker = format!("({SCRIPT_PATH}:");
    if let Some(i) = first.rfind(&marker) {
        let spot = &first[i + marker.len()..first.len().saturating_sub(1)];
        if let Some((line, column)) = spot.split_once(':') {
            if let (Ok(line), Ok(column)) = (line.parse(), column.parse()) {
                return ScriptError { message, at: Some(At(line, column)) };
            }
        }
    }
    // Syntax errors: `… at line 1, col 9`.
    if let Some(i) = first.rfind(" at line ") {
        let spot = &first[i + 9..];
        if let Some((line, column)) = spot.split_once(", col ") {
            let column: String = column.chars().take_while(char::is_ascii_digit).collect();
            if let (Ok(line), Ok(column)) = (line.trim().parse(), column.parse()) {
                let message = format!("SyntaxError: {}", first[..i].trim_start_matches("SyntaxError: "));
                return ScriptError { message, at: Some(At(line, column)) };
            }
        }
    }
    ScriptError { message, at: None }
}

/// Where `name` first appears as a whole word.
fn first_use(source: &str, name: &str) -> Option<At> {
    let word = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
    for (i, line) in source.lines().enumerate() {
        let mut from = 0;
        while let Some(j) = line[from..].find(name) {
            let start = from + j;
            let end = start + name.len();
            let before = line[..start].chars().next_back();
            let after = line[end..].chars().next();
            if !before.is_some_and(|c| word(c) || c == '.') && !after.is_some_and(word) {
                return Some(At(i as u32 + 1, line[..start].chars().count() as u32 + 1));
            }
            from = end;
        }
    }
    None
}

/// Every function the library defines, as `areas.union` or `draw`, sorted:
/// what `drawland.d.ts` must declare.
pub fn library_names() -> Result<Vec<String>, ScriptError> {
    BUILDER.with(|b| b.borrow_mut().push(Builder::default()));
    let mut ctx = Context::default();
    install(&mut ctx).map_err(|e| ScriptError { message: format!("library: {e}"), at: None })?;
    let listing = ctx
        .eval(Source::from_bytes(
            "JSON.stringify(['features','areas','engine','lines','fills','burin','ink','modules','draw','compose','output','title','view'].flatMap((n) =>              typeof globalThis[n] === 'function' ? [n] : [n, ...Object.keys(globalThis[n]).map((k) => n + '.' + k)]))",
        ))
        .and_then(|v| v.to_string(&mut ctx))
        .map_err(|e| ScriptError { message: e.to_string(), at: None })?
        .to_std_string_escaped();
    BUILDER.with(|b| b.borrow_mut().pop());
    let mut names: Vec<String> = serde_json::from_str(&listing).unwrap_or_default();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests;
