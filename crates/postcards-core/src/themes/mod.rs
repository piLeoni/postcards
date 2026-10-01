//! Theme modules: features (card mm) in, `LayerParts` out. Themes decide what
//! geometry exists; the profile decides how it is drawn.

mod buildings;
mod parks;
mod roads;
mod water;

use crate::card::Card;
use crate::fill::{FillError, Sources};
use crate::geom::Lines;
use crate::osm::Feature;
use crate::profile::{FillSpec, LayerSpec, StrokeSpec};
use geo::MultiPolygon;
use std::collections::BTreeMap;

/// The drawable pieces of one layer.
#[derive(Debug, Clone)]
pub struct LayerParts {
    /// Boundary strokes.
    pub outlines: Lines,
    /// Secondary strokes inside the area (inner walls, lane dividers, seams).
    pub details: Lines,
    /// The area texture.
    pub filling: Lines,
    /// The area the layer covers; layers below are clipped by it.
    pub mask: MultiPolygon<f64>,
}

impl Default for LayerParts {
    fn default() -> Self {
        LayerParts { outlines: vec![], details: vec![], filling: vec![], mask: MultiPolygon::new(vec![]) }
    }
}

impl LayerParts {
    pub fn is_empty(&self) -> bool {
        self.outlines.is_empty() && self.details.is_empty() && self.filling.is_empty() && self.mask.0.is_empty()
    }
}

pub struct Context<'a> {
    pub card: &'a Card,
    /// Features projected to card mm.
    pub features: &'a [Feature],
    /// Ocean polygons in card mm, when the card shows a coastline.
    pub ocean: Option<&'a MultiPolygon<f64>>,
    pub sources: &'a Sources,
    /// Masks of the layers rendered so far, by id.
    pub masks: &'a BTreeMap<String, MultiPolygon<f64>>,
}

/// `above`: ids of the layers drawn over this one.
pub fn render(layer: &LayerSpec, ctx: &Context, above: &[String]) -> Result<LayerParts, FillError> {
    if let Some(steps) = &layer.steps {
        let env = crate::steps::Env {
            features: ctx.features,
            card_mm: (ctx.card.width_mm, ctx.card.height_mm),
            masks: ctx.masks,
            above,
            sources: ctx.sources,
            layer_fill: layer.fill.as_ref(),
            layer_stroke: layer.stroke.as_ref(),
        };
        return crate::steps::run(steps, &env);
    }
    match layer.module.as_deref().unwrap_or_default() {
        "buildings/v1" => buildings::render(layer, ctx),
        "parks/v1" => parks::render(layer, ctx),
        "water/v1" => water::render(layer, ctx),
        "roads/v1" => roads::render(layer, ctx),
        other => unreachable!("profile validation admits only known modules, got {other:?}"),
    }
}

/// The compiled roads module, reachable from the grammar executor.
pub fn roads_render(layer: &LayerSpec, ctx: &Context) -> Result<LayerParts, FillError> {
    roads::render(layer, ctx)
}

/// Every fill spec the layer would use, fully merged, for up-front checks.
pub fn fill_specs(layer: &LayerSpec) -> Vec<FillSpec> {    if let Some(steps) = &layer.steps {
        return crate::steps::fill_specs(steps, layer.fill.as_ref());
    }
    match layer.module.as_deref().unwrap_or_default() {
        "buildings/v1" => vec![buildings::fill_spec(layer)],
        "parks/v1" => parks::kind_specs(layer).into_iter().map(|(_, s)| s).collect(),
        "water/v1" => vec![water::fill_spec(layer)],
        _ => vec![],
    }
}

fn layer_fill(defaults: FillSpec, layer: &LayerSpec) -> FillSpec {
    match &layer.fill {
        Some(f) => defaults.merged(f),
        None => defaults,
    }
}

fn layer_stroke(defaults: StrokeSpec, layer: &LayerSpec) -> StrokeSpec {
    match &layer.stroke {
        Some(s) => defaults.merged(s),
        None => defaults,
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
