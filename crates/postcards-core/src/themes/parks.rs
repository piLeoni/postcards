//! Parks, gardens, woods, grass: one fill per kind, one soft outline around
//! them all. Kinds claim area in order, so overlapping tags fill once.

use super::{below_ground, layer_fill, layer_stroke, Context, LayerParts};
use crate::fill::{self, FillError};
use crate::geom;
use crate::osm::Feature;
use crate::profile::{FillSpec, LayerSpec, StrokeSpec, StrokeStyle};
use crate::units::Mm;
use geo::{MultiPolygon, Polygon};

/// `(key, value, kind)`; the first match wins.
const PARK_KINDS: &[(&str, &str, &str)] = &[
    ("leisure", "garden", "garden"),
    ("leisure", "park", "park"),
    ("natural", "wood", "wood"),
    ("landuse", "forest", "wood"),
    ("leisure", "nature_reserve", "wood"),
    ("landuse", "grass", "grass"),
    ("natural", "grassland", "grass"),
    ("landuse", "meadow", "grass"),
];

const DEFAULT_KINDS: &[(&str, f64)] = &[("garden", 0.25), ("park", 0.45), ("wood", 0.70), ("grass", 0.85)];

fn kind_of(f: &Feature) -> Option<&'static str> {
    PARK_KINDS.iter().find(|(k, v, _)| f.tag(k) == Some(*v)).map(|(_, _, kind)| *kind)
}

fn theme_spec(layer: &LayerSpec) -> FillSpec {
    let base = FillSpec {
        generator: Some("dots".into()),
        spacing: Some(Mm(0.5)),
        angle: Some(45.0),
        mark: Some(Mm(0.2)),
        ..FillSpec::default()
    };
    layer_fill(base, layer)
}

/// Kinds in claim order (built-in first, then the profile's extras), each
/// merged: theme ⊕ built-in kind ⊕ profile kind.
pub(super) fn kind_specs(layer: &LayerSpec) -> Vec<(String, FillSpec)> {
    let theme = theme_spec(layer);
    let mut names: Vec<String> = DEFAULT_KINDS.iter().map(|(n, _)| n.to_string()).collect();
    for (name, _) in &layer.kinds {
        if !names.contains(name) {
            names.push(name.clone());
        }
    }
    names
        .into_iter()
        .map(|name| {
            let mut spec = theme.clone();
            if let Some((_, spacing)) = DEFAULT_KINDS.iter().find(|(n, _)| *n == name) {
                spec = spec.merged(&FillSpec::spacing(*spacing));
            }
            if let Some((_, over)) = layer.kinds.iter().find(|(n, _)| *n == name) {
                spec = spec.merged(over);
            }
            (name, spec)
        })
        .collect()
}

pub(super) fn render(layer: &LayerSpec, ctx: &Context) -> Result<LayerParts, FillError> {
    let feats: Vec<(&Feature, &str)> = ctx
        .features
        .iter()
        .filter_map(|f| kind_of(f).map(|k| (f, k)))
        .filter(|(f, _)| !f.is_point() && !below_ground(f, &[]))
        .collect();
    if feats.is_empty() {
        return Ok(LayerParts::default());
    }

    let polys = |want: Option<&str>| -> Vec<Polygon<f64>> {
        feats
            .iter()
            .filter(|(_, k)| want.is_none_or(|w| w == *k))
            .flat_map(|(f, _)| geom::polygons(&f.geometry))
            .collect()
    };
    let union = geom::union_all(&polys(None));
    // OSM holes (ponds, courtyards) are filled over; the real occluders are
    // cut out at composition.
    let union_ext = geom::fill_holes(&union);

    let kinds = kind_specs(layer);
    let mut filling = Vec::new();
    let mut claimed: MultiPolygon<f64> = geom::empty();
    for (kind, spec) in &kinds {
        let subset = polys(Some(kind));
        if subset.is_empty() {
            continue;
        }
        let region = geom::intersection(&geom::fill_holes(&geom::union_all(&subset)), &union_ext);
        let region = geom::difference(&region, &claimed);
        if region.0.is_empty() {
            continue;
        }
        filling.extend(fill::fill(&region, spec, ctx.sources)?);
        claimed = geom::union_multi([&claimed, &region]);
    }

    let leftover = geom::difference(&union_ext, &claimed);
    if !leftover.0.is_empty() {
        let name = layer.option_str("leftover").unwrap_or("wood");
        let spec = kinds.iter().find(|(n, _)| n == name).map(|(_, s)| s.clone()).unwrap_or_else(|| theme_spec(layer));
        filling.extend(fill::fill(&leftover, &spec, ctx.sources)?);
    }

    let stroke = StrokeSpec {
        style: Some(StrokeStyle::Dash),
        dash: Some(Mm(0.45)),
        gap: Some(Mm(0.40)),
        mark: None,
    };
    Ok(LayerParts {
        outlines: fill::stroke(geom::exterior_rings(&union), &layer_stroke(stroke, layer)),
        details: vec![],
        trails: vec![],
        filling,
        mask: union,
    })
}
