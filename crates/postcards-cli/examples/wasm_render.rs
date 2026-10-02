//! Render one of the web app's presets through the same code path the WASM
//! build exposes, against a cached Overpass reply. This is the page's smoke
//! test without a browser.
//!
//! `cargo run --release --example wasm_render -- <preset-id> [cache.json] [out.svg]`
//! `preset-id` is one of `full`, `parks`, `buildings` (see web/src/lib/presets.js).

use postcards_core::card::Card;
use postcards_core::grammar::Grammar;
use postcards_core::grammar_run::{run, Inputs};
use postcards_core::osm::features_from_overpass;
use postcards_core::profile::Format;
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let want = args.get(1).cloned().unwrap_or_else(|| "full".into());
    let cache = args.get(2).cloned().unwrap_or_else(|| "cache/8af64f6811f329eb90d15376e0a1e439bb3887aa.json".into());
    let out = args.get(3).cloned().unwrap_or_else(|| format!("/tmp/web_{want}.svg"));

    let js = std::fs::read_to_string("web/src/lib/presets.js").expect("web/src/lib/presets.js");
    let doc = preset(&js, &want).unwrap_or_else(|| panic!("no preset {want:?}: try full, parks or buildings"));

    let grammar = Grammar::parse(&doc, Format::Yaml).expect("preset parses");
    let card = Card::new(&grammar.card, (-122.256196, 37.8771145));
    let keys = grammar.osm_keys();
    let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
    let json = std::fs::read_to_string(&cache).expect("cache file");
    let features = features_from_overpass(&json, &card.query_polygon(), &keys).expect("features");
    println!("{want}: {} features, keys {:?}", features.len(), keys);

    let sources = BTreeMap::new();
    let t0 = std::time::Instant::now();
    let result = run(&grammar, &card, Inputs { features, ocean: None, sources: &sources }).expect("render");
    let ms = t0.elapsed().as_millis();
    for (id, n) in &result.groups {
        println!("  {id}: {n} strokes");
    }
    std::fs::write(&out, &result.svg).expect("write");
    println!("{ms} ms · {} kB → {out}", result.svg.len() / 1024);
}

/// The `` `doc` `` template that follows `export const <NAME>_DOC`.
fn preset(js: &str, want: &str) -> Option<String> {
    let marker = match want {
        "full" => "FULL_DOC",
        "parks" => "DEFAULT_DOC",
        "buildings" => "SMALL_DOC",
        other => return preset(js, other),
    };
    let at = js.find(&format!("export const {marker} = `"))?;
    let after = &js[at + format!("export const {marker} = `").len()..];
    let end = after.find('`')?;
    Some(after[..end].to_string())
}
