//! Buildings: the dissolved outline, inner walls between touching buildings,
//! and each footprint filled on its own (merged blocks grow courtyard notches
//! that break a serpentine fill).

use super::{below_ground, layer_fill, layer_stroke, Context, LayerParts};
use crate::fill::{self, FillError};
use crate::geom;
use crate::profile::{FillSpec, LayerSpec, StrokeSpec};
use crate::units::Mm;
use geo::{Geometry, MultiPolygon};
use rayon::prelude::*;

/// Without a `fill`, the historical hatch: 0.5 mm at 45°, 0.1 mm off the wall.
pub(super) fn fill_spec(layer: &LayerSpec) -> FillSpec {
    let base = FillSpec {
        generator: Some("rectilinear".into()),
        spacing: Some(Mm(0.5)),
        inset: layer.fill.is_none().then_some(Mm(0.1)),
        ..FillSpec::default()
    };
    layer_fill(base, layer)
}

pub(super) fn render(layer: &LayerSpec, ctx: &Context) -> Result<LayerParts, FillError> {
    let feats: Vec<_> = ctx
        .features
        .iter()
        .filter(|f| f.has("building") && !f.is_point() && !below_ground(f, &[]))
        .collect();
    if feats.is_empty() {
        return Ok(LayerParts::default());
    }

    let footprints: Vec<MultiPolygon<f64>> =
        feats.iter().map(|f| MultiPolygon::new(geom::polygons(&f.geometry))).filter(|m| !m.0.is_empty()).collect();
    let union = geom::union_multi(&footprints);
    let open_lines: geom::Lines = feats
        .iter()
        .filter(|f| matches!(f.geometry, Geometry::LineString(_) | Geometry::MultiLineString(_)))
        .flat_map(|f| geom::lines_of(&f.geometry))
        .collect();

    let all_lines: geom::Lines = feats.iter().flat_map(|f| geom::lines_of(&f.geometry)).collect();
    let inner = geom::buffer(&union, -0.1);
    let details = geom::clip_lines(&geom::dedupe_segments(&all_lines), &inner, false);

    let spec = fill_spec(layer);
    let filled: Result<Vec<geom::Lines>, FillError> =
        footprints.par_iter().map(|fp| fill::fill(fp, &spec, ctx.sources)).collect();

    let mut outlines = geom::rings(&union);
    outlines.extend(open_lines);
    Ok(LayerParts {
        outlines: fill::stroke(outlines, &layer_stroke(StrokeSpec::default(), layer)),
        details,
        filling: filled?.into_iter().flatten().collect(),
        mask: union,
    })
}
