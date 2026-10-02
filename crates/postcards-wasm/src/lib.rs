//! WebAssembly bindings for postcards.
//!
//! The browser gets the pipeline after the download: the card document plus
//! the Overpass JSON its query returned, out comes the SVG, with the same
//! progress events the command line draws in the terminal. Nothing here
//! touches the filesystem or the network, so the same `postcards-core` the CLI
//! uses runs unchanged in a page.
//!
//! A document is either the v3 grammar (`card:`, `$features`, `$areas`, `draw`,
//! `compose`) or the older profile (`map`, `layers`). `Grammar::parse` and
//! `Profile::parse` tell which by what the text contains, so the caller just
//! pastes what it has.

use postcards_core::card::{
    overpass_error, overpass_slot_wait_s, overpass_status_url, Card, OVERPASS_ENDPOINTS, OVERPASS_ENDPOINT_TIMEOUT_S,
    OVERPASS_MAX_SLOT_WAIT_S, OVERPASS_ROUND_PAUSE_S,
};
use postcards_core::osm_cache;
use geo::MultiPolygon;
use postcards_core::grammar::Grammar;
use postcards_core::ocean::{Ocean, TILES};
use postcards_core::osm::{features_from_overpass, needs_ocean, Feature};
use postcards_core::profile::{Format, Profile};
use postcards_core::board::{Board, Line};
use postcards_core::progress::{thousands, Event, Level, Progress, Task};
use std::collections::BTreeMap;
use terramask::TileId;
use wasm_bindgen::prelude::*;

/// A rendered card: the SVG, plus how many strokes each group drew.
#[wasm_bindgen]
pub struct Rendered {
    svg: String,
    groups: js_sys::Array,
}

#[wasm_bindgen]
impl Rendered {
    /// The card as an SVG string, in millimetres.
    #[wasm_bindgen(getter)]
    pub fn svg(&self) -> String {
        self.svg.clone()
    }

    /// `[["roads_main", 1234], …]` in draw order, for a legend or a check.
    #[wasm_bindgen(getter)]
    pub fn groups(&self) -> js_sys::Array {
        self.groups.clone()
    }
}

/// What this document and centre need from Overpass, as JSON: `{ need,
/// fetch, query }` (see `postcards_core::osm_cache::Request`). `need` is the
/// card's ground and keys, which a stored reply must cover; `fetch` the
/// padded ground `query` asks for, to store the reply under.
///
/// The centre comes from the document unless `lat`/`lng` override it, the same
/// way `postcards-rs map --lat --lng` does.
#[wasm_bindgen(js_name = osmRequest)]
pub fn osm_request(doc: &str, lat: Option<f64>, lng: Option<f64>) -> Result<String, JsValue> {
    let mut d = Doc::load(doc)?;
    if let Some(v) = lat {
        d.card.center.1 = v;
    }
    if let Some(v) = lng {
        d.card.center.0 = v;
    }
    serde_json::to_string(&osm_cache::request(&d.card, &d.keys)).map_err(err)
}

/// Which of the stored replies (`[{ bbox, keys, fetched, bytes }]`, JSON)
/// serves `need` (JSON), or -1: the same choice the command line makes.
/// `now` is Unix seconds.
#[wasm_bindgen(js_name = osmPick)]
pub fn osm_pick(entries: &str, need: &str, now: f64) -> Result<i32, JsValue> {
    let entries: Vec<osm_cache::Entry> = serde_json::from_str(entries).map_err(err)?;
    let need: osm_cache::Extent = serde_json::from_str(need).map_err(err)?;
    Ok(osm_cache::pick(&entries, &need, now as u64, Some(osm_cache::MAX_AGE_S)).map_or(-1, |i| i as i32))
}

/// Which stored replies to delete to stay within the browser's budget.
#[wasm_bindgen(js_name = osmEvict)]
pub fn osm_evict(entries: &str, now: f64) -> Result<Vec<u32>, JsValue> {
    let entries: Vec<osm_cache::Entry> = serde_json::from_str(entries).map_err(err)?;
    Ok(osm_cache::evict(&entries, osm_cache::BROWSER_BUDGET, now as u64).into_iter().map(|i| i as u32).collect())
}

/// The card's centre and size, so the page can place the rectangle on the map.
///
/// Returns `{ lat, lng, width_mm, height_mm, scale, bearing }`.
#[wasm_bindgen(js_name = cardInfo)]
pub fn card_info(doc: &str) -> Result<JsValue, JsValue> {
    let d = Doc::load(doc)?;
    let o = js_sys::Object::new();
    for (k, v) in [
        ("lat", d.card.center.1),
        ("lng", d.card.center.0),
        ("width_mm", d.card.width_mm),
        ("height_mm", d.card.height_mm),
        ("scale", d.card.scale),
        ("bearing", d.card.bearing),
    ] {
        js_sys::Reflect::set(&o, &JsValue::from_str(k), &JsValue::from_f64(v)).ok();
    }
    Ok(o.into())
}

/// How to ask Overpass, the same as the command line: `{ endpoints, pauses,
/// timeoutS, maxSlotWaitS }`, the servers in order, the seconds to wait
/// before each round of them, how long to wait for one to answer, and the
/// longest wait for a free slot after a 429 worth sitting through.
#[wasm_bindgen(js_name = overpassPolicy)]
pub fn overpass_policy() -> JsValue {
    let o = js_sys::Object::new();
    let endpoints: js_sys::Array = OVERPASS_ENDPOINTS.iter().map(|s| JsValue::from_str(s)).collect();
    let pauses: js_sys::Array = OVERPASS_ROUND_PAUSE_S.iter().map(|&s| JsValue::from_f64(s as f64)).collect();
    js_sys::Reflect::set(&o, &"endpoints".into(), &endpoints).ok();
    js_sys::Reflect::set(&o, &"pauses".into(), &pauses).ok();
    js_sys::Reflect::set(&o, &"timeoutS".into(), &JsValue::from_f64(OVERPASS_ENDPOINT_TIMEOUT_S as f64)).ok();
    js_sys::Reflect::set(&o, &"maxSlotWaitS".into(), &JsValue::from_f64(OVERPASS_MAX_SLOT_WAIT_S as f64)).ok();
    o.into()
}

/// The status page next to an Overpass `interpreter` URL.
#[wasm_bindgen(js_name = overpassStatusUrl)]
pub fn overpass_status_url_js(interpreter: &str) -> String {
    overpass_status_url(interpreter)
}

/// Seconds until a slot is free, from a status page; -1 when it does not say.
#[wasm_bindgen(js_name = overpassSlotWait)]
pub fn overpass_slot_wait_js(status: &str) -> f64 {
    overpass_slot_wait_s(status).map_or(-1.0, |s| s as f64)
}

/// The error inside a 200 reply cut short by Overpass, or `undefined`.
#[wasm_bindgen(js_name = overpassError)]
pub fn overpass_error_js(json: &str) -> Option<String> {
    overpass_error(json)
}

/// The TileJSON of the vector tiles the sea comes from, the same the command
/// line reads.
#[wasm_bindgen(js_name = oceanSource)]
pub fn ocean_source() -> String {
    TILES.into()
}

/// One draw, in the two steps the command line takes after the download:
/// `read` the Overpass reply, then `draw`. Each tells `on_event` what it is
/// doing, as the same events the terminal shows: `read` as a row under the
/// page's `download`, `draw` as the whole drawing tree.
#[wasm_bindgen]
pub struct Job {
    doc: Doc,
    features: Option<Vec<Feature>>,
    needs_ocean: bool,
    ocean: Option<Ocean>,
}

#[wasm_bindgen]
impl Job {
    /// A draw of `doc`, its centre moved to `lat`/`lng` when given.
    #[wasm_bindgen(constructor)]
    pub fn new(doc: &str, lat: Option<f64>, lng: Option<f64>) -> Result<Job, JsValue> {
        let mut doc = Doc::load(doc)?;
        if let Some(v) = lat {
            doc.card.center.1 = v;
        }
        if let Some(v) = lng {
            doc.card.center.0 = v;
        }
        Ok(Job { doc, features: None, needs_ocean: false, ocean: None })
    }

    /// Turn the Overpass reply into features, as the `read OSM` row.
    pub fn read(&mut self, overpass: &str, on_event: js_sys::Function) -> Result<(), JsValue> {
        let progress = JsProgress(on_event);
        let task = Task::begin(&progress, "read", Some("download"), "read OSM", 0, "");
        let keys: Vec<&str> = self.doc.keys.iter().map(String::as_str).collect();
        let features = features_from_overpass(overpass, &self.doc.card.query_polygon(), &keys).map_err(err)?;
        task.ok(&format!("{} features", thousands(features.len() as u64)));
        self.needs_ocean = needs_ocean(&features);
        self.features = Some(features);
        Ok(())
    }

    /// Whether the reply shows a coastline, so the card needs the sea: the
    /// page downloads `oceanTiles` and hands each to `addOceanTile`.
    #[wasm_bindgen(getter, js_name = needsOcean)]
    pub fn needs_ocean(&self) -> bool {
        self.needs_ocean
    }

    /// The vector tiles with the sea under the card, as `[z, x, y, z, x, y,
    /// …]`, for a source whose deepest zoom is `max_zoom` (the TileJSON's
    /// `maxzoom`). Their source is `oceanSource()`.
    #[wasm_bindgen(js_name = oceanTiles)]
    pub fn ocean_tiles(&mut self, max_zoom: u8) -> Vec<u32> {
        let ocean = self.ocean.get_or_insert_with(|| Ocean::new(&self.doc.card.query_polygon()));
        ocean.tiles(max_zoom).iter().flat_map(|t| [t.z as u32, t.x, t.y]).collect()
    }

    /// One of the `oceanTiles`, as downloaded (raw or gzipped protobuf).
    #[wasm_bindgen(js_name = addOceanTile)]
    pub fn add_ocean_tile(&mut self, z: u8, x: u32, y: u32, bytes: &[u8]) -> Result<(), JsValue> {
        let ocean = self.ocean.get_or_insert_with(|| Ocean::new(&self.doc.card.query_polygon()));
        ocean.add_tile(TileId::new(z, x, y), bytes).map_err(err)
    }

    /// Draw the card, as the `draw` tree. `sources` maps the file names the
    /// document references to their SVG text; `{}` when it has none.
    pub fn draw(&mut self, sources: js_sys::Object, on_event: js_sys::Function) -> Result<Rendered, JsValue> {
        let features = self.features.take().ok_or_else(|| err("read the Overpass reply first"))?;
        let ocean = self.ocean.take().map(|o| o.polygons());
        let progress = JsProgress(on_event);
        let draw = Task::begin(&progress, "draw", None, "draw", 0, "");
        let out = self.doc.render(features, ocean, &string_map(&sources), &draw).map_err(err)?;
        draw.ok("");
        let groups = js_sys::Array::new();
        for (id, n) in out.groups {
            groups.push(&JsValue::from(js_sys::Array::of2(&JsValue::from_str(&id), &JsValue::from_f64(n as f64))));
        }
        Ok(Rendered { svg: out.svg, groups })
    }
}

/// The progress tree, for the page to show: the core's own `Board`, so the
/// rows read exactly as they do in the terminal. Events go in as the plain
/// objects `Job` sends; lines come out as `{ tree, logs }`, each line a list
/// of `{ text, dim, bold }`. Times are the page's clock, in milliseconds.
#[wasm_bindgen(js_name = Board)]
pub struct JsBoard(Board);

#[wasm_bindgen(js_class = Board)]
impl JsBoard {
    #[wasm_bindgen(constructor)]
    pub fn new() -> JsBoard {
        JsBoard(Board::new())
    }

    pub fn apply(&mut self, event: &JsValue, now_ms: f64) {
        let get = |k: &str| js_sys::Reflect::get(event, &JsValue::from_str(k)).unwrap_or(JsValue::UNDEFINED);
        let text = |k: &str| get(k).as_string().unwrap_or_default();
        let num = |k: &str| get(k).as_f64().unwrap_or(0.0).max(0.0) as u64;
        let (id, note, label, unit, parent) = (text("id"), text("note"), text("label"), text("unit"), get("parent").as_string());
        let level = match text("level").as_str() {
            "warn" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Info,
        };
        let log = text("text");
        let event = match text("kind").as_str() {
            "begin" => Event::Begin { id: &id, parent: parent.as_deref(), label: &label, total: num("total"), unit: &unit },
            "total" => Event::Total { id: &id, total: num("total") },
            "step" => Event::Step { id: &id, done: num("done"), note: &note },
            "end" => Event::End { id: &id, ok: get("ok").is_truthy(), note: &note },
            "log" => Event::Log { level, text: &log },
            _ => return,
        };
        self.0.apply(event, now_ms / 1000.0);
    }

    #[wasm_bindgen(js_name = failRunning)]
    pub fn fail_running(&mut self, now_ms: f64) {
        self.0.fail_running(now_ms / 1000.0);
    }

    pub fn running(&self) -> bool {
        self.0.running()
    }

    pub fn layout(&self, now_ms: f64) -> JsValue {
        let lines = |lines: Vec<Line>| -> js_sys::Array {
            lines
                .into_iter()
                .map(|line| {
                    line.into_iter()
                        .map(|run| {
                            let o = js_sys::Object::new();
                            js_sys::Reflect::set(&o, &"text".into(), &run.text.into()).ok();
                            js_sys::Reflect::set(&o, &"dim".into(), &run.dim.into()).ok();
                            js_sys::Reflect::set(&o, &"bold".into(), &run.bold.into()).ok();
                            JsValue::from(o)
                        })
                        .collect::<js_sys::Array>()
                })
                .collect()
        };
        let layout = self.0.layout(now_ms / 1000.0);
        let o = js_sys::Object::new();
        js_sys::Reflect::set(&o, &"tree".into(), &lines(layout.tree)).ok();
        js_sys::Reflect::set(&o, &"logs".into(), &lines(layout.logs)).ok();
        o.into()
    }
}

impl Default for JsBoard {
    fn default() -> Self {
        JsBoard::new()
    }
}

/// Progress events handed to a JS function as plain objects:
/// `{ kind: 'begin', id, parent, label, total, unit }`, `{ kind: 'total', id,
/// total }`, `{ kind: 'step', id, done, note }`, `{ kind: 'end', id, ok, note }`,
/// `{ kind: 'log', level, text }`.
struct JsProgress(js_sys::Function);

// A page's WASM runs on one thread: nothing reaches the function from another.
unsafe impl Sync for JsProgress {}

impl Progress for JsProgress {
    fn event(&self, event: Event) {
        let o = js_sys::Object::new();
        let set = |k: &str, v: JsValue| {
            js_sys::Reflect::set(&o, &JsValue::from_str(k), &v).ok();
        };
        let num = |n: u64| JsValue::from_f64(n as f64);
        match event {
            Event::Begin { id, parent, label, total, unit } => {
                set("kind", "begin".into());
                set("id", id.into());
                set("parent", parent.map_or(JsValue::NULL, JsValue::from_str));
                set("label", label.into());
                set("total", num(total));
                set("unit", unit.into());
            }
            Event::Total { id, total } => {
                set("kind", "total".into());
                set("id", id.into());
                set("total", num(total));
            }
            Event::Step { id, done, note } => {
                set("kind", "step".into());
                set("id", id.into());
                set("done", num(done));
                set("note", note.into());
            }
            Event::End { id, ok, note } => {
                set("kind", "end".into());
                set("id", id.into());
                set("ok", ok.into());
                set("note", note.into());
            }
            Event::Log { level, text } => {
                set("kind", "log".into());
                set("level", level.as_str().into());
                set("text", text.into());
            }
        }
        let _ = self.0.call1(&JsValue::NULL, &o);
    }
}

/// A document in either schema, ready to run.
struct Doc {
    card: Card,
    keys: Vec<String>,
    body: Body,
}

enum Body {
    Grammar(Box<Grammar>),
    Profile(Box<Profile>),
}

struct Out {
    svg: String,
    groups: Vec<(String, usize)>,
}

impl Doc {
    fn load(text: &str) -> Result<Doc, JsValue> {
        // The v3 grammar has `card:` at the top; the older profile has `map:`.
        let is_grammar = text.lines().any(|l| l.trim_start().starts_with("card:"));
        let format = Format::Yaml;
        if is_grammar {
            let grammar = Grammar::parse(text, format).map_err(err)?;
            let keys = grammar.osm_keys();
            let card = Card::new(&grammar.card, default_center(&grammar.card));
            return Ok(Doc { card, keys, body: Body::Grammar(Box::new(grammar)) });
        }
        let profile = Profile::parse(text, format).map_err(err)?;
        let keys = profile.osm_keys();
        let card = Card::new(&profile.map, default_center(&profile.map));
        Ok(Doc { card, keys, body: Body::Profile(Box::new(profile)) })
    }

    /// The drawing, its steps as rows under `draw`.
    fn render(
        &self,
        features: Vec<Feature>,
        ocean: Option<MultiPolygon<f64>>,
        sources: &BTreeMap<String, String>,
        draw: &Task,
    ) -> Result<Out, String> {
        match &self.body {
            Body::Grammar(g) => {
                let out = postcards_core::grammar_run::run_with(
                    g,
                    &self.card,
                    postcards_core::grammar_run::Inputs { features, ocean, sources },
                    draw,
                )
                .map_err(|e| e.to_string())?;
                Ok(Out { svg: out.svg, groups: out.groups })
            }
            Body::Profile(p) => {
                let task = draw.child("render", "render", 0, "");
                let out = postcards_core::pipeline::render(
                    p,
                    &self.card,
                    postcards_core::pipeline::Inputs { features, ocean, sources },
                )
                .map_err(|e| e.to_string())?;
                task.ok(&format!("{} groups", out.groups.len()));
                Ok(Out { svg: out.svg, groups: out.groups })
            }
        }
    }
}

fn default_center(map: &postcards_core::profile::MapSpec) -> (f64, f64) {
    (map.lng.unwrap_or(0.0), map.lat.unwrap_or(0.0))
}

fn string_map(o: &js_sys::Object) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for key in js_sys::Object::keys(o).iter() {
        let (Some(k), Ok(v)) = (key.as_string(), js_sys::Reflect::get(o, &key)) else {
            continue;
        };
        if let Some(text) = v.as_string() {
            out.insert(k, text);
        }
    }
    out
}

fn err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
