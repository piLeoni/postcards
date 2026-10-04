//! WebAssembly bindings for draw.land.
//!
//! The browser gets the pipeline after the download: the graph a profile
//! script built (as JSON, from the script module or a pre-run preset) plus the
//! Overpass JSON its query returned and the vector tiles it asked for, out
//! comes the SVG, with the same
//! progress events the command line draws in the terminal. Nothing here
//! touches the filesystem or the network, so the same `drawland-core` the CLI
//! uses runs unchanged in a page.
//!

use drawland_core::output::{
    overpass_error, overpass_slot_wait_s, overpass_status_url, Output, OVERPASS_ENDPOINTS, OVERPASS_ENDPOINT_TIMEOUT_S,
    OVERPASS_MAX_SLOT_WAIT_S, OVERPASS_ROUND_PAUSE_S,
};
use drawland_core::osm_cache;
use geo::MultiPolygon;
use drawland_core::grammar::Grammar;
use drawland_core::osm::{features_from_overpass, Feature};
use drawland_core::tiles::{self, Tiles, TILES};
use drawland_core::board::{Board, Line};
use drawland_core::progress::{thousands, Event, Level, Progress, Task};
use std::collections::BTreeMap;
use terramask::TileId;
use wasm_bindgen::prelude::*;

/// A rendered output: the SVG, plus how many strokes each group drew.
#[wasm_bindgen]
pub struct Rendered {
    svg: String,
    groups: js_sys::Array,
    slices: js_sys::Array,
}

#[wasm_bindgen]
impl Rendered {
    /// The output as an SVG string, in millimetres.
    #[wasm_bindgen(getter)]
    pub fn svg(&self) -> String {
        self.svg.clone()
    }

    /// `[["roads_main", 1234], …]` in draw order, for a legend or a check.
    #[wasm_bindgen(getter)]
    pub fn groups(&self) -> js_sys::Array {
        self.groups.clone()
    }

    /// `[["r1c1", svg], …]` when the output is cut into slices; empty otherwise.
    #[wasm_bindgen(getter)]
    pub fn slices(&self) -> js_sys::Array {
        self.slices.clone()
    }
}

/// What this graph and centre need from Overpass, as JSON: `{ need,
/// fetch, query }` (see `drawland_core::osm_cache::Request`). `need` is the
/// output's ground and keys, which a stored reply must cover; `fetch` the
/// padded ground `query` asks for, to store the reply under.
///
/// The centre comes from the graph's output unless `lat`/`lng` override it,
/// the same way `drawland map --lat --lng` does.
#[wasm_bindgen(js_name = osmRequest)]
pub fn osm_request(graph: &str, lat: Option<f64>, lng: Option<f64>) -> Result<String, JsValue> {
    let mut d = Doc::load(graph)?;
    if let Some(v) = lat {
        d.output.center.1 = v;
    }
    if let Some(v) = lng {
        d.output.center.0 = v;
    }
    serde_json::to_string(&osm_cache::request(&d.output, &d.keys)).map_err(err)
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

/// The output's centre and size, so the page can place the rectangle on the map.
/// `graph` may be just `{ "output": { … } }`.
///
/// Returns `{ lat, lng, width_mm, height_mm, scale, bearing, padding_x_mm,
/// padding_y_mm, columns, rows, gutter_x_mm, gutter_y_mm, projection }`, the
/// projection as
/// `webmercator`, `utm` or the PROJ string.
#[wasm_bindgen(js_name = outputInfo)]
pub fn output_info(graph: &str) -> Result<JsValue, JsValue> {
    use drawland_core::profile::ProjectionMode;
    let d = Doc::load(graph)?;
    let spec = d.spec();
    let o = js_sys::Object::new();
    let projection = match &spec.projection {
        ProjectionMode::Webmercator => "webmercator".to_string(),
        ProjectionMode::Utm => "utm".to_string(),
        ProjectionMode::Proj(s) => s.clone(),
    };
    js_sys::Reflect::set(&o, &"projection".into(), &JsValue::from_str(&projection)).ok();
    for (k, v) in [
        ("lat", d.output.center.1),
        ("lng", d.output.center.0),
        ("width_mm", d.output.width_mm),
        ("height_mm", d.output.height_mm),
        ("scale", d.output.scale),
        ("bearing", d.output.bearing),
        ("padding_x_mm", spec.padding.x),
        ("padding_y_mm", spec.padding.y),
        ("columns", spec.slices.columns.max(1) as f64),
        ("rows", spec.slices.rows.max(1) as f64),
        ("gutter_x_mm", spec.slices.gutter.x),
        ("gutter_y_mm", spec.slices.gutter.y),
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

/// The TileJSON of the vector tiles (`tiles_select` and the sea), the same
/// the command line reads.
#[wasm_bindgen(js_name = tileSource)]
pub fn tile_source() -> String {
    TILES.into()
}

/// One draw, in the steps the command line takes after locating the output:
/// `read` the Overpass reply when `needsOsm`, hand over the `tiles` it asks
/// for with `addTile` and `readTiles` them, then `draw`. Each tells
/// `on_event` what it is doing, as the same events the terminal shows: the
/// reads as rows under the page's `download`, `draw` as the drawing tree.
#[wasm_bindgen]
pub struct Job {
    doc: Doc,
    features: Option<Vec<Feature>>,
    /// Planned on the first `tiles` call, once Overpass has answered.
    tiles: Option<Option<Tiles>>,
    tile_features: Vec<Feature>,
    ocean: Option<MultiPolygon<f64>>,
    /// The elevation tiles handed over, then the grid they fold into; read
    /// only when a def draws terrain.
    elevation: Option<terramask::Elevation>,
    terrain: Option<drawland_core::terrain::Grid>,
}

#[wasm_bindgen]
impl Job {
    /// A draw of `graph`, its centre moved to `lat`/`lng` when given.
    #[wasm_bindgen(constructor)]
    pub fn new(graph: &str, lat: Option<f64>, lng: Option<f64>) -> Result<Job, JsValue> {
        let mut doc = Doc::load(graph)?;
        if let Some(v) = lat {
            doc.output.center.1 = v;
        }
        if let Some(v) = lng {
            doc.output.center.0 = v;
        }
        Ok(Job {
            doc,
            features: None,
            tiles: None,
            tile_features: Vec::new(),
            ocean: None,
            elevation: None,
            terrain: None,
        })
    }

    /// Whether the document selects anything from Overpass (`osm_select`, or
    /// a module reading OSM). When not, skip the query and `read`.
    #[wasm_bindgen(getter, js_name = needsOsm)]
    pub fn needs_osm(&self) -> bool {
        !self.doc.keys.is_empty()
    }

    /// Whether a def draws terrain: the page then asks for the elevation
    /// tiles (`terrainTiles` and `addTerrain`) and folds them in.
    #[wasm_bindgen(getter, js_name = needsTerrain)]
    pub fn needs_terrain(&self) -> bool {
        self.doc.terrain_defs()
    }

    /// The terrain tiles the output needs, as `[z, x, y, …]`, from
    /// `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`.
    /// Empty when no def draws terrain.
    #[wasm_bindgen(js_name = terrainTiles)]
    pub fn terrain_tiles(&mut self) -> Vec<u32> {
        if !self.doc.terrain_defs() {
            return Vec::new();
        }
        let bounds = drawland_core::terrain::bounds_of(&self.doc.output);
        let grid = terramask::Grid::with_width(bounds, drawland_core::terrain::WIDTH_PX);
        let z = grid.zoom(&terramask::ZoomLimits::default());
        terramask::tiles_for(&bounds, z).iter().flat_map(|t| [t.z as u32, t.x, t.y]).collect()
    }

    /// One elevation tile, as downloaded (a Terrarium PNG).
    #[wasm_bindgen(js_name = addTerrain)]
    pub fn add_terrain(&mut self, z: u8, x: u32, y: u32, bytes: &[u8]) -> Result<(), JsValue> {
        let mut e = self.elevation.take().unwrap_or_else(terramask::Elevation::new);
        e.add_tile(TileId::new(z, x, y), bytes).map_err(err)?;
        self.elevation = Some(e);
        Ok(())
    }

    /// Fold the elevation tiles into the grid, as the `terrain` row.
    #[wasm_bindgen(js_name = readTerrain)]
    pub fn read_terrain(&mut self, on_event: js_sys::Function) -> Result<(), JsValue> {
        if !self.doc.terrain_defs() {
            return Ok(());
        }
        let progress = JsProgress(on_event);
        let task = Task::begin(&progress, "terrain", Some("download"), "terrain", 0, "");
        let bounds = drawland_core::terrain::bounds_of(&self.doc.output);
        let width = drawland_core::terrain::WIDTH_PX;
        let grid = terramask::Grid::with_width(bounds, width);
        let e = self.elevation.take().ok_or_else(|| err("no elevation tiles were handed over"))?;
        let elev = e.on(&grid);
        let note = format!("zoom {} · {}×{} px", e.zoom(), grid.width, grid.height);
        self.terrain = Some(drawland_core::terrain::Grid::new(bounds, grid.merc, elev, width));
        task.ok(&note);
        Ok(())
    }

    /// Turn the Overpass reply into features, as the `read OSM` row.
    pub fn read(&mut self, overpass: &str, on_event: js_sys::Function) -> Result<(), JsValue> {
        let progress = JsProgress(on_event);
        let task = Task::begin(&progress, "read", Some("download"), "read OSM", 0, "");
        let keys: Vec<&str> = self.doc.keys.iter().map(String::as_str).collect();
        let features = features_from_overpass(overpass, &self.doc.output.query_polygon(), &keys).map_err(err)?;
        task.ok(&format!("{} features", thousands(features.len() as u64)));
        self.features = Some(features);
        Ok(())
    }

    /// The vector tiles the output needs, as `[z, x, y, z, x, y, …]`, for a
    /// source whose deepest zoom is `max_zoom` (the TileJSON's `maxzoom`):
    /// what `tiles_select` picks, and the sea when the output draws it (with
    /// Overpass, only where it shows a coastline). Empty when none. Their
    /// source is `tileSource()`.
    pub fn tiles(&mut self, max_zoom: u8) -> Result<Vec<u32>, JsValue> {
        let plan = self.plan()?;
        Ok(plan.map(|t| t.tiles(max_zoom).iter().flat_map(|t| [t.z as u32, t.x, t.y]).collect()).unwrap_or_default())
    }

    /// One of the `tiles`, as downloaded (raw or gzipped protobuf).
    #[wasm_bindgen(js_name = addTile)]
    pub fn add_tile(&mut self, z: u8, x: u32, y: u32, bytes: &[u8]) -> Result<(), JsValue> {
        let t = self.plan()?.ok_or_else(|| err("this output needs no tiles"))?;
        t.add_tile(TileId::new(z, x, y), bytes).map_err(err)
    }

    /// The tile features mended across tile edges, and the sea, as the `read
    /// tiles` row.
    #[wasm_bindgen(js_name = readTiles)]
    pub fn read_tiles(&mut self, on_event: js_sys::Function) -> Result<(), JsValue> {
        let Some(t) = self.plan()? else { return Ok(()) };
        let progress = JsProgress(on_event);
        let task = Task::begin(&progress, "read-tiles", Some("download"), "read tiles", 0, "");
        let features = t.features();
        let ocean = t.ocean();
        let found = format!("{} tile features", thousands(features.len() as u64));
        task.ok(&match &ocean {
            Some(sea) => format!("{found} · sea in {} polygons", sea.0.len()),
            None => found,
        });
        self.tile_features = features;
        self.ocean = ocean;
        Ok(())
    }

    fn plan(&mut self) -> Result<Option<&mut Tiles>, JsValue> {
        if self.tiles.is_none() {
            let d = &self.doc;
            self.tiles = Some(tiles::plan(&d.output, &d.selectors, d.ocean, self.features.as_deref()).map_err(err)?);
        }
        Ok(self.tiles.as_mut().and_then(Option::as_mut))
    }

    /// Draw the output, as the `draw` tree. `sources` maps the file names the
    /// document references to their SVG text; `{}` when it has none.
    pub fn draw(&mut self, sources: js_sys::Object, on_event: js_sys::Function) -> Result<Rendered, JsValue> {
        let features = match self.features.take() {
            Some(f) => f,
            None if self.needs_osm() => return Err(err("read the Overpass reply first")),
            None => Vec::new(),
        };
        let tile_features = std::mem::take(&mut self.tile_features);
        let ocean = self.ocean.take();
        let progress = JsProgress(on_event);
        let draw = Task::begin(&progress, "draw", None, "draw", 0, "");
        let terrain = self.terrain.take();
        let out = self.doc.render(features, tile_features, ocean, terrain, &string_map(&sources), &draw).map_err(err)?;
        draw.ok("");
        let groups = js_sys::Array::new();
        for (id, n) in out.groups {
            groups.push(&JsValue::from(js_sys::Array::of2(&JsValue::from_str(&id), &JsValue::from_f64(n as f64))));
        }
        let slices = js_sys::Array::new();
        for (name, svg) in out.slices {
            slices.push(&JsValue::from(js_sys::Array::of2(&JsValue::from_str(&name), &JsValue::from_str(&svg))));
        }
        Ok(Rendered { svg: out.svg, groups, slices })
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

/// A graph, ready to run.
struct Doc {
    output: Output,
    /// OSM keys to ask Overpass for; empty when it needs none.
    keys: Vec<String>,
    /// `tiles_select` items.
    selectors: Vec<String>,
    /// Whether it draws the sea.
    ocean: bool,
    body: Body,
}

enum Body {
    Grammar(Box<Grammar>),
}

struct Out {
    svg: String,
    groups: Vec<(String, usize)>,
    slices: Vec<(String, String)>,
}

impl Doc {
    fn load(text: &str) -> Result<Doc, JsValue> {
        let grammar = Grammar::from_json(text).map_err(err)?;
        let keys = grammar.osm_keys();
        let (selectors, ocean) = (grammar.tile_selectors(), grammar.draws_ocean());
        let output = Output::new(&grammar.output, default_center(&grammar.output));
        Ok(Doc { output, keys, selectors, ocean, body: Body::Grammar(Box::new(grammar)) })
    }

    /// Whether any def draws terrain: `lines.terrain`, or a burin document.
    fn terrain_defs(&self) -> bool {
        match &self.body {
            Body::Grammar(g) => g.draws_terrain(),
        }
    }

    /// The output as the graph carries it.
    fn spec(&self) -> &drawland_core::profile::OutputSpec {
        match &self.body {
            Body::Grammar(g) => &g.output,
        }
    }

    /// The drawing, its steps as rows under `draw`.
    fn render(
        &self,
        features: Vec<Feature>,
        tiles: Vec<Feature>,
        ocean: Option<MultiPolygon<f64>>,
        terrain: Option<drawland_core::terrain::Grid>,
        sources: &BTreeMap<String, String>,
        draw: &Task,
    ) -> Result<Out, String> {
        match &self.body {
            Body::Grammar(g) => {
                let out = drawland_core::grammar_run::run_with(
                    g,
                    &self.output,
                    drawland_core::grammar_run::Inputs { features, tiles, ocean, sources, terrain },
                    draw,
                )
                .map_err(|e| e.to_string())?;
                Ok(Out { svg: out.svg, groups: out.groups, slices: out.slices })
            }
        }
    }
}

fn default_center(map: &drawland_core::profile::OutputSpec) -> (f64, f64) {
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
