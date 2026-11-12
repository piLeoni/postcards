//! `drawland map`: a profile and a place in, the layered map SVG out.

mod google_fonts;
mod stroke_fonts;
mod osm_http;
mod term;

use clap::{Parser, Subcommand, ValueEnum};
use drawland_core::output::Output;
use drawland_core::grammar::Grammar;
use drawland_core::osm::{features_from_overpass, Feature};
use drawland_core::progress::{thousands, Event, Level, Progress, Task};
use drawland_core::sheets::{ExportOptions, SliceExport, export_svg_files};
use drawland_core::tiles::{self, Tiles};
use std::collections::BTreeMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use term::Term;

#[derive(Parser)]
#[command(name = "drawland", about = "draw.land: maps drawn for pen plotters")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum SlicesArg {
    /// Only the whole composed output.
    Whole,
    /// Only the cut sheets (`r1c1`, …).
    Slices,
    /// Whole output plus each cut sheet (default).
    #[default]
    Both,
}

impl From<SlicesArg> for SliceExport {
    fn from(v: SlicesArg) -> Self {
        match v {
            SlicesArg::Whole => SliceExport::Whole,
            SlicesArg::Slices => SliceExport::Slices,
            SlicesArg::Both => SliceExport::Both,
        }
    }
}

#[derive(Subcommand)]
enum Command {
    /// Build the map SVG for a place.
    Map {
        /// Profile: a script (.js), a saved graph (.json), or a built-in
        /// preset by name (`city-grain`, `napkin-sketch`, `karl-the-fog`…).
        #[arg(default_value = "city-grain")]
        profile: PathBuf,
        /// Print the graph the profile builds, as JSON, and stop.
        #[arg(long)]
        dump_graph: bool,
        /// Street address, looked up with Nominatim. Overrides the profile.
        #[arg(long, conflicts_with_all = ["lat", "lng"])]
        address: Option<String>,
        #[arg(long, requires = "lng", allow_hyphen_values = true)]
        lat: Option<f64>,
        #[arg(long, requires = "lat", allow_hyphen_values = true)]
        lng: Option<f64>,
        #[arg(long = "output", short, default_value = "map.svg")]
        out: PathBuf,
        /// Coordinate decimal places in SVG output (0..6); default is full (4).
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=6))]
        decimals: Option<u8>,
        /// Write one SVG file per top-level layer (`<stem>-<layer>.svg`).
        #[arg(long)]
        per_layer: bool,
        /// Which files to write when the output is cut into slices.
        #[arg(long, value_enum, default_value_t = SlicesArg::Both)]
        slices: SlicesArg,
        /// Response cache: Overpass replies and Nominatim lookups.
        #[arg(long, default_value = "cache")]
        cache: PathBuf,
        /// Use only cached responses; never touch the network for OSM data.
        #[arg(long)]
        offline: bool,
        /// Download again even when the reply is cached.
        #[arg(long, conflicts_with = "offline")]
        refresh: bool,
    },
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Where the output goes: the command line, then the profile's own place.
fn locate(
    download: &Task,
    http: &osm_http::Http,
    place: Place,
    profile_address: Option<String>,
    profile_spot: (Option<f64>, Option<f64>),
) -> Result<(f64, f64), String> {
    let center = match (place.address.or(profile_address), place.lat, place.lng) {
        (_, Some(lat), Some(lng)) => (lng, lat),
        (Some(address), _, _) => {
            let task = download.child("geocode", "geocode", 0, "bytes");
            task.note(&address);
            let center = http.geocode(&address)?;
            task.ok(&address);
            center
        }
        (None, _, _) => match profile_spot {
            (Some(lat), Some(lng)) => (lng, lat),
            _ => return Err("no location: pass --address or --lat/--lng, or set the profile's address or lat/lng".into()),
        },
    };
    download.log(Level::Info, &format!("centre {:.7}, {:.7}", center.1, center.0));
    Ok(center)
}

struct Place {
    address: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
}

/// The graph a profile builds: a script run, a saved graph read back, or a
/// built-in preset named instead of a file.
fn load(path: &Path) -> Result<Grammar, String> {
    if !path.exists() {
        if let Some(source) = path.to_str().and_then(drawland_script::preset) {
            return drawland_script::evaluate(source).map_err(|e| format!("{}: {e}", path.display()));
        }
        if path.extension().is_none() && path.components().count() == 1 {
            return Err(format!(
                "{}: no such file, and no built-in preset by that name ({})",
                path.display(),
                drawland_script::preset_ids().join(", ")
            ));
        }
    }
    let text = read(path)?;
    let name = path.to_string_lossy().to_ascii_lowercase();
    let located = |e: String| format!("{}: {e}", path.display());
    if name.ends_with(".json") {
        Grammar::from_json(&text).map_err(|e| located(e.to_string()))
    } else {
        drawland_script::evaluate(&text).map_err(|e| located(e.to_string()))
    }
}

/// The map for `profile_path`; the stroke count of every group drawn.
fn map(term: &Term, http: &osm_http::Http, profile_path: &Path, place: Place, out: &Path, export: ExportOptions) -> Result<Vec<(String, usize)>, String> {
    let task = Task::begin(term, "script", None, "script", 0, "");
    task.note(&profile_path.display().to_string());
    let grammar = match load(profile_path) {
        Ok(g) => g,
        Err(e) => {
            task.fail(&e);
            return Err(e);
        }
    };
    let nodes: usize = grammar.sections.iter().map(|(_, d)| d.len()).sum();
    task.ok(&format!("{nodes} nodes · {} draws", grammar.draw.len()));
    map_v3(term, http, grammar, profile_path, place, out, export)
}

/// What a document reads: the OSM keys to ask Overpass for (none: no Overpass
/// at all), its `tiles_select` items, and whether it draws the sea.
struct Needs {
    keys: Vec<String>,
    tiles: Vec<String>,
}

/// What the download brings, in lon/lat.
/// The OSM features on `output`, the vector tile features, and the sea when the
/// output shows one: each a row under `download`, which ends with them.
fn fetch(
    http: &osm_http::Http,
    download: Task,
    output: &Output,
    needs: &Needs,
    grammar: &Grammar,
) -> Result<(Vec<Feature>, Vec<Feature>, Option<drawland_core::terrain::Grid>), String> {
    let area = output.query_polygon();
    let mut notes: Vec<String> = Vec::new();
    let osm = if needs.keys.is_empty() {
        None
    } else {
        let json = http.overpass(output, &needs.keys, &download)?;
        let task = download.child("read", "read OSM", 0, "");
        let keys: Vec<&str> = needs.keys.iter().map(String::as_str).collect();
        let features = features_from_overpass(&json, &area, &keys).map_err(|e| e.to_string())?;
        let found = format!("{} features", thousands(features.len() as u64));
        task.ok(&found);
        notes.push(format!("{:.1} MB · {found}", json.len() as f64 / 1e6));
        Some(features)
    };
    let tile_features = match tiles::plan(output, &needs.tiles, osm.as_deref())? {
        Some(t) => read_tiles(&download, t, &mut notes)?,
        None => Vec::new(),
    };
    let terrain = read_terrain(&download, grammar, output)?;
    download.ok(&notes.join(" · "));
    Ok((osm.unwrap_or_default(), tile_features, terrain))
}

/// The elevation under the output, when a `tools_terrain` or `tools_burin` def
/// draws it. `None` when none does, so nothing is downloaded for a document
/// that never asks: the same rule as the vector tiles.
fn read_terrain(download: &Task, grammar: &Grammar, output: &Output) -> Result<Option<drawland_core::terrain::Grid>, String> {
    if !grammar.draws_terrain() {
        return Ok(None);
    }
    let width = drawland_core::terrain::width_px(output);
    let bounds = drawland_core::terrain::bounds_of(output);
    let grid = terramask::Grid::with_width(bounds, width);
    let task = download.child("terrain", "terrain", 0, "tiles");
    // Read terrain as deep as the web page does (`ZoomLimits::default()`, no
    // cap at Terrarium's zoom 10), so a coast traced from it is as fine.
    let mut fetcher = terramask::Fetcher::with_source(terramask::TERRARIUM);
    fetcher.elevation_max_zoom = terramask::TERRARIUM_MAX_ZOOM;
    let e = fetcher
        .elevation_for(&grid, &terramask::ZoomLimits::default(), |done, total| {
            if done == 1 {
                task.set_total(total as u64);
            }
            task.step(done as u64, "");
        })
        .map_err(|e| format!("terrain: {e}"))?;
    let elev = e.on(&grid);
    task.ok(&format!("zoom {} · {}×{} px", e.zoom(), grid.width, grid.height));
    Ok(Some(drawland_core::terrain::Grid::new(bounds, grid.merc, elev, width)))
}

/// OpenFreeMap's vector tiles under the output (cached by terramask, a file
/// per layer), as the `vector tiles` row; then the features mended across
/// tile edges, as `read tiles`.
fn read_tiles(
    download: &Task,
    mut tiles: Tiles,
    notes: &mut Vec<String>,
) -> Result<Vec<Feature>, String> {
    let ids = tiles.tiles(terramask::MAX_ZOOM);
    let n = ids.len() as u64;
    let task = download.child("tiles", "vector tiles", n, "tiles");
    let (plan, warn) = tiles.note(terramask::MAX_ZOOM);
    if warn {
        task.log(Level::Warn, &plan);
    }
    let found = terramask::Fetcher::with_source(tiles::TILES)
        .features_of(&ids, tiles.filter(), |done, total| {
            if done == 1 {
                task.set_total(total as u64);
            }
            task.step(done as u64, "");
        })
        .map_err(|e| format!("vector tiles: {e}"))?;
    tiles.add_features(found);
    task.ok(&format!("zoom {} · {}", tiles.zoom(terramask::MAX_ZOOM), tiles.filter().layers().join(", ")));

    let task = download.child("read-tiles", "read tiles", 0, "");
    let features = tiles.features();
    let found = format!("{} tile features", thousands(features.len() as u64));
    let ocean_n = features.iter().filter(|f| f.tag("class") == Some("ocean")).count();
    task.ok(&if ocean_n > 0 {
        format!("{found} · {ocean_n} ocean polygons")
    } else {
        found.clone()
    });
    notes.push(format!("{n} tiles · {found}"));
    Ok(features)
}

/// Writes the SVG files according to `export` as the last row under `draw`.
fn save(draw: Task, out: &Path, svg: &str, slices: &[(String, String)], export: ExportOptions) -> Result<(), String> {
    let task = draw.child("save", "save", 0, "");
    let write = |path: &Path, text: &str| std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()));
    let stem = out.file_stem().and_then(|s| s.to_str()).unwrap_or("map");
    let ext = out.extension().and_then(|s| s.to_str()).unwrap_or("svg");
    let files = export_svg_files(svg, slices, export);
    for (suffix, text) in &files {
        if suffix.is_empty() {
            write(out, text)?;
        } else {
            write(&out.with_file_name(format!("{stem}{suffix}.{ext}")), text)?;
        }
    }
    let extra = files.len().saturating_sub(1);
    let note = if extra == 0 {
        out.display().to_string()
    } else {
        format!("{} + {extra} files", out.display())
    };
    task.ok(&note);
    draw.ok("");
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let Command::Map {
        profile,
        dump_graph,
        address,
        lat,
        lng,
        out,
        decimals,
        per_layer,
        slices,
        cache,
        offline,
        refresh,
    } = cli.command;
    if dump_graph {
        return match load(&profile) {
            Ok(g) => {
                println!("{}", serde_json::to_string_pretty(&g.to_json()).unwrap_or_default());
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("{e}");
                ExitCode::FAILURE
            }
        };
    }
    let export = ExportOptions {
        decimals,
        per_layer,
        slices: slices.into(),
    };
    let term = Term::new();
    let http = osm_http::Http::new(cache, offline, refresh);
    let result = map(&term, &http, &profile, Place { address, lat, lng }, &out, export);
    if let Err(e) = &result {
        term.event(Event::Log { level: Level::Error, text: e });
    }
    term.finish();
    match result {
        Ok(_) => {
            // The file's path for scripts; on a terminal the save row says it.
            if !std::io::stdout().is_terminal() {
                println!("{}", out.display());
            }
            ExitCode::SUCCESS
        }
        Err(_) => ExitCode::FAILURE,
    }
}

/// The v3 path: `Grammar` in, Overpass and the vector tiles as it asks, the
/// grammar executor out.
fn map_v3(
    term: &Term,
    http: &osm_http::Http,
    grammar: Grammar,
    profile_path: &Path,
    place: Place,
    out: &Path,
    export: ExportOptions,
) -> Result<Vec<(String, usize)>, String> {
    let base = profile_path.parent().unwrap_or(Path::new("."));
    // A page of views needs no place of its own; each view has one.
    let placeless = !grammar.views.is_empty()
        && place.address.is_none()
        && place.lat.is_none()
        && grammar.output.address.is_none()
        && grammar.output.lat.is_none();
    let center = if placeless {
        (0.0, 0.0)
    } else {
        let task = Task::begin(term, "locate", None, "locate", 0, "");
        let c = locate(&task, http, place, grammar.output.address.clone(), (grammar.output.lat, grammar.output.lng))?;
        task.ok("");
        c
    };
    let output = Output::new(&grammar.output, center);
    let page = gather(term, http, &grammar, &output, base, "")?;
    let mut views = Vec::new();
    for v in &grammar.views {
        let view_output = Output::new(&v.grammar.output, v.center());
        views.push(gather(term, http, &v.grammar, &view_output, base, &format!(" {}", v.id))?);
    }

    let draw = Task::begin(term, "draw", None, "draw", 0, "");
    let mut inputs = page.inputs();
    inputs.views = views.iter().map(Gathered::inputs).collect();
    let rendered = drawland_core::grammar_run::run_with(&grammar, &output, inputs, &draw).map_err(|e| e.to_string())?;
    save(draw, out, &rendered.svg, &rendered.slices, export)?;
    Ok(rendered.groups)
}

/// Everything one graph reads, downloaded: what its `Inputs` are made of.
struct Gathered {
    features: Vec<Feature>,
    tiles: Vec<Feature>,
    terrain: Option<drawland_core::terrain::Grid>,
    sources: BTreeMap<String, String>,
    google_fonts: BTreeMap<String, Vec<u8>>,
    stroke_fonts: BTreeMap<String, Vec<u8>>,
    data: BTreeMap<String, String>,
}

impl Gathered {
    fn inputs(&self) -> drawland_core::grammar_run::Inputs<'_> {
        drawland_core::grammar_run::Inputs {
            features: self.features.clone(),
            tiles: self.tiles.clone(),
            sources: &self.sources,
            terrain: self.terrain.clone(),
            memory_budget: None,
            google_fonts: self.google_fonts.clone(),
            stroke_fonts: self.stroke_fonts.clone(),
            data: self.data.clone(),
            views: Vec::new(),
        }
    }
}

/// What `grammar` reads at `output`: Overpass and the vector tiles as it
/// asks, the terrain when it draws it, its fonts, datasets and SVG sources.
/// `label` tells the rows of one view from another's.
fn gather(term: &Term, http: &osm_http::Http, grammar: &Grammar, output: &Output, base: &Path, label: &str) -> Result<Gathered, String> {
    let mut sources = BTreeMap::new();
    for file in grammar.source_files() {
        let path = if Path::new(&file).is_absolute() { PathBuf::from(&file) } else { base.join(&file) };
        sources.insert(file, read(&path)?);
    }
    let id = format!("download{}", label.replace(' ', ":"));
    let download = Task::begin(term, &id, None, &format!("download{label}"), 0, "");
    download.log(Level::Info, &format!("centre {:.7}, {:.7}", output.center.1, output.center.0));
    let needs = Needs { keys: grammar.osm_keys(), tiles: grammar.tile_selectors() };
    // Terrain is read only when a def draws it: the same grid burin's own
    // front ends use, cached a tile at a time like everything else.
    let (features, tiles, terrain) = fetch(http, download, output, &needs, grammar)?;
    let data = read_datasets(term, http, grammar, base)?;
    let mut google_fonts = BTreeMap::new();
    for key in drawland_core::labels::google_font_keys_in_grammar(grammar) {
        google_fonts.insert(key.clone(), google_fonts::fetch(&key)?);
    }
    let mut stroke_fonts = BTreeMap::new();
    for key in drawland_core::labels::stroke_font_keys_in_grammar(grammar) {
        stroke_fonts.insert(key.clone(), stroke_fonts::fetch(&key)?);
    }
    Ok(Gathered { features, tiles, terrain, sources, google_fonts, stroke_fonts, data })
}

/// The GeoJSON of every `features.geojson` source: a URL downloaded (and
/// cached), anything else a file read beside the profile.
fn read_datasets(term: &Term, http: &osm_http::Http, grammar: &Grammar, base: &Path) -> Result<BTreeMap<String, String>, String> {
    let sources = grammar.datasets();
    let mut out = BTreeMap::new();
    if sources.is_empty() {
        return Ok(out);
    }
    let all = Task::begin(term, "data", None, "datasets", 0, "");
    for (i, src) in sources.iter().enumerate() {
        let task = all.child(&format!("data-{i}"), &short(src), 0, "");
        let text = if src.starts_with("http://") || src.starts_with("https://") {
            http.dataset(src)
        } else {
            let file = src.strip_prefix("file://").unwrap_or(src);
            let path = if Path::new(file).is_absolute() { PathBuf::from(file) } else { base.join(file) };
            read(&path).map(|t| {
                let note = format!("{:.1} MB · {}", t.len() as f64 / 1e6, path.display());
                (t, note)
            })
        };
        match text {
            Ok((t, note)) => {
                task.ok(&note);
                out.insert(src.clone(), t);
            }
            Err(e) => {
                task.fail(&e);
                return Err(e);
            }
        }
    }
    all.ok(&format!("{} datasets", sources.len()));
    Ok(out)
}

/// A source's last path segment, for its row.
fn short(src: &str) -> String {
    src.trim_end_matches('/').rsplit('/').next().unwrap_or(src).to_string()
}
