//! The web app's presets, built in: a view can draw in one by name
//! (`view({ … }, "city-grain")`) from the command line and the page alike.
//! They are read from this crate's `presets/`, a copy of `web/src/presets`
//! that `check_web_presets -- --write` keeps (a test checks it), so the
//! crate builds on its own when published.

use std::path::Path;

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("presets");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut entries: Vec<(String, String)> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let path = e.path();
                    let id = path.file_name()?.to_str()?.strip_suffix(".js")?.to_string();
                    Some((id, path.canonicalize().ok()?.display().to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    let mut code = String::from("/// Built-in presets by id: `(id, source)`.\npub static PRESETS: &[(&str, &str)] = &[\n");
    for (id, path) in &entries {
        println!("cargo:rerun-if-changed={path}");
        code += &format!("    ({id:?}, include_str!({path:?})),\n");
    }
    code += "];\n";
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("presets.rs");
    std::fs::write(out, code).unwrap();
}
