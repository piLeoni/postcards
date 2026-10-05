//! Does filling a large region in tiles lower the peak memory?
//!
//! Run: cargo run --release -p drawland-core --example tiled_fill
//!
//! It fills a long strip of paper with dots twice: once as one region, once as
//! a row of overlapping tiles, clipping each tile's fill to the tile. Both are
//! timed and the process RSS is sampled around each, with the stroke count and
//! the number of pieces that straddle a tile seam.

use drawland_core::fill::{self, Sources};
use drawland_core::geom::{self, Lines};
use drawland_core::profile::FillSpec;
use drawland_core::progress::resident_bytes;
use drawland_core::units::Mm;
use geo::{polygon, MultiPolygon};

fn strip(w: f64, h: f64) -> MultiPolygon<f64> {
    MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: w, y: 0.0), (x: w, y: h), (x: 0.0, y: h)]])
}

fn main() {
    let (w, h) = (1000.0f64, 50.0f64);
    let spec = FillSpec { generator: Some("dots".into()), ..FillSpec::spacing(0.45) };
    let sources = Sources::new();
    println!("strip {w} x {h} mm, dots at 0.45 mm, region {} mm²\n", w * h);

    // --- whole -----------------------------------------------------------------
    let before = resident_bytes();
    let t = std::time::Instant::now();
    let whole = fill::fill(&strip(w, h), &spec, &sources).expect("fill");
    let peak = resident_bytes();
    println!(
        "whole       {:>9} strokes  {:>7.0} ms  +{:.2} GB peak",
        whole.len(),
        t.elapsed().as_secs_f64() * 1000.0,
        (peak.saturating_sub(before)) as f64 / 1e9,
    );
    drop(whole);

    // --- tiled -----------------------------------------------------------------
    let tiles = 8;
    let tile_w = w / tiles as f64;
    let overlap = 5.0;
    let mut strokes: Lines = Vec::new();
    let mut seams = 0usize;
    let before = resident_bytes();
    let t = std::time::Instant::now();
    let mut peak = before;
    for i in 0..tiles {
        let x0 = (i as f64 * tile_w - if i == 0 { 0.0 } else { overlap }).max(0.0);
        let x1 = (x0 + tile_w + overlap).min(w);
        let part: MultiPolygon<f64> = geom::intersection(&strip(w, h), &strip_at(x0, x1, h));
        let got = fill::fill(&part, &spec, &sources).expect("fill");
        seams += got.iter().filter(|l| straddles(l, x0, x1)).count();
        strokes.extend(got);
        peak = peak.max(resident_bytes());
    }
    println!(
        "tiled x{tiles}   {:>9} strokes  {:>7.0} ms  +{:.2} GB peak  {seams} strokes touch a seam",
        strokes.len(),
        t.elapsed().as_secs_f64() * 1000.0,
        (peak.saturating_sub(before)) as f64 / 1e9,
    );
    let _ = geom::empty();
    let _ = Mm(0.0);
}

fn strip_at(x0: f64, x1: f64, h: f64) -> MultiPolygon<f64> {
    MultiPolygon::new(vec![polygon![(x: x0, y: 0.0), (x: x1, y: 0.0), (x: x1, y: h), (x: x0, y: h)]])
}

/// A stroke whose bounding box reaches a tile's edge: it may be cut there.
fn straddles(l: &geo::LineString<f64>, x0: f64, x1: f64) -> bool {
    let xs: Vec<f64> = l.0.iter().map(|c| c.x).collect();
    let (lo, hi) = (xs.iter().copied().fold(f64::MAX, f64::min), xs.iter().copied().fold(f64::MIN, f64::max));
    lo <= x0 + 1e-9 || hi >= x1 - 1e-9
}
