//! Live-heap peak of a whole run with one fill, per generator and spacing,
//! next to what `budget::cost` predicts, and the `(a, b)` that fit it.
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
    for g in drawland_core::fill::GENERATORS {
        let mut peaks = Vec::new();
        for s in [0.5, 1.0] {
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
            let base = LIVE.load(Ordering::Relaxed);
            PEAK.store(base, Ordering::Relaxed);
            let t = std::time::Instant::now();
            let Ok(out) = run(&grammar, &output, Inputs { features: vec![], tiles: vec![], sources: &Default::default(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new() }) else {
                println!("{g:<12} {s}: failed");
                continue;
            };
            let peak = PEAK.load(Ordering::Relaxed) - base;
            let est = drawland_core::budget::cost(w * h, g, s);
            println!(
                "{g:<12} {s:>4}  peak {:>7.1} MB  est {:>8.1} MB  strokes {:>8}  svg {:>6.1} MB  {:.1}s",
                peak as f64 / 1e6,
                est.bytes as f64 / 1e6,
                out.groups[0].1,
                out.svg.len() as f64 / 1e6,
                t.elapsed().as_secs_f64()
            );
            peaks.push(peak as f64 / (w * h));
        }
        // bytes per mm² = a + b / s², through the two spacings.
        if let [p05, p1] = peaks[..] {
            let b = ((p05 - p1) / 3.0).max(0.0);
            let (a, b) = if p1 < b { (0.0, (p05 / 4.0).max(p1)) } else { (p1 - b, b) };
            println!("FIT {g:<12} a {a:>8.1}  b {b:>8.1}");
        }
    }
}
