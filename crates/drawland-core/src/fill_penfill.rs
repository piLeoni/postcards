//! Map draw.land [`FillSpec`] options onto penfill's unified [`FillParams`] and
//! registry (`fill_by_name`).

use crate::fill::{anchor, FillError, Opts};
use crate::profile::FillSpec;
use penfill::dotswaves::{fill_dots_params, Lattice};
use penfill::pattern::{fill_by_name, EdgeMode, FillParams};
use penfill::Region;

/// Draw.land pattern name → penfill registry name when they differ.
pub fn registry_name(generator: &str, o: &Opts) -> Result<Option<String>, FillError> {
    if generator == "none" {
        return Ok(None);
    }
    if matches!(generator, "isoline-blobs" | "isoline-stack" | "isoline-stack-hatched" | "growth" | "clouds") {
        return Ok(None);
    }
    if generator == "pat" {
        let name = o.str("name")?.ok_or_else(|| o.bad("name", "pat needs a pattern name"))?;
        return Ok(Some(format!("pat:{name}")));
    }
    if generator == "dots" {
        return Ok(Some(match o.str("lattice")? {
            Some("hex" | "hexagonal") => "dots_hex".into(),
            _ => "dots".into(),
        }));
    }
    if let Some(alias) = litho_alias(generator) {
        return Ok(Some(alias.into()));
    }
    let underscored = generator.replace('-', "_");
    if penfill::pattern::FILL_NAMES.contains(&underscored.as_str())
        || penfill::litho::BUILTIN.contains(&underscored.as_str())
    {
        return Ok(Some(underscored));
    }
    Ok(None)
}

fn litho_alias(generator: &str) -> Option<&'static str> {
    Some(match generator {
        "bentonite" => "benton",
        "granite-x" => "granite2",
        "breccia-blobs" => "breccia2",
        "conglomerate-flat" => "conglomerate2",
        "coarse-stone" => "coarse_stone",
        "mixed-rocks" => "mixed_rocks",
        "cracked-earth" => "cracked_earth",
        "chalky-soil" => "chalky_soil",
        "loose-soil" => "loose_soil",
        "compacted-soil" => "compacted_soil",
        "sandy-soil" => "sandy_soil",
        "mulched-soil" => "mulched_soil",
        "debris-soil" => "debris_soil",
        "grainy-soil" => "grainy_soil",
        "organic-topsoil" => "topsoil",
        "dry-cracked-soil" => "dry_cracked",
        "erosion-lines" => "erosion",
        "stone-cluster" => "stone_cluster",
        "gravelly-soil" => "gravelly_soil",
        "layered-soil" => "layered_soil",
        "pebbled-soil" => "pebbled_soil",
        "clay-soil" => "clay_soil",
        "silty-soil" => "silty_soil",
        "fine-gravel" => "fine_gravel",
        "pebble-scatter" => "pebble_scatter",
        "cell-net" => "cell_net",
        "fluid-grass" => "fluid_grass",
        "lily-pads" => "lily_pads",
        "doodle-trees" => "doodle_trees",
        "curl-waves" => "curl_waves",
        "flow-waves" => "flow_waves",
        "scallop-waves" => "scallop_waves",
        "gravel-clipped" => "gravel_clipped",
        "stipple-noise" => "stipple_noise",
        "stipple-edge" => "stipple_edge",
        "wave-grid" => "wave_grid",
        _ => return None,
    })
}

/// Gallery spacing multipliers so preset `spacing` still reads the same.
pub fn spacing_scale(generator: &str) -> f64 {
    match generator {
        "cell-net" => 2.2,
        "tufts" => 1.4,
        "twigs" => 2.0,
        "vines" => 1.8,
        "swells" => 1.05,
        "wave-grid" | "wave_grid" => 1.5,
        "stipple-noise" => 0.6,
        "stipple-edge" => 0.6,
        "pebbles" => 1.2,
        "sprouts" => 1.5,
        "fluid-grass" => 1.35,
        "lily-pads" => 1.4,
        "canopy" => 2.5,
        "gravel-clipped" => 2.5,
        "granite" | "granite-x" | "diorite" | "gabbro" | "brackets" => 1.2,
        "dacite" => 0.8,
        "feldspar" => 0.9,
        "arena" => 0.9,
        "breccia" => 2.2,
        "breccia-blobs" => 2.0,
        "shards" => 2.0,
        "conglomerate" | "conglomerate-flat" => 1.4,
        "drift" => 2.0,
        "beds" | "laminae" => 1.4,
        "coal" => 1.2,
        "gneiss" => 1.6,
        "bentonite" => 1.4,
        "masonry" | "ferrous" => 1.0,
        "amphibolite" => 1.6,
        "diatom" | "coquina" => 2.0,
        "diabase" => 0.6,
        "ophitic" => 0.9,
        "fine-gravel" => 1.5,
        "coarse-stone" | "mixed-rocks" => 1.6,
        "pebble-scatter" => 1.7,
        "cracked-earth" => 1.4,
        "grainy-soil" => 0.55,
        "erosion-lines" => 0.5,
        "stone-cluster" | "gravelly-soil" => 1.0,
        "mulch" => 0.7,
        "layered-soil" => 1.1,
        "pebbled-soil" => 0.85,
        "clay-soil" => 0.7,
        "silty-soil" => 2.0,
        "loose-soil" => 0.55,
        "compacted-soil" => 0.28,
        "sandy-soil" => 0.8,
        "chalky-soil" | "dry-cracked-soil" => 1.1,
        "mulched-soil" => 0.55,
        "organic-topsoil" => 1.4,
        "debris-soil" => 1.3,
        "fill" => 0.8,
        "lava" => 1.4,
        "hornblende" => 1.4,
        _ => 1.0,
    }
}

pub fn parse_edge(o: &Opts, default_spacing: f64) -> Result<EdgeMode, FillError> {
    match o.str("edge")?.unwrap_or("clip") {
        "clip" => Ok(EdgeMode::Clip),
        "inside" => Ok(EdgeMode::Inside),
        "overflow" => Ok(EdgeMode::Overflow(o.mm("overflow")?.unwrap_or(default_spacing * 0.4))),
        other => Err(o.bad("edge", format!("{other:?}: use clip, inside or overflow"))),
    }
}

pub fn fill_params(generator: &str, spec: &FillSpec, o: &Opts) -> Result<FillParams, FillError> {
    let s = spec.spacing.map_or(0.5, |m| m.0) * spacing_scale(generator);
    let a = spec.angle.unwrap_or_else(|| match generator {
        "rectilinear" | "zigzag" | "dots" => 45.0,
        "vines" => 90.0,
        _ => 0.0,
    });
    let seed = spec.seed.unwrap_or(0);
    let inset = spec.inset.map(|m| m.0);
    let fray = o.mm("fray")?.unwrap_or(0.0);
    let edge = parse_edge(o, s)?;
    let at = anchor(o)?;
    let mut params = FillParams::new(s.max(1e-6))
        .angle(a)
        .seed(seed)
        .anchor(at)
        .inset_opt(inset)
        .edge(edge)
        .fray(fray);
    if let Some(v) = o.num("coverage")? {
        params = params.custom("coverage", v);
    }
    if let Some(v) = o.num("slices")? {
        params = params.custom("slices", v);
    }
    if let Some(v) = o.num("jitter")? {
        params = params.custom("jitter", v);
    }
    if let Some(v) = match o.num("jitter_period")? {
        Some(v) => Some(v),
        None => o.num("period")?,
    } {
        params = params.custom("jitter_period", v);
    }
    if let Some(v) = o.num("ticks")? {
        params = params.custom("ticks", v);
    }
    if let Some(v) = o.mm("bubble")? {
        params = params.custom("bubble", v);
    }
    if let Some(v) = o.num("elongation")? {
        params = params.custom("elongation", v);
    }
    if let Some(v) = o.num("lobes")? {
        params = params.custom("lobes", v);
    }
    if let Some(v) = o.num("light")? {
        params = params.custom("light", v);
    }
    if let Some(v) = o.num("light_angle")? {
        params = params.custom("light_angle", v);
    }
    if let Some(v) = o.num("light_elevation")? {
        params = params.custom("light_elevation", v);
    }
    for key in ["wavelength", "curl", "turns", "stagger", "flip", "amplitude", "drift", "breaks", "depth", "round"] {
        if let Some(v) = o.num(key)? {
            params = params.custom(key, v);
        }
    }
    if let Some(v) = o.num("loops")? {
        params = params.custom("loops", v);
    }
    if let Some(v) = o.num("shadow")? {
        params = params.custom("shadow", v);
    }
    if let Some(v) = o.mm("hatch")? {
        params = params.custom("hatch", v);
    }
    Ok(params)
}

/// Run a registry pattern when [`registry_name`] resolves.
pub fn try_fill_by_name(
    region: &Region,
    generator: &str,
    spec: &FillSpec,
    o: &Opts,
) -> Result<Option<penfill::Strokes>, FillError> {
    let Some(name) = registry_name(generator, o)? else {
        return Ok(None);
    };
    let params = fill_params(generator, spec, o)?;
    if name == "dots" || name == "dots_hex" {
        let lattice = match o.str("lattice")? {
            Some("hex" | "hexagonal") => Lattice::Hexagonal,
            Some("square") | None => Lattice::Square,
            Some(other) => return Err(o.bad("lattice", format!("{other:?}: use square or hexagonal"))),
        };
        let mark = spec.mark.map(|m| m.0);
        let target = params.resolve_region(region, 0.0);
        return Ok(Some(fill_dots_params(&target, &params, mark, lattice).strokes));
    }
    Ok(fill_by_name(&name, region, &params))
}
