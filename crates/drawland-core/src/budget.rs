//! A ceiling a single draw's fills must stay under, and the error when they
//! will not.
//!
//! The browser's WASM memory is one block, capped at 4 GB. A fill of a whole
//! map can want more than that. Rust's wasm allocator cannot return a null
//! pointer that a checked `try_reserve` would see -- an allocation that large
//! traps instead, and the page dies with nothing to show. So the fill pass
//! estimates what it is about to do, and refuses before the trap can happen.
//!
//! The estimate is measured, not derived: the live-heap peak of a whole draw
//! with one fill over 100,000 mm², masked, at 0.5 and 1 mm spacing
//! (`examples/budget_calib.rs`, native 64-bit, so wasm32 sits below it).
//! Per generator the peak fits `area × (a + b / spacing²)`: `b` is the part
//! that grows with the pattern's density, `a` what grows with the area alone
//! (a wave's points along its length, a generator's own grids).
//!
//! It only applies where the host sets a budget (`Job::set_memory_budget`,
//! from the page). The command line leaves it off and draws as much as the
//! machine has.

/// The engine's estimate of what a fill will cost, for the budget check and
/// for the progress note.
#[derive(Clone, Copy, Debug)]
pub struct FillCost {
    /// Paper area of the region being filled, square millimetres.
    pub area_mm2: f64,
    /// Peak bytes the fill adds to a draw: generating, masking, writing.
    pub bytes: u64,
}

/// `(a, b)` per generator: bytes per mm², and bytes per mm² at 1 mm spacing
/// that scale with `1 / spacing²`. Measured values, rounded up.
fn coefficients(generator: &str) -> (f64, f64) {
    match generator {
        "rectilinear" | "zigzag" | "lines" | "sunburst" | "concentric" | "none" => (5.0, 3.0),
        "spiral" => (24.0, 3.0),
        "chess" => (6.0, 60.0),
        "grid" => (7.0, 255.0),
        "triangles" => (11.0, 557.0),
        "honeycomb" => (0.0, 698.0),
        "dots" => (151.0, 132.0),
        "stipple" => (168.0, 56.0),
        "waves" => (467.0, 123.0),
        "wave_grid" => (480.0, 134.0),
        "scales" => (176.0, 197.0),
        "hilbert" => (41.0, 180.0),
        "scribble" => (103.0, 148.0),
        "grass" => (197.0, 1035.0),
        "gravel" => (342.0, 1853.0),
        "truchet" => (40.0, 898.0),
        "terrazzo" => (2.0, 1903.0),
        "wood" => (744.0, 750.0),
        "marble" => (11_456.0, 3801.0),
        "cracks" => (11_905.0, 11_196.0),
        "isoline-blobs" | "isoline-stack" => (2_500.0, 1_500.0),
        "growth" => (1_500.0, 1_800.0),
        "stipple-edge" | "stipple-noise" => (250.0, 150.0),
        // Not measured (`pat`, sources): as dense as the dense ones.
        _ => (500.0, 2000.0),
    }
}

/// `FillCost` for a region, a generator and an (already parsed) spacing, mm.
pub fn cost(area_mm2: f64, generator: &str, spacing_mm: f64) -> FillCost {
    let spacing = spacing_mm.max(1e-3);
    let (a, b) = coefficients(generator);
    let bytes = area_mm2 * (a + b / (spacing * spacing));
    FillCost { area_mm2, bytes: bytes as u64 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1 << 30;

    /// The 50 km strip at 1:10000: dotted parks over 742,050 mm² at 0.45 mm
    /// and waves over about as much water at 0.75 mm. Together they fit a
    /// 2 GB page budget now that masking runs in batches.
    #[test]
    fn the_fifty_km_strip_fits_a_page_budget() {
        let park = cost(742_050.0, "dots", 0.45);
        let water = cost(717_000.0, "waves", 0.75);
        assert!(park.bytes + water.bytes < 2 * GB, "{} + {}", park.bytes, water.bytes);
        assert!(park.bytes > 300_000_000, "{}", park.bytes);
    }

    /// Cracks over the same strip would not: its generator alone is GBs.
    #[test]
    fn a_heavy_generator_on_the_strip_is_refused() {
        assert!(cost(742_050.0, "cracks", 0.5).bytes > 2 * GB);
    }

    /// The 1:2967 postcard must not come anywhere near a page budget.
    #[test]
    fn the_postcard_stays_well_under_a_page_budget() {
        let park = cost(2_600.0, "dots", 0.45);
        let bldg = cost(4_000.0, "zigzag", 0.4);
        assert!(park.bytes + bldg.bytes < 100 * 1024 * 1024);
    }

    #[test]
    fn bigger_areas_and_finer_spacing_cost_more() {
        let coarse = cost(1000.0, "dots", 1.0);
        let fine = cost(1000.0, "dots", 0.1);
        let big = cost(10000.0, "dots", 1.0);
        assert!(fine.bytes > coarse.bytes);
        assert!(big.bytes > coarse.bytes);
    }
}
