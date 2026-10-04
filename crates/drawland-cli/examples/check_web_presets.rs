//! The web app's presets, pre-run: each script in `web/src/presets` evaluated
//! here, its graph written to `web/src/presets/graphs.json`, so the page draws
//! a preset without loading the script interpreter.
//!
//! `cargo run --example check_web_presets` fails when a preset does not run
//! or `graphs.json` is stale; `-- --write` writes it.

use serde_json::{Map, Value};

const DIR: &str = "web/src/presets";
const GRAPHS: &str = "web/src/presets/graphs.json";

fn main() {
    let write = std::env::args().any(|a| a == "--write");
    let mut names: Vec<String> = std::fs::read_dir(DIR)
        .expect(DIR)
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| n.strip_suffix(".js").map(str::to_string))
        .collect();
    names.sort();
    let mut graphs = Map::new();
    let mut failed = 0;
    for name in &names {
        let text = std::fs::read_to_string(format!("{DIR}/{name}.js")).expect("preset");
        match drawland_script::evaluate(&text) {
            Ok(g) => {
                let nodes: usize = g.sections.iter().map(|(_, d)| d.len()).sum();
                println!("ok    {name}: {nodes} nodes · {} drawn", g.draw.len());
                graphs.insert(name.clone(), g.to_json());
            }
            Err(e) => {
                println!("FAIL  {name}: {e}");
                failed += 1;
            }
        }
    }
    let text = serde_json::to_string(&Value::Object(graphs)).expect("json") + "\n";
    if write {
        std::fs::write(GRAPHS, &text).expect(GRAPHS);
        println!("wrote {GRAPHS}");
    } else if std::fs::read_to_string(GRAPHS).ok().as_deref() != Some(text.as_str()) {
        println!("STALE {GRAPHS}: run with -- --write");
        failed += 1;
    }
    println!("\n{} ok, {failed} failed", names.len().saturating_sub(failed));
    if failed > 0 {
        std::process::exit(1);
    }
}
