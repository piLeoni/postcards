//! Water: lakes, rivers and — when the card shows a coastline — the sea.

use super::{layer_fill, layer_stroke, Context, LayerParts};
use crate::fill::{self, FillError};
use crate::geom;
use crate::profile::{FillSpec, LayerSpec, StrokeSpec};
use crate::units::Mm;
use geo::Polygon;

pub(super) fn fill_spec(layer: &LayerSpec) -> FillSpec {
    let base = FillSpec {
        generator: Some("waves".into()),
        spacing: Some(Mm(0.75)),
        angle: Some(0.0),
        ..FillSpec::default()
    };
    layer_fill(base, layer)
}

pub(super) fn render(layer: &LayerSpec, ctx: &Context) -> Result<LayerParts, FillError> {
    let mut polys: Vec<Polygon<f64>> = ctx
        .features
        .iter()
        .filter(|f| f.has("water") || f.tag("natural") == Some("water"))
        .flat_map(|f| geom::polygons(&f.geometry))
        .collect();
    if let Some(ocean) = ctx.ocean {
        polys.extend(ocean.0.iter().cloned());
    }
    if polys.is_empty() {
        return Ok(LayerParts::default());
    }
    let mask = geom::union_all(&polys);
    let filling = fill::fill(&mask, &fill_spec(layer), ctx.sources)?;
    Ok(LayerParts {
        outlines: fill::stroke(geom::rings(&mask), &layer_stroke(StrokeSpec::default(), layer)),
        details: vec![],
        filling,
        mask,
    })
}
