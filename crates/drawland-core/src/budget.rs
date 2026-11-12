//! A ceiling a single draw's fills must stay under, and the error when they
//! will not.
//!
//! The browser's WASM memory is one block, capped at 4 GB. A fill of a whole
//! map can want more than that. Rust's wasm allocator cannot return a null
//! pointer that a checked `try_reserve` would see -- an allocation that large
//! traps instead, and the page dies with nothing to show. So the fill pass
//! estimates what it is about to do, and refuses before the trap can happen.
//!
//! The estimate is sampled, not tabled: the fill is drawn for real on a small
//! square of paper, its points and strokes are counted, and the count is
//! scaled to the area. That holds for any pattern — a material of several
//! layers, a symbol of many strokes, a motif the profile wrote — without a
//! table to keep in step with penfill. What a point and a stroke cost at the
//! peak of a whole draw (made, masked, written) is measured once
//! (`examples/budget_calib.rs`, native 64-bit, so wasm32 sits below it).
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
/// Peak bytes per point and per stroke a fill holds in a whole draw:
/// generated, clipped, masked and written. Fitted by `budget_calib`, then
/// kept about twice what it measures: the guard must refuse before the page
/// traps, never after.
const PER_POINT: f64 = 72.0;
const PER_STROKE: f64 = 260.0;

/// What a fill of `area_mm2` of paper as `spec` says will hold at its peak.
pub fn cost(area_mm2: f64, spec: &crate::profile::FillSpec) -> FillCost {
    let (points, strokes) = sample(spec).unwrap_or((40.0, 4.0));
    let bytes = area_mm2 * (points * PER_POINT + strokes * PER_STROKE);
    FillCost { area_mm2, bytes: bytes as u64 }
}

/// Points and strokes per mm² of `spec`, from a real fill of a square big
/// enough to hold a dozen of its largest elements.
pub fn sample(spec: &crate::profile::FillSpec) -> Option<(f64, f64)> {
    let (name, cs) = crate::fill::catalog_spec(spec).ok()?;
    if name == "none" || name == "solid" {
        return Some((0.0, 0.0));
    }
    let widest = penfill::catalog::layers(&name, &cs).ok()?.iter().map(|(_, s)| *s).fold(0.0_f64, f64::max);
    let side = (widest * 12.0).clamp(20.0, 150.0);
    // Off the page origin, so a lattice anchored there does not line up with
    // the square's edges.
    let (x, y) = (37.3, 41.9);
    let square = penfill::Region::from_ring(&[(x, y), (x + side, y), (x + side, y + side), (x, y + side)]);
    let out = penfill::catalog::fill(&name, &square, &cs).ok()?;
    let points: usize = out.strokes.iter().map(Vec::len).sum();
    let area = side * side;
    Some((points as f64 / area, out.strokes.len() as f64 / area))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1 << 30;

    fn cost(area: f64, pattern: &str, spacing: f64) -> FillCost {
        super::cost(area, &crate::profile::FillSpec { generator: Some(pattern.into()), ..crate::profile::FillSpec::spacing(spacing) })
    }

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
        assert!(cost(742_050.0, "marble", 0.5).bytes > 2 * GB);
    }

    /// The 1:2967 postcard must not come anywhere near a page budget.
    #[test]
    fn the_postcard_stays_well_under_a_page_budget() {
        let park = cost(2_600.0, "dots", 0.45);
        let bldg = cost(4_000.0, "serpentine", 0.4);
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
