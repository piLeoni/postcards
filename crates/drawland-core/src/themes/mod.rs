//! Compiled modules: features (output mm) in, named lines and areas out.

mod roads;
pub use roads::{GroundMeasure, PaperMeasure, RoadClassObject, RoadClassSpec, RoadMeasure, RoadOptions, RoadWidthMode, Roads};

use crate::geom::Lines;
use crate::osm::Feature;
use crate::output::Output;
use geo::MultiPolygon;

/// The drawable pieces of one module.
#[derive(Debug, Clone)]
pub struct LayerParts {
    /// Boundary strokes.
    pub outlines: Lines,
    /// Secondary strokes inside the area (inner walls, lane dividers, seams).
    pub details: Lines,
    /// Ways drawn as one line rather than an outline (footways, paths,
    /// tracks). The strip each line covers is part of `mask`.
    pub trails: Lines,
    /// The area texture.
    pub filling: Lines,
    /// The area the module covers; what is below is clipped by it.
    pub mask: MultiPolygon<f64>,
}

impl Default for LayerParts {
    fn default() -> Self {
        LayerParts { outlines: vec![], details: vec![], trails: vec![], filling: vec![], mask: MultiPolygon::new(vec![]) }
    }
}

impl LayerParts {
    pub fn is_empty(&self) -> bool {
        self.outlines.is_empty() && self.details.is_empty() && self.trails.is_empty() && self.filling.is_empty() && self.mask.0.is_empty()
    }
}

pub struct Context<'a> {
    pub output: &'a Output,
    /// Features projected to output mm.
    pub features: &'a [Feature],
}

/// The compiled roads module.
pub fn roads_render(ctx: &Context, opts: &RoadOptions) -> Roads {
    roads::build(ctx, opts)
}

/// OSM keys a module selects on, when it reads every OSM feature.
pub fn osm_keys(module: &str) -> &'static [&'static str] {
    match module {
        "roads" => &["highway"],
        _ => &[],
    }
}

fn numeric(value: &str) -> Option<f64> {
    value.parse::<f64>().ok()
}

/// Underground: a negative `layer`/`level`-like tag, or `location=underground`.
pub fn is_underground(f: &Feature) -> bool {
    below_ground(f, &[])
}

/// [`is_underground`], ignoring the keys in `skip` (already resolved by the caller).
fn below_ground(f: &Feature, skip: &[&str]) -> bool {
    f.tags.iter().any(|(k, v)| {
        let key = k.to_ascii_lowercase();
        let levelish = key.contains("layer") || key.contains("level");
        levelish && !skip.contains(&k.as_str()) && numeric(v).is_some_and(|n| n < 0.0)
    }) || f.tag("location").is_some_and(|l| l.eq_ignore_ascii_case("underground"))
}
