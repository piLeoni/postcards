//! `postcards-rs map`: a profile and a place in, the layered map SVG out.

mod osm_http;
mod term;

use clap::{Parser, Subcommand};
use postcards_core::card::{fetch_keys, Card};
use postcards_core::grammar::Grammar;
use postcards_core::osm::{features_from_overpass, Feature};
use postcards_core::pipeline::{render, Inputs};
use postcards_core::profile::{Format, Profile};
use postcards_core::progress::{thousands, Event, Level, Progress, Task};
use postcards_core::tiles::{self, Tiles};
use std::collections::BTreeMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use term::Term;

#[derive(Parser)]
#[command(name = "postcards-rs", about = "Postcard maps for pen plotters")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build the map SVG for a place.
    Map {
        /// Profile (YAML, or JSON5 for .json5/.json).
        #[arg(long, default_value = "configs/postcard.yaml")]
        profile: PathBuf,
        /// Street address, looked up with Nominatim. Overrides the profile.
        #[arg(long, conflicts_with_all = ["lat", "lng"])]
        address: Option<String>,
        #[arg(long, requires = "lng", allow_hyphen_values = true)]
        lat: Option<f64>,
        #[arg(long, requires = "lat", allow_hyphen_values = true)]
        lng: Option<f64>,
        #[arg(long, short, default_value = "map.svg")]
        output: PathBuf,
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

/// Where the card goes: the command line, then the profile's own place.
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

/// The map for `profile_path`; the stroke count of every group drawn.
fn map(term: &Term, http: &osm_http::Http, profile_path: &Path, place: Place, output: &Path) -> Result<Vec<(String, usize)>, String> {
    let text = read(profile_path)?;
    let format = Format::from_path(&profile_path.to_string_lossy());

    // Two profile schemas share this command: v3 (`card:`, `$areas:`, …) and
    // the older `map:`/`layers:`. The v3 one is tried first, by its own first
    // key, then the file is loaded as whichever it is.
    let is_v3 = text.lines().any(|l| l.trim_start().starts_with("card:") || l.trim_start().starts_with("$features:"));
    if is_v3 {
        return map_v3(term, http, &text, format, profile_path, place, output);
    }

    let profile = Profile::parse(&text, format)
        .map_err(|e| format!("{}: {e}", profile_path.display()))?;

    let base = profile_path.parent().unwrap_or(Path::new("."));
    let mut sources = BTreeMap::new();
    for file in profile.source_files() {
        let path = if Path::new(&file).is_absolute() { PathBuf::from(&file) } else { base.join(&file) };
        sources.insert(file, read(&path)?);
    }

    let download = Task::begin(term, "download", None, "download", 0, "");
    let center = locate(&download, http, place, profile.map.address.clone(), (profile.map.lat, profile.map.lng))?;
    let card = Card::new(&profile.map, center);
    let needs = Needs { keys: fetch_keys(&profile.osm_keys()), tiles: Vec::new(), ocean: true };
    let Fetched { osm: features, ocean, .. } = fetch(http, download, &card, &needs)?;

    let draw = Task::begin(term, "draw", None, "draw", 0, "");
    let task = draw.child("render", "render", 0, "");
    let rendered = render(&profile, &card, Inputs { features, ocean, sources: &sources }).map_err(|e| e.to_string())?;
    task.ok(&format!("{} groups", rendered.groups.len()));
    save(draw, output, &rendered.svg, &rendered.slices)?;
    Ok(rendered.groups)
}

/// What a document reads: the OSM keys to ask Overpass for (none: no Overpass
/// at all), its `tiles_select` items, and whether it draws the sea.
struct Needs {
    keys: Vec<String>,
    tiles: Vec<String>,
    ocean: bool,
}

/// What the download brings, in lon/lat.
struct Fetched {
    osm: Vec<Feature>,
    tiles: Vec<Feature>,
    /// The sea, when the card draws it and shows some.
    ocean: Option<geo::MultiPolygon<f64>>,
}

/// The OSM features on `card`, the vector tile features, and the sea when the
/// card shows one: each a row under `download`, which ends with them.
fn fetch(http: &osm_http::Http, download: Task, card: &Card, needs: &Needs) -> Result<Fetched, String> {
    let area = card.query_polygon();
    let mut notes: Vec<String> = Vec::new();
    let osm = if needs.keys.is_empty() {
        None
    } else {
        let json = http.overpass(card, &needs.keys, &download)?;
        let task = download.child("read", "read OSM", 0, "");
        let keys: Vec<&str> = needs.keys.iter().map(String::as_str).collect();
        let features = features_from_overpass(&json, &area, &keys).map_err(|e| e.to_string())?;
        let found = format!("{} features", thousands(features.len() as u64));
        task.ok(&found);
        notes.push(format!("{:.1} MB · {found}", json.len() as f64 / 1e6));
        Some(features)
    };
    let (tile_features, ocean) = match tiles::plan(card, &needs.tiles, needs.ocean, osm.as_deref())? {
        Some(t) => read_tiles(&download, t, &mut notes)?,
        None => (Vec::new(), None),
    };
    download.ok(&notes.join(" · "));
    Ok(Fetched { osm: osm.unwrap_or_default(), tiles: tile_features, ocean })
}

/// OpenFreeMap's vector tiles under the card (cached by terramask, a file
/// per layer), as the `vector tiles` row; then the features mended across
/// tile edges, as `read tiles`.
fn read_tiles(
    download: &Task,
    mut tiles: Tiles,
    notes: &mut Vec<String>,
) -> Result<(Vec<Feature>, Option<geo::MultiPolygon<f64>>), String> {
    let n = tiles.tiles(terramask::MAX_ZOOM).len() as u64;
    let task = download.child("tiles", "vector tiles", n, "tiles");
    let found = terramask::Fetcher::with_source(tiles::TILES)
        .water(tiles.bounds(), tiles.zoom(terramask::MAX_ZOOM), tiles.filter(), |done, total| {
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

/// Writes the SVG as the last row under `draw`, which ends with it; a card
/// cut into slices also writes each sheet next to it, `map_r1c2.svg`.
fn save(draw: Task, output: &Path, svg: &str, slices: &[(String, String)]) -> Result<(), String> {
    let task = draw.child("save", "save", 0, "");
    let write = |path: &Path, text: &str| std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()));
    write(output, svg)?;
    let stem = output.file_stem().and_then(|s| s.to_str()).unwrap_or("map");
    for (name, text) in slices {
        write(&output.with_file_name(format!("{stem}_{name}.svg")), text)?;
    }
    let cut = if slices.is_empty() { String::new() } else { format!(" + {} slices", slices.len()) };
    task.ok(&format!("{}{cut}", output.display()));
    draw.ok("");
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let Command::Map { profile, address, lat, lng, output, cache, offline, refresh } = cli.command;
    let term = Term::new();
    let http = osm_http::Http::new(cache, offline, refresh);
    let result = map(&term, &http, &profile, Place { address, lat, lng }, &output);
    if let Err(e) = &result {
        term.event(Event::Log { level: Level::Error, text: e });
    }
    term.finish();
    match result {
        Ok(_) => {
            // The file's path for scripts; on a terminal the save row says it.
            if !std::io::stdout().is_terminal() {
                println!("{}", output.display());
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
    text: &str,
    format: Format,
    profile_path: &Path,
    place: Place,
    output: &Path,
) -> Result<Vec<(String, usize)>, String> {
    let grammar = Grammar::parse(text, format).map_err(|e| format!("{}: {e}", profile_path.display()))?;

    let base = profile_path.parent().unwrap_or(Path::new("."));
    let mut sources = BTreeMap::new();
    for file in grammar.source_files() {
        let path = if Path::new(&file).is_absolute() { PathBuf::from(&file) } else { base.join(&file) };
        sources.insert(file, read(&path)?);
    }

    let download = Task::begin(term, "download", None, "download", 0, "");
    let center = locate(&download, http, place, grammar.card.address.clone(), (grammar.card.lat, grammar.card.lng))?;
    let card = Card::new(&grammar.card, center);
    let needs = Needs { keys: grammar.osm_keys(), tiles: grammar.tile_selectors(), ocean: grammar.draws_ocean() };
    let Fetched { osm: features, tiles, ocean } = fetch(http, download, &card, &needs)?;

    let draw = Task::begin(term, "draw", None, "draw", 0, "");
    let rendered = postcards_core::grammar_run::run_with(
        &grammar,
        &card,
        postcards_core::grammar_run::Inputs { features, tiles, ocean, sources: &sources },
        &draw,
    )
    .map_err(|e| e.to_string())?;
    save(draw, output, &rendered.svg, &rendered.slices)?;
    Ok(rendered.groups)
}
