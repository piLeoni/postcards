//! Live-heap peak of a whole run with one fill, for patterns of every kind at
//! their own spacing and at half of it, next to the points and strokes
//! `budget::sample` counts; and the bytes per point and per stroke that fit
//! them (least squares), for `budget::PER_POINT` / `PER_STROKE`.
//!
//! Run: cargo run --release -p drawland-core --example budget_calib

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Counting;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            let live = LIVE.fetch_add(l.size(), Ordering::Relaxed) + l.size();
            PEAK.fetch_max(live, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        LIVE.fetch_sub(l.size(), Ordering::Relaxed);
        unsafe { System.dealloc(p, l) }
    }
}

#[global_allocator]
static A: Counting = Counting;

use drawland_core::grammar_run::{run, Inputs};
use drawland_core::units::Mm;

fn main() {
    let (w, h) = (1000.0, 100.0);
    let spec = drawland_core::profile::OutputSpec {
        address: None,
        lat: None,
        lng: None,
        width: Mm(w),
        height: Mm(h),
        scale: drawland_core::units::Scale(10000.0),
        bearing: 0.0,
        projection: Default::default(),
        warp: Default::default(),
        padding: Default::default(),
        slices: Default::default(),
        tile_zoom: None,
    };
    let output = drawland_core::output::Output::new(&spec, (0.0, 0.0));
    const NAMES: &[&str] = &[
        "lines", "crosshatch", "serpentine", "dashes", "dots", "stipple", "sand", "shallows", "grass", "meadow", "woodland",
        "forest", "conifers", "sprouts", "gravel", "boulders", "cracked-earth", "terrazzo", "brick", "setts", "flagstones",
        "waves", "currents", "scallops", "curls", "scribble", "marble", "wood", "swells", "granite", "shale", "concentric",
        "isoline-stack", "clouds", "growth",
    ];
    let mut rows: Vec<(f64, f64, f64)> = Vec::new(); // (points/mm², strokes/mm², peak bytes/mm²)
    // `CALIB=dots,gravel` measures only those.
    let only = std::env::var("CALIB").ok();
    for g in NAMES.iter().filter(|g| only.as_deref().is_none_or(|o| o.split(',').any(|n| n == **g))) {
        let base = penfill::catalog::default_spacing(g).unwrap_or(1.0);
        for s in [base, base / 2.0] {
            let fill = drawland_core::profile::FillSpec { generator: Some((*g).into()), ..drawland_core::profile::FillSpec::spacing(s) };
            let Some((pts, strokes)) = drawland_core::budget::sample(&fill) else {
                println!("{g:<14} {s}: no sample");
                continue;
            };
            let text = format!(
                r#"{{
              "output": {{ "width": "{w}mm", "height": "{h}mm", "scale": 10000 }},
              "$areas": {{ "frame": {{ "engine_frame": {{}} }}, "band": {{ "tools_grow": {{ "of": "$areas.frame", "by": "-30mm" }} }} }},
              "$fills": {{ "f": {{ "tools_fill": {{ "in": "$areas.frame", "pattern": "{g}", "spacing": "{s}mm" }} }} }},
              "draw": [ {{ "id": "f", "from": "$fills.f" }} ],
              "compose": {{ "masks": {{ "m": {{ "from": "$areas.band", "occludes": ["f"] }} }} }}
            }}"#
            );
            let Ok(grammar) = drawland_core::grammar::Grammar::from_json(&text) else { continue };
            let base_live = LIVE.load(Ordering::Relaxed);
            PEAK.store(base_live, Ordering::Relaxed);
            let t = std::time::Instant::now();
            let Ok(out) = run(&grammar, &output, Inputs { features: vec![], tiles: vec![], sources: &Default::default(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() }) else {
                println!("{g:<14} {s}: failed");
                continue;
            };
            let peak = (PEAK.load(Ordering::Relaxed) - base_live) as f64;
            let est = drawland_core::budget::cost(w * h, &fill);
            println!(
                "{g:<14} {s:>5.2}  peak {:>7.1} MB  est {:>7.1} MB  ({:>5.2}×)  pts/mm² {pts:>7.2}  strokes/mm² {strokes:>6.3}  strokes {:>8}  {:.1}s",
                peak / 1e6,
                est.bytes as f64 / 1e6,
                est.bytes as f64 / peak.max(1.0),
                out.groups[0].1,
                t.elapsed().as_secs_f64()
            );
            rows.push((pts, strokes, peak / (w * h)));
        }
    }
    // peak/mm² ≈ P·points/mm² + Q·strokes/mm²: least squares for P and Q.
    let (mut xx, mut xy, mut yy, mut xz, mut yz) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (x, y, z) in &rows {
        xx += x * x;
        xy += x * y;
        yy += y * y;
        xz += x * z;
        yz += y * z;
    }
    let det = xx * yy - xy * xy;
    let p = (xz * yy - yz * xy) / det;
    let q = (yz * xx - xz * xy) / det;
    println!("FIT  PER_POINT {p:.1}  PER_STROKE {q:.1}");
}
