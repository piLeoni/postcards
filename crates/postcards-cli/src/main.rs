//! `postcards-rs map`: a profile and a place in, the layered map SVG out.

mod osm_http;
mod term;

use clap::{Parser, Subcommand};
use postcards_core::card::{fetch_keys, Card};
use postcards_core::grammar::Grammar;
use postcards_core::ocean::Ocean;
use postcards_core::osm::{features_from_overpass, needs_ocean};
use postcards_core::pipeline::{render, Inputs};
use postcards_core::profile::{Format, Profile};
use postcards_core::progress::{thousands, Event, Level, Progress, Task};
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
    let (features, ocean) = fetch(http, download, &card, &fetch_keys(&profile.osm_keys()))?;

    let draw = Task::begin(term, "draw", None, "draw", 0, "");
    let task = draw.child("render", "render", 0, "");
    let rendered = render(&profile, &card, Inputs { features, ocean, sources: &sources }).map_err(|e| e.to_string())?;
    task.ok(&format!("{} groups", rendered.groups.len()));
    save(draw, output, &rendered.svg)?;
    Ok(rendered.groups)
}

/// The OSM features on `card`, and the ocean when the card shows a coast:
/// each a row under `download`, which ends with them.
fn fetch(
    http: &osm_http::Http,
    download: Task,
    card: &Card,
    keys: &[String],
) -> Result<(Vec<postcards_core::osm::Feature>, Option<geo::MultiPolygon<f64>>), String> {
    let json = http.overpass(card, keys, &download)?;
    let mb = json.len() as f64 / 1e6;

    let area = card.query_polygon();
    let task = download.child("read", "read OSM", 0, "");
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let features = features_from_overpass(&json, &area, &keys).map_err(|e| e.to_string())?;
    let found = format!("{} features", thousands(features.len() as u64));
    task.ok(&found);

    let ocean = if needs_ocean(&features) { Some(ocean(&download, &area)?) } else { None };
    download.ok(&format!("{mb:.1} MB · {found}"));
    Ok((features, ocean))
}

/// The sea under a card that shows a coast, from OpenFreeMap's vector tiles
/// (cached by terramask), as the `ocean tiles` row.
fn ocean(download: &Task, area: &geo::Polygon<f64>) -> Result<geo::MultiPolygon<f64>, String> {
    let mut ocean = Ocean::new(area);
    let task = download.child("ocean", "ocean tiles", ocean.tiles(terramask::MAX_ZOOM).len() as u64, "tiles");
    let found = terramask::Fetcher::with_source(postcards_core::ocean::TILES)
        .water(ocean.bounds(), ocean.zoom(terramask::MAX_ZOOM), &postcards_core::ocean::filter(), |done, total| {
            if done == 1 {
                task.set_total(total as u64);
            }
            task.step(done as u64, "");
        })
        .map_err(|e| format!("ocean tiles: {e}"))?;
    ocean.add_features(found);
    let sea = ocean.polygons();
    task.ok(&format!("{} polygons", sea.0.len()));
    Ok(sea)
}

/// Writes the SVG as the last row under `draw`, which ends with it.
fn save(draw: Task, output: &Path, svg: &str) -> Result<(), String> {
    let task = draw.child("save", "save", 0, "");
    std::fs::write(output, svg).map_err(|e| format!("{}: {e}", output.display()))?;
    task.ok(&output.display().to_string());
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

/// The v3 path: `Grammar` in, the same Overpass fetch, the grammar executor out.
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
    let (features, ocean) = fetch(http, download, &card, &fetch_keys(&grammar.osm_keys()))?;

    let draw = Task::begin(term, "draw", None, "draw", 0, "");
    let rendered = postcards_core::grammar_run::run_with(
        &grammar,
        &card,
        postcards_core::grammar_run::Inputs { features, ocean, sources: &sources },
        &draw,
    )
    .map_err(|e| e.to_string())?;
    save(draw, output, &rendered.svg)?;
    Ok(rendered.groups)
}
