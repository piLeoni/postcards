//! Profile + card + OSM data → SVG. No I/O: the host fetches the Overpass
//! response, the ocean polygons and any SVG sources and passes them in.

use crate::card::Card;
use crate::compose::compose;
use crate::fill::{self, FillError, Sources};
use crate::geom;
use crate::osm::Feature;
use crate::profile::Profile;
use crate::projection::Projector;
use crate::themes::{self, Context, LayerParts};
use geo::MultiPolygon;
use rayon::prelude::*;
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("layer {layer:?}: {source}")]
    Fill { layer: String, source: FillError },
    #[error("fill source {file:?}: {msg}")]
    Source { file: String, msg: String },
    #[error("{0}")]
    Plan(String),
}

pub struct Inputs<'a> {
    /// Features in lon/lat, as `osm::features_from_overpass` returns them.
    pub features: Vec<Feature>,
    /// Ocean polygons in lon/lat, when the card shows a coastline.
    pub ocean: Option<MultiPolygon<f64>>,
    /// SVG text of every file in `Profile::source_files`.
    pub sources: &'a BTreeMap<String, String>,
}

pub struct Rendered {
    pub svg: String,
    /// `(group id, stroke count)` in draw order.
    pub groups: Vec<(String, usize)>,
    /// `(name, svg)` per sheet when the card is cut (`map.slices`).
    pub slices: Vec<(String, String)>,
}

pub fn render(profile: &Profile, card: &Card, inputs: Inputs) -> Result<Rendered, RenderError> {
    let mut sources = Sources::new();
    for (file, text) in inputs.sources {
        let drawing = penfill::svg::parse_svg(text).map_err(|msg| RenderError::Source { file: file.clone(), msg })?;
        sources.insert(file.clone(), drawing);
    }
    let stack = profile.stack();
    for layer in &stack {
        for spec in themes::fill_specs(layer) {
            fill::validate(&spec, &sources).map_err(|source| RenderError::Fill { layer: layer.id.clone(), source })?;
        }
    }

    let projector = Projector::new(card);
    let (warp, w, h) = (&profile.map.warp, card.width_mm, card.height_mm);
    let features: Vec<Feature> = inputs
        .features
        .into_par_iter()
        .map(|mut f| {
            f.geometry = warp.bend(w, h, &projector.project_geometry(&f.geometry));
            f
        })
        .collect();
    let ocean = inputs.ocean.map(|o| {
        let area = MultiPolygon::new(vec![card.query_polygon()]);
        warp.bend_area(w, h, &projector.project_geometry(&geom::intersection(&o, &area)))
    });

    let ids: Vec<String> = stack.iter().map(|l| l.id.clone()).collect();
    let above: Vec<Vec<String>> = (0..stack.len()).map(|i| ids[i + 1..].to_vec()).collect();
    let deps: Vec<Vec<String>> = stack
        .iter()
        .zip(&above)
        .map(|(layer, above)| {
            let (mut refs, leftover) = crate::steps::dependencies(layer.steps.as_deref().unwrap_or_default());
            if let Some(off) = refs.iter().find(|r| !ids.contains(r)) {
                return Err(RenderError::Plan(format!("layer {:?} refers to {off:?}, which is disabled", layer.id)));
            }
            if leftover {
                refs.extend(above.iter().cloned());
            }
            Ok(refs)
        })
        .collect::<Result<_, _>>()?;

    // Layers run in waves: each wave is every layer whose inputs are ready.
    let mut masks: BTreeMap<String, MultiPolygon<f64>> = BTreeMap::new();
    let mut done: Vec<Option<LayerParts>> = vec![None; stack.len()];
    while done.iter().any(Option::is_none) {
        let ready: Vec<usize> = (0..stack.len())
            .filter(|&i| done[i].is_none() && deps[i].iter().all(|d| masks.contains_key(d)))
            .collect();
        if ready.is_empty() {
            let stuck: Vec<&str> = (0..stack.len()).filter(|&i| done[i].is_none()).map(|i| ids[i].as_str()).collect();
            return Err(RenderError::Plan(format!("layers depend on each other in a loop: {}", stuck.join(", "))));
        }
        let ctx = Context { card, features: &features, ocean: ocean.as_ref(), sources: &sources, masks: &masks };
        let wave: Vec<(usize, LayerParts)> = ready
            .par_iter()
            .map(|&i| {
                themes::render(stack[i], &ctx, &above[i])
                    .map(|p| (i, p))
                    .map_err(|source| RenderError::Fill { layer: ids[i].clone(), source })
            })
            .collect::<Result<_, _>>()?;
        for (i, p) in wave {
            masks.insert(ids[i].clone(), p.mask.clone());
            done[i] = Some(p);
        }
    }
    let parts: Vec<(String, LayerParts)> = ids.into_iter().zip(done.into_iter().map(Option::unwrap)).collect();

    let map = &profile.map;
    let paper = crate::sheets::lay_out(card.width_mm, card.height_mm, map.padding.0, &map.slices, compose(&parts));
    Ok(Rendered { svg: paper.svg, groups: paper.groups, slices: paper.slices })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::Format;

    fn render_yaml(layers: &str) -> Result<Rendered, RenderError> {
        let text = format!("map: {{ lat: 37.8, lng: -122.4, width: 100mm, height: 50mm, scale: \"1:10000\" }}\nlayers:\n{layers}");
        let profile = Profile::parse(&text, Format::Yaml).unwrap();
        let card = Card::new(&profile.map, (-122.4, 37.8));
        render(&profile, &card, Inputs { features: vec![], ocean: None, sources: &BTreeMap::new() })
    }

    #[test]
    fn a_layer_waits_for_the_mask_it_uses() {
        let out = render_yaml(
            "  - id: inner\n    steps: [{ region: card }, { buffer: -10 }, { emit: mask }]\n\
             \x20 - id: frame\n    steps: [{ region: card }, { difference: inner }, outline, { emit: outlines }]\n",
        )
        .unwrap();
        assert_eq!(out.groups, vec![("frame_outlines".to_string(), 2)]);
    }

    #[test]
    fn loops_and_disabled_references_are_plan_errors() {
        let looped = render_yaml(
            "  - id: ground\n    steps: [{ region: leftover }, { emit: mask }]\n\
             \x20 - id: probe\n    steps: [{ region: card }, { intersect: ground }, { emit: mask }]\n",
        );
        assert!(matches!(looped, Err(RenderError::Plan(m)) if m.contains("loop")));
        let off = render_yaml(
            "  - id: inner\n    enabled: false\n    steps: [{ region: card }, { emit: mask }]\n\
             \x20 - id: frame\n    steps: [{ region: card }, { difference: inner }, { emit: mask }]\n",
        );
        assert!(matches!(off, Err(RenderError::Plan(m)) if m.contains("disabled")));
    }
}
