//! A `FillSpec` run over a region with penfill, and outline strokes.
//!
//! A region is a `geo` MultiPolygon in output mm; it becomes a penfill
//! `Region` here. A fill is either a named penfill generator or an SVG
//! `source` (host-provided text) cut to the region.

use crate::geom::{self, Lines};
use crate::profile::{FillSpec, StrokeSpec, StrokeStyle};
use crate::units::parse_length_mm;
use geo::{Coord, LineString, MultiPolygon, Polygon};
use penfill::dotswaves::Lattice;
use penfill::placement::Placement;
use penfill::svg::SvgDrawing;
use penfill::Region;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum FillError {
    #[error("unknown fill generator {0:?} (known: {known})", known = GENERATORS.join(", "))]
    UnknownGenerator(String),
    #[error("fill {generator:?}: option {key:?}: {msg}")]
    BadOption { generator: String, key: String, msg: String },
    #[error("fill source {0:?} was not provided")]
    MissingSource(String),
    #[error("fill source {file:?}: {msg}")]
    BadSource { file: String, msg: String },
    #[error("fill needs a generator or a source")]
    Nothing,
}

pub const GENERATORS: &[&str] = &[
    "rectilinear", "zigzag", "lines", "grid", "triangles", "honeycomb", "dots", "waves", "wave_grid",
    "scales", "sunburst", "spiral", "concentric", "hilbert", "stipple", "grass", "gravel", "scribble",
    "truchet", "marble", "wood", "cracks", "terrazzo", "chess", "pat", "none",
];

/// Parsed SVG sources by the file name the profile uses.
pub type Sources = BTreeMap<String, SvgDrawing>;

/// Polygons as penfill regions, one per nesting depth: `Region::from_polygons`
/// subtracts every hole from every outer, which would erase an island that
/// sits in another polygon's hole.
fn regions(mp: &MultiPolygon<f64>) -> Vec<Region> {
    let parts: Vec<&Polygon<f64>> = mp.0.iter().filter(|p| p.exterior().0.len() >= 4).collect();
    if parts.is_empty() {
        return vec![];
    }
    let depth: Vec<usize> = if parts.iter().any(|p| !p.interiors().is_empty()) {
        use geo::Contains;
        parts
            .iter()
            .map(|p| {
                let probe = geo::Point::from(p.exterior().0[0]);
                parts
                    .iter()
                    .flat_map(|q| q.interiors())
                    .filter(|hole| Polygon::new((*hole).clone(), vec![]).contains(&probe))
                    .count()
            })
            .collect()
    } else {
        vec![0; parts.len()]
    };
    let max = depth.iter().copied().max().unwrap_or(0);
    (0..=max)
        .map(|d| {
            let polys: Vec<Vec<Vec<(f64, f64)>>> = parts
                .iter()
                .zip(&depth)
                .filter(|(_, &pd)| pd == d)
                .map(|(p, _)| {
                    std::iter::once(p.exterior())
                        .chain(p.interiors())
                        .map(|ring| ring.0.iter().map(|c| (c.x, c.y)).collect())
                        .collect()
                })
                .collect();
            Region::from_polygons(&polys)
        })
        .filter(|r| !r.is_empty())
        .collect()
}

fn to_lines(strokes: penfill::Strokes) -> Lines {
    strokes
        .into_iter()
        .filter(|s| s.len() >= 2)
        .map(|s| LineString::new(s.into_iter().map(|(x, y)| Coord { x, y }).collect()))
        .collect()
}

struct Opts<'a> {
    generator: &'a str,
    options: &'a BTreeMap<String, Value>,
}

impl Opts<'_> {
    fn bad(&self, key: &str, msg: impl Into<String>) -> FillError {
        FillError::BadOption { generator: self.generator.into(), key: key.into(), msg: msg.into() }
    }

    fn mm(&self, key: &str) -> Result<Option<f64>, FillError> {
        match self.options.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(n)) => Ok(n.as_f64()),
            Some(Value::String(s)) => parse_length_mm(s).map(Some).map_err(|e| self.bad(key, e)),
            Some(_) => Err(self.bad(key, "expected a length")),
        }
    }

    fn str(&self, key: &str) -> Result<Option<&str>, FillError> {
        match self.options.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s)),
            Some(_) => Err(self.bad(key, "expected a string")),
        }
    }

    fn point(&self, key: &str) -> Result<Option<(f64, f64)>, FillError> {
        match self.options.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Array(a)) if a.len() == 2 => match (a[0].as_f64(), a[1].as_f64()) {
                (Some(x), Some(y)) => Ok(Some((x, y))),
                _ => Err(self.bad(key, "expected [x, y] in mm")),
            },
            Some(_) => Err(self.bad(key, "expected [x, y] in mm")),
        }
    }
}

fn default_angle(generator: &str) -> f64 {
    match generator {
        "rectilinear" | "zigzag" | "dots" => 45.0,
        _ => 0.0,
    }
}

/// Where the pattern's lattice sits. Global by default: one lattice for the
/// whole output, so neighbouring areas filled alike (wood next to grass) don't
/// show where one ends. A sunburst is the one pattern centred on its shape.
fn anchor(o: &Opts) -> Result<penfill::Anchor, FillError> {
    use penfill::{Anchor, Origin};
    let (x, y) = o.point("shift")?.unwrap_or((0.0, 0.0));
    if let Some(c) = o.point("centre")?.or(o.point("center")?) {
        return Ok(Anchor::global(c.0 + x, c.1 + y));
    }
    let origin = match o.str("anchor")? {
        Some("global") => Origin::Global,
        Some("local") => Origin::Local,
        Some(other) => return Err(o.bad("anchor", format!("{other:?}: use global or local"))),
        None if o.generator == "sunburst" => Origin::Local,
        None => Origin::Global,
    };
    Ok(Anchor { origin, shift: (x, y) })
}

/// Generators that take the inset themselves; for the rest an explicit
/// `inset` shrinks the region first.
fn insets_natively(generator: &str) -> bool {
    matches!(generator, "rectilinear" | "zigzag" | "concentric" | "hilbert")
}

fn run_generator(region: &Region, generator: &str, spec: &FillSpec) -> Result<penfill::Strokes, FillError> {
    use penfill::*;
    let o = Opts { generator, options: &spec.options };
    let s = spec.spacing.map_or(0.5, |m| m.0);
    let a = spec.angle.unwrap_or_else(|| default_angle(generator));
    let seed = spec.seed.unwrap_or(0);
    // Waves sit under their own outline, with a hair of clearance.
    let inset = spec.inset.map(|m| m.0).or((generator == "waves").then_some(0.1));
    let shrunk;
    let r = if !insets_natively(generator) && inset.is_some_and(|i| i > 0.0) {
        shrunk = region.inset(inset.unwrap());
        &shrunk
    } else {
        region
    };
    let mark = |default: f64| spec.mark.map_or(default, |m| m.0);
    let at = anchor(&o)?;
    Ok(match generator {
        "rectilinear" => rectilinear::fill_rectilinear(r, s, a, inset, at),
        "zigzag" => zigzag::fill_zigzag_inset(r, s, a, inset, at),
        "lines" => grid::fill_lines(r, s, a, at),
        "grid" => grid::fill_grid(r, s, a, at),
        "triangles" => grid::fill_triangles(r, s, a, at),
        "honeycomb" => honeycomb::fill_honeycomb(r, s, a, o.mm("line_width")?.unwrap_or(0.0), at),
        "dots" => {
            let lattice = match o.str("lattice")?.unwrap_or("square") {
                "square" => Lattice::Square,
                "hex" | "hexagonal" => Lattice::Hexagonal,
                other => return Err(o.bad("lattice", format!("{other:?}: use square or hexagonal"))),
            };
            dotswaves::fill_dots_with_lattice(r, s, a, mark(0.2), lattice, at)
        }
        "waves" => dotswaves::fill_waves(r, s, a, at),
        "wave_grid" => dotswaves::fill_wave_grid(r, s, a, at),
        "scales" => scales::fill_scales(r, s, a, at),
        "sunburst" => radial::fill_sunburst(r, s, a, at),
        "spiral" => spiral::fill_spiral(r, s),
        "concentric" => concentric::fill_concentric(r, s, inset),
        "hilbert" => hilbert::fill_hilbert(r, s, inset),
        "stipple" => stipple::fill_stipple(r, s, mark(0.2), seed),
        "grass" => grass::fill_grass(r, s, a, seed, at),
        "gravel" => gravel::fill_gravel(r, s, seed),
        "scribble" => scribble::fill_scribble(r, s, a, seed),
        "truchet" => truchet::fill_truchet(r, s, a, seed, at),
        "marble" => textures::fill_marble(r, s, a, seed, at),
        "wood" => textures::fill_wood(r, s, a, seed, at),
        "cracks" => textures::fill_cracks(r, s, seed),
        "terrazzo" => terrazzo::fill_terrazzo(r, s, o.mm("hatch")?.unwrap_or(s / 6.0), seed),
        "chess" => chess::fill_chess(r, o.mm("cell")?.unwrap_or(s * 8.0), s, a, at),
        "pat" => {
            let name = o.str("name")?.ok_or_else(|| o.bad("name", "pat needs a pattern name"))?;
            let pattern = pat::builtin(name)
                .ok_or_else(|| o.bad("name", format!("{name:?}: known {}", pat::BUILTIN.join(", "))))?;
            pat::fill_pat(r, &pattern, o.mm("scale")?.unwrap_or(s), a, at)
        }
        "none" => vec![],
        other => return Err(FillError::UnknownGenerator(other.into())),
    })
}

fn run_source(region: &Region, spec: &FillSpec, sources: &Sources) -> Result<penfill::Strokes, FillError> {
    let src = spec.source.as_ref().ok_or(FillError::Nothing)?;
    let drawing = sources.get(&src.file).ok_or_else(|| FillError::MissingSource(src.file.clone()))?;
    if src.size.is_none() && src.position.is_none() && src.repeat.is_none() {
        return Ok(region.clip_strokes(&drawing.strokes));
    }
    let placement = Placement::parse(
        src.size.as_deref().unwrap_or("cover"),
        src.position.as_deref().unwrap_or("center"),
        src.repeat.as_deref().unwrap_or("no-repeat"),
    )
    .map_err(|msg| FillError::BadSource { file: src.file.clone(), msg })?;
    Ok(penfill::svg::fill_svg_placed(region, drawing, &placement))
}

/// Check a spec before any geometry work, so a typo fails fast.
pub fn validate(spec: &FillSpec, sources: &Sources) -> Result<(), FillError> {
    if let Some(src) = &spec.source {
        if !sources.contains_key(&src.file) {
            return Err(FillError::MissingSource(src.file.clone()));
        }
        return Ok(());
    }
    let generator = spec.generator.as_deref().ok_or(FillError::Nothing)?;
    if !GENERATORS.contains(&generator) {
        return Err(FillError::UnknownGenerator(generator.into()));
    }
    let empty = Region::default();
    run_generator(&empty, generator, spec).map(|_| ())
}

/// Fill `region` (output mm) as `spec` says.
pub fn fill(region: &MultiPolygon<f64>, spec: &FillSpec, sources: &Sources) -> Result<Lines, FillError> {
    let mut out = Vec::new();
    for r in regions(region) {
        let strokes = match (&spec.source, spec.generator.as_deref()) {
            (Some(_), _) => run_source(&r, spec, sources)?,
            (None, Some(g)) => run_generator(&r, g, spec)?,
            (None, None) => return Err(FillError::Nothing),
        };
        out.extend(to_lines(strokes));
    }
    Ok(out)
}

/// Outline lines drawn as the stroke says (solid, dashed, dotted, or not at all).
pub fn stroke(lines: Lines, spec: &StrokeSpec) -> Lines {
    match spec.style.unwrap_or_default() {
        StrokeStyle::Solid => lines,
        StrokeStyle::None => vec![],
        StrokeStyle::Dash => {
            let (dash, gap) = (spec.dash.map_or(0.45, |m| m.0), spec.gap.map_or(0.40, |m| m.0));
            lines.iter().flat_map(|l| geom::dash_line(l, dash, gap)).collect()
        }
        StrokeStyle::Dotted => {
            let mark = spec.mark.or(spec.dash).map_or(0.15, |m| m.0);
            let gap = spec.gap.map_or(mark, |m| m.0);
            lines.iter().flat_map(|l| geom::dash_line(l, mark, gap)).collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::units::Mm;
    use geo::polygon;

    fn square_with_island() -> MultiPolygon<f64> {
        let outer = polygon!(
            exterior: [(x: 0.0, y: 0.0), (x: 10.0, y: 0.0), (x: 10.0, y: 10.0), (x: 0.0, y: 10.0)],
            interiors: [[(x: 2.0, y: 2.0), (x: 8.0, y: 2.0), (x: 8.0, y: 8.0), (x: 2.0, y: 8.0)]],
        );
        let island = polygon![(x: 4.0, y: 4.0), (x: 6.0, y: 4.0), (x: 6.0, y: 6.0), (x: 4.0, y: 6.0)];
        MultiPolygon::new(vec![outer, island])
    }

    #[test]
    fn islands_in_holes_are_filled() {
        let spec = FillSpec { generator: Some("lines".into()), ..FillSpec::spacing(0.5) };
        let lines = fill(&square_with_island(), &spec, &Sources::new()).unwrap();
        let in_island = lines.iter().any(|l| l.0.iter().all(|c| (4.0..=6.0).contains(&c.x) && (4.0..=6.0).contains(&c.y)));
        assert!(in_island);
    }

    #[test]
    fn areas_side_by_side_share_one_lattice() {
        let rect = |x0: f64, x1: f64| MultiPolygon::new(vec![polygon![(x: x0, y: 0.0), (x: x1, y: 0.0), (x: x1, y: 12.0), (x: x0, y: 12.0)]]);
        let ink = |spec: &FillSpec, m: &MultiPolygon<f64>| -> f64 { fill(m, spec, &Sources::new()).unwrap().iter().map(geom::line_length).sum() };
        for generator in ["dots", "lines", "grid", "waves", "honeycomb"] {
            let mut spec = FillSpec { generator: Some(generator.into()), inset: Some(Mm(0.0)), ..FillSpec::spacing(0.7) };
            // off the outer walls: a line lying on one is a toss-up for the clip
            spec.options.insert("shift".into(), serde_json::json!([0.3, -0.2]));
            let (whole, halves) = (ink(&spec, &rect(0.0, 20.0)), ink(&spec, &rect(0.0, 8.3)) + ink(&spec, &rect(8.3, 20.0)));
            assert!((whole - halves).abs() < 1e-3 * whole, "{generator}: {whole} vs {halves}");
        }
    }

    #[test]
    fn anchor_must_be_global_or_local() {
        let mut spec = FillSpec { generator: Some("dots".into()), ..FillSpec::spacing(0.5) };
        spec.options.insert("anchor".into(), "page".into());
        assert!(matches!(validate(&spec, &Sources::new()), Err(FillError::BadOption { .. })));
        spec.options.insert("anchor".into(), "local".into());
        spec.options.insert("shift".into(), serde_json::json!([0.2, 0.1]));
        assert!(validate(&spec, &Sources::new()).is_ok());
    }

    #[test]
    fn unknown_generator_is_an_error() {
        let spec = FillSpec { generator: Some("zigzog".into()), ..FillSpec::default() };
        assert!(matches!(validate(&spec, &Sources::new()), Err(FillError::UnknownGenerator(_))));
    }

    #[test]
    fn source_is_clipped_to_the_region() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><line x1="-5" y1="5" x2="25" y2="5"/></svg>"#;
        let mut sources = Sources::new();
        sources.insert("a.svg".into(), penfill::svg::parse_svg(svg).unwrap());
        let spec = FillSpec {
            source: Some(crate::profile::SourceSpec { file: "a.svg".into(), size: None, position: None, repeat: None }),
            ..FillSpec::default()
        };
        let sq = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 10.0, y: 0.0), (x: 10.0, y: 10.0), (x: 0.0, y: 10.0)]]);
        let lines = fill(&sq, &spec, &sources).unwrap();
        let total: f64 = lines.iter().map(geom::line_length).sum();
        assert!((total - 10.0).abs() < 1e-3, "{total}");
    }
}
