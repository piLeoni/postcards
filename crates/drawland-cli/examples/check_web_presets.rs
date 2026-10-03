//! Check the card documents the web app ships still parse.
//!
//! The page reads `web/src/lib/presets.js`, so the templates live in JS; this
//! pulls them out and runs the parser over each. `cargo test --example` keeps
//! a preset that stops parsing from reaching a browser.
//!
//! `cargo run --example check_web_presets`

fn main() {
    let text = std::fs::read_to_string("web/src/lib/presets.js").expect("web/src/lib/presets.js");
    let mut checked = 0;
    let mut failed = 0;
    for doc in templates(&text) {
        match drawland_core::grammar::Grammar::parse(&doc, drawland_core::profile::Format::Yaml) {
            Ok(g) => {
                println!("ok    {} bytes · {} areas · {} fills · {} drawn", doc.len(), g.defs(drawland_core::grammar::Section::Areas).len(), g.defs(drawland_core::grammar::Section::Fills).len(), g.draw.len());
                checked += 1;
            }
            Err(e) => {
                println!("FAIL  {e}");
                failed += 1;
            }
        }
    }
    println!("\n{checked} ok, {failed} failed");
    if failed > 0 {
        std::process::exit(1);
    }
}

/// Every `` `...` `` template literal in the file, which is where the docs live.
fn templates(js: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = js;
    while let Some(start) = rest.find('`') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('`') else { break };
        let body = &after[..end];
        if body.contains("card:") {
            out.push(body.to_string());
        }
        rest = &after[end + 1..];
    }
    out
}
