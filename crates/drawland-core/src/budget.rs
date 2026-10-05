//! A ceiling a single draw's fills must stay under, and the error when they
//! will not.
//!
//! The browser's WASM memory is one block, capped at 4 GB. A fill of a whole
//! map can want far more than that: penfill walks every scanline of the area,
//! and a 50 km strip at 1:10000 smashes a dotted park layer into millions of
//! strokes. Rust's wasm allocator cannot return a null pointer that a checked
//! `try_reserve` would see -- an allocation that large traps instead, and the
//! page dies with nothing to show. So the fill pass measures what it is about
//! to do, and refuses before the out-of-memory trap can happen.
//!
//! The estimate is calibrated against measured draws, not derived. On the
//! 50 km strip at 1:10000 the dotted parks alone were 3,699,948 strokes and
//! moved the process from 0.9 GB to 7.75 GB: about 2 KB a stroke, because a
//! generator keeps its own sweep structure alive while it runs, not only the
//! finished polyline. The earlier estimate of a few dozen bytes a stroke was
//! two orders out and let the page run to the trap.
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
    /// How many strokes the pattern would lay, if left unclipped.
    pub strokes: u64,
    /// Bytes the strokes and their generator would take: the finished
    /// polylines plus the generator's working set.
    pub bytes: u64,
}

/// Bytes one finished stroke point costs in memory and in the SVG written
/// out: two f64 in a `Coord`, and the text of the polyline.
const BYTES_PER_POINT: u64 = 32;

/// Bytes one stroke costs beyond its points: the `LineString` itself, and the
/// generator's per-stroke bookkeeping while it runs. Measured at about 2 KB a
/// stroke for a dotted fill, which is dominated by the generator's sweep.
const BYTES_PER_STROKE: u64 = 2048;

/// `FillCost` for a region, a generator and an (already parsed) spacing, mm.
///
/// `strokes` assumes a pattern that covers its region densely at `spacing`
/// (dots, waves, zigzag); a sparse pattern is over-counted, which is the safe
/// direction for a ceiling.
pub fn cost(area_mm2: f64, _generator: &str, spacing_mm: f64) -> FillCost {
    let spacing = spacing_mm.max(1e-6);
    // One stroke per `spacing` of length and one per `spacing` across: about
    // `area / spacing²` strokes, each spanning roughly one side of the
    // region. Measured on the strip: 3.54M strokes for 0.45 mm over the
    // park area, matching this within a few percent.
    let strokes = (area_mm2 / (spacing * spacing)).max(1.0);
    // Hatching and waves lay many points per stroke; a dot lays two.
    let per = match _generator {
        "dots" | "stipple" | "gravel" | "marble" | "texture" => 2.0,
        "zigzag" | "spiral" | "concentric" | "hilbert" => 20.0,
        _ => 64.0,
    };
    let points = strokes * per;
    FillCost {
        area_mm2,
        strokes: strokes as u64,
        bytes: strokes as u64 * BYTES_PER_STROKE + points as u64 * BYTES_PER_POINT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 50 km strip at 1:10000, from the measured draw: parks were 3.54M
    /// strokes over 717,000 mm² of paper at 0.45 mm spacing, and cost 6.85 GB.
    #[test]
    fn the_fifty_km_park_fill_is_refused() {
        let park = cost(717_000.0, "dots", 0.45);
        assert!(park.strokes > 3_000_000, "{}", park.strokes);
        assert!(park.bytes > 2 * 1024 * 1024 * 1024, "{}", park.bytes);
    }

    /// The water waves on the same strip: 34,422 strokes but a huge region,
    /// and 5.25 GB of working set.
    #[test]
    fn the_fifty_km_water_fill_is_refused() {
        let water = cost(717_000.0, "waves", 0.75);
        assert!(water.bytes > 2 * 1024 * 1024 * 1024, "{}", water.bytes);
    }

    /// The 1:2967 postcard: 11k park strokes and 2.4k building strokes, and
    /// about 40 MB of movement. A 2 GB page budget must not refuse it.
    #[test]
    fn the_postcard_stays_well_under_a_page_budget() {
        let park = cost(2_600.0, "dots", 0.45);
        let bldg = cost(4_000.0, "zigzag", 0.4);
        assert!(park.strokes < 20_000, "{}", park.strokes);
        assert!(park.bytes + bldg.bytes < 100 * 1024 * 1024);
    }

    #[test]
    fn bigger_areas_and_finer_spacing_cost_more() {
        let coarse = cost(1000.0, "lines", 1.0);
        let fine = cost(1000.0, "lines", 0.1);
        let big = cost(10000.0, "lines", 1.0);
        assert!(fine.bytes > coarse.bytes);
        assert!(big.bytes > coarse.bytes);
        assert_eq!(coarse.strokes, 1000);
    }
}
