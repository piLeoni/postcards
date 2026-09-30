//! Profile + card + OSM data → SVG. No I/O: the host fetches the Overpass
//! response, the ocean polygons and any SVG sources and passes them in.

use crate::card::Card;
use crate::compose::compose;
use crate::fill::{self, FillError, Sources};
use crate::geom;
use crate::osm::Feature;
use crate::profile::Profile;
use crate::projection::Projector;
use crate::svg::write_svg;
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
    let features: Vec<Feature> = inputs
        .features
        .into_par_iter()
        .map(|mut f| {
            f.geometry = projector.project_geometry(&f.geometry);
            f
        })
        .collect();
    let ocean = inputs.ocean.map(|o| {
        let area = MultiPolygon::new(vec![card.query_polygon()]);
        projector.project_geometry(&geom::intersection(&o, &area))
    });

    let ctx = Context { card, features: &features, ocean: ocean.as_ref(), sources: &sources };
    let parts: Vec<(String, LayerParts)> = stack
        .par_iter()
        .map(|layer| {
            themes::render(layer, &ctx)
                .map(|p| (layer.id.clone(), p))
                .map_err(|source| RenderError::Fill { layer: layer.id.clone(), source })
        })
        .collect::<Result<_, _>>()?;

    let groups = compose(&parts);
    Ok(Rendered {
        svg: write_svg(card.width_mm, card.height_mm, &groups),
        groups: groups.iter().map(|(id, lines)| (id.clone(), lines.len())).collect(),
    })
}
