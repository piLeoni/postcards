//! Rewrite the generated pattern block of `drawland.d.ts` from penfill's
//! catalogue: run after a pattern, option or material changes in penfill.
//!
//!     cargo run -p drawland-script --example write_dts

#[path = "../src/catalog_dts.rs"]
mod catalog_dts;

fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/drawland.d.ts");
    let dts = std::fs::read_to_string(path).expect("read drawland.d.ts");
    let next = catalog_dts::rewrite(&dts);
    if next == dts {
        eprintln!("drawland.d.ts is up to date");
    } else {
        std::fs::write(path, next).expect("write drawland.d.ts");
        eprintln!("rewrote the catalogue block of {path}");
    }
}
