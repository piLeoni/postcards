//! Render one of the web app's presets through the same code path the WASM
//! build exposes: its vector tiles through terramask's fetcher (cached), and
//! for `osm_select`, a cached Overpass reply. This is the page's smoke test
//! without a browser.
//!
//! `cargo run --release --example wasm_render -- <preset-id> [cache.json] [out.svg]`
//! `preset-id` names a script in web/src/presets (`full`, `parks`, `buildings`, …).

use drawland_core::output::Output;
use drawland_core::grammar_run::{run, Inputs};
use drawland_core::osm::features_from_overpass;
use drawland_core::tiles;
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let want = args.get(1).cloned().unwrap_or_else(|| "full".into());
    let cache = args.get(2).cloned().unwrap_or_else(|| "cache/8af64f6811f329eb90d15376e0a1e439bb3887aa.json".into());
    let out = args.get(3).cloned().unwrap_or_else(|| format!("/tmp/web_{want}.svg"));

    let path = format!("web/src/presets/{want}.js");
    let script = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("no preset {path}"));
    let grammar = drawland_script::evaluate(&script).unwrap_or_else(|e| panic!("{path}: {e}"));
    let output = Output::new(&grammar.output, (-122.256196, 37.8771145));
    let keys = grammar.osm_keys();
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let features = if keys.is_empty() {
        Vec::new()
    } else {
        let json = std::fs::read_to_string(&cache).expect("cache file");
        features_from_overpass(&json, &output.query_polygon(), &keys).expect("features")
    };
    let tile_features = match tiles::plan(&output, &grammar.tile_selectors(), (!keys.is_empty()).then_some(&features[..])).expect("tile plan") {
        Some(mut t) => {
            let found = terramask::Fetcher::with_source(tiles::TILES)
                .features_of(&t.tiles(terramask::MAX_ZOOM), t.filter(), |_, _| {})
                .expect("vector tiles");
            t.add_features(found);
            t.features()
        }
        None => Vec::new(),
    };
    println!("{want}: {} OSM features, keys {:?} · {} tile features", features.len(), keys, tile_features.len());

    let sources = BTreeMap::new();
    let t0 = std::time::Instant::now();
    let terrain = read_terrain(&grammar, &output).expect("terrain");
    let result = run(&grammar, &output, Inputs { features, tiles: tile_features, sources: &sources, terrain, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new() }).expect("render");
    let ms = t0.elapsed().as_millis();
    for (id, n) in &result.groups {
        println!("  {id}: {n} strokes");
    }
    std::fs::write(&out, &result.svg).expect("write");
    println!("{ms} ms · {} kB → {out}", result.svg.len() / 1024);
}

/// The elevation under the output, when a preset draws terrain, as the page
/// reads it: the same Terrarium tiles, folded into the same grid.
fn read_terrain(grammar: &drawland_core::grammar::Grammar, output: &Output) -> Result<Option<drawland_core::terrain::Grid>, String> {
    if !grammar.draws_terrain() {
        return Ok(None);
    }
    let width = drawland_core::terrain::width_px(&output);
    let bounds = drawland_core::terrain::bounds_of(output);
    let grid = terramask::Grid::with_width(bounds, width);
    let e = terramask::Fetcher::with_source(terramask::TERRARIUM)
        .elevation_for(&grid, &terramask::ZoomLimits::default(), |_, _| {})
        .map_err(|e| e.to_string())?;
    let elev = e.on(&grid);
    Ok(Some(drawland_core::terrain::Grid::new(bounds, grid.merc, elev, width)))
}
