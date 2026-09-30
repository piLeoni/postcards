//! `postcards-rs map`: a profile and a place in, the layered map SVG out.

mod ocean;
mod osm_http;

use clap::{Parser, Subcommand};
use postcards_core::card::{fetch_keys, overpass_query, Card};
use postcards_core::osm::{features_from_overpass, needs_ocean};
use postcards_core::pipeline::{render, Inputs};
use postcards_core::profile::{Format, Profile};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

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
        /// osmnx-compatible response cache, shared with the Python pipeline.
        #[arg(long, default_value = "cache")]
        cache: PathBuf,
        /// Use only cached responses; never touch the network for OSM data.
        #[arg(long)]
        offline: bool,
    },
}

struct Timer(Instant);

impl Timer {
    fn log(&mut self, what: &str) {
        eprintln!("{what}: {:.2}s", self.0.elapsed().as_secs_f64());
        self.0 = Instant::now();
    }
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

#[allow(clippy::too_many_arguments)]
fn map(
    profile_path: &Path,
    address: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    output: &Path,
    cache: PathBuf,
    offline: bool,
) -> Result<(), String> {
    let mut timer = Timer(Instant::now());
    let text = read(profile_path)?;
    let profile = Profile::parse(&text, Format::from_path(&profile_path.to_string_lossy()))
        .map_err(|e| format!("{}: {e}", profile_path.display()))?;

    let base = profile_path.parent().unwrap_or(Path::new("."));
    let mut sources = BTreeMap::new();
    for file in profile.source_files() {
        let path = if Path::new(&file).is_absolute() { PathBuf::from(&file) } else { base.join(&file) };
        sources.insert(file, read(&path)?);
    }

    let http = osm_http::Http::new(cache, offline);
    let center = match (address.or_else(|| profile.map.address.clone()), lat, lng) {
        (_, Some(lat), Some(lng)) => (lng, lat),
        (Some(address), _, _) => http.geocode(&address)?,
        (None, _, _) => match (profile.map.lat, profile.map.lng) {
            (Some(lat), Some(lng)) => (lng, lat),
            _ => return Err("no location: pass --address or --lat/--lng, or set map.address or map.lat/lng".into()),
        },
    };
    eprintln!("centre: {:.7}, {:.7}", center.1, center.0);
    let card = Card::new(&profile.map, center);

    let area = card.query_polygon();
    let keys = fetch_keys(&profile.osm_keys());
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let json = http.overpass(&overpass_query(&area, &keys, osm_http::OVERPASS_TIMEOUT_S))?;
    timer.log("Fetching data");
    let features = features_from_overpass(&json, &area, &keys).map_err(|e| e.to_string())?;
    timer.log(&format!("Building {} features", features.len()));

    let ocean = if needs_ocean(&features) {
        eprintln!("coastline found — loading ocean tiles");
        let b = geo::BoundingRect::bounding_rect(&area).ok_or("empty query area")?;
        Some(ocean::ocean([b.min().x, b.min().y, b.max().x, b.max().y])?)
    } else {
        None
    };

    let rendered = render(&profile, &card, Inputs { features, ocean, sources: &sources }).map_err(|e| e.to_string())?;
    timer.log("Rendering layers");
    std::fs::write(output, &rendered.svg).map_err(|e| format!("{}: {e}", output.display()))?;
    timer.log("Saving svg");
    for (id, n) in &rendered.groups {
        eprintln!("  {id}: {n} strokes");
    }
    println!("{}", output.display());
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Map { profile, address, lat, lng, output, cache, offline } => {
            map(&profile, address, lat, lng, &output, cache, offline)
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
