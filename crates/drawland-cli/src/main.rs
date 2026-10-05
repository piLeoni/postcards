//! `drawland map`: a profile and a place in, the layered map SVG out.

mod osm_http;
mod term;

use clap::{Parser, Subcommand};
use drawland_core::output::Output;
use drawland_core::grammar::Grammar;
use drawland_core::osm::{features_from_overpass, Feature};
use drawland_core::progress::{thousands, Event, Level, Progress, Task};
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

#[derive(Subcommand)]
enum Command {
    /// Build the map SVG for a place.
    Map {
        /// Profile: a script (.js), or a saved graph (.json).
        #[arg(default_value = "configs/postcard.js")]
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

/// The graph a profile builds: a script run, or a saved graph read back.
fn load(path: &Path) -> Result<Grammar, String> {
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
fn map(term: &Term, http: &osm_http::Http, profile_path: &Path, place: Place, out: &Path) -> Result<Vec<(String, usize)>, String> {
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
    map_v3(term, http, grammar, profile_path, place, out)
}

/// What a document reads: the OSM keys to ask Overpass for (none: no Overpass
/// at all), its `tiles_select` items, and whether it draws the sea.
struct Needs {
    keys: Vec<String>,
    tiles: Vec<String>,
    ocean: bool,
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
) -> Result<(Vec<Feature>, Vec<Feature>, Option<geo::MultiPolygon<f64>>, Option<drawland_core::terrain::Grid>), String> {
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
    let (tile_features, ocean) = match tiles::plan(output, &needs.tiles, needs.ocean, osm.as_deref())? {
        Some(t) => read_tiles(&download, t, &mut notes)?,
        None => (Vec::new(), None),
    };
    let terrain = read_terrain(&download, grammar, output)?;
    download.ok(&notes.join(" · "));
    Ok((osm.unwrap_or_default(), tile_features, ocean, terrain))
}

/// The elevation under the output, when a `tools_terrain` or `tools_burin` def
/// draws it. `None` when none does, so nothing is downloaded for a document
/// that never asks: the same rule as the vector tiles.
fn read_terrain(download: &Task, grammar: &Grammar, output: &Output) -> Result<Option<drawland_core::terrain::Grid>, String> {
    if !grammar.draws_terrain() {
        return Ok(None);
    }
    let width = drawland_core::terrain::WIDTH_PX;
    let bounds = drawland_core::terrain::bounds_of(output);
    let grid = terramask::Grid::with_width(bounds, width);
    let task = download.child("terrain", "terrain", 0, "tiles");
    let e = terramask::Fetcher::with_source(terramask::TERRARIUM)
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
) -> Result<(Vec<Feature>, Option<geo::MultiPolygon<f64>>), String> {
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
    let ocean = tiles.ocean();
    let found = format!("{} tile features", thousands(features.len() as u64));
    task.ok(&match &ocean {
        Some(sea) => format!("{found} · sea in {} polygons", sea.0.len()),
        None => found.clone(),
    });
    notes.push(format!("{n} tiles · {found}"));
    Ok((features, ocean))
}

/// Writes the SVG as the last row under `draw`, which ends with it; an output
/// cut into slices also writes each sheet next to it, `map_r1c2.svg`.
fn save(draw: Task, out: &Path, svg: &str, slices: &[(String, String)]) -> Result<(), String> {
    let task = draw.child("save", "save", 0, "");
    let write = |path: &Path, text: &str| std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()));
    write(out, svg)?;
    let stem = out.file_stem().and_then(|s| s.to_str()).unwrap_or("map");
    for (name, text) in slices {
        write(&out.with_file_name(format!("{stem}_{name}.svg")), text)?;
    }
    let cut = if slices.is_empty() { String::new() } else { format!(" + {} slices", slices.len()) };
    task.ok(&format!("{}{cut}", out.display()));
    draw.ok("");
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let Command::Map { profile, dump_graph, address, lat, lng, out, cache, offline, refresh } = cli.command;
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
    let term = Term::new();
    let http = osm_http::Http::new(cache, offline, refresh);
    let result = map(&term, &http, &profile, Place { address, lat, lng }, &out);
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
) -> Result<Vec<(String, usize)>, String> {
    let base = profile_path.parent().unwrap_or(Path::new("."));
    let mut sources = BTreeMap::new();
    for file in grammar.source_files() {
        let path = if Path::new(&file).is_absolute() { PathBuf::from(&file) } else { base.join(&file) };
        sources.insert(file, read(&path)?);
    }

    let download = Task::begin(term, "download", None, "download", 0, "");
    let center = locate(&download, http, place, grammar.output.address.clone(), (grammar.output.lat, grammar.output.lng))?;
    let output = Output::new(&grammar.output, center);
    let needs = Needs { keys: grammar.osm_keys(), tiles: grammar.tile_selectors(), ocean: grammar.draws_ocean() };
    // Terrain is read only when a def draws it: the same grid burin's own
    // front ends use, cached a tile at a time like everything else.
    let (features, tiles, ocean, terrain) = fetch(http, download, &output, &needs, &grammar)?;

    let draw = Task::begin(term, "draw", None, "draw", 0, "");
    let rendered = drawland_core::grammar_run::run_with(
        &grammar,
        &output,
        drawland_core::grammar_run::Inputs { features, tiles, ocean, sources: &sources, terrain, memory_budget: None },
        &draw,
    )
    .map_err(|e| e.to_string())?;
    save(draw, out, &rendered.svg, &rendered.slices)?;
    Ok(rendered.groups)
}
