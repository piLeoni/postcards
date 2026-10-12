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
    "amphibolite", "arena", "beds", "bentonite", "brackets", "breccia", "breccia-blobs", "canopy", "chalky-soil",
    "chess", "clay-soil", "coal", "coarse-stone", "compacted-soil", "concentric", "conglomerate",
    "conglomerate-flat", "coquina", "cracked-earth", "cracks", "dacite", "debris-soil", "diabase", "diatom",
    "diorite", "dots", "drift", "dry-cracked-soil", "erosion-lines", "feldspar", "ferrous", "fill", "fine-gravel",
    "fluid-grass", "gabbro", "gneiss", "grainy-soil", "granite", "granite-x", "grass", "gravel", "gravel-clipped",
    "gravelly-soil", "grid", "growth", "hilbert", "honeycomb", "hornblende", "isoline-blobs", "isoline-stack", "laminae", "lava", "layered-soil", "lily-pads",
    "lines", "loose-soil", "marble", "masonry", "mixed-rocks", "mulch", "mulched-soil", "none", "ophitic",
    "organic-topsoil", "pat", "pebble-scatter", "pebbled-soil", "pebbles", "rectilinear", "sandy-soil", "scales",
    "scribble", "shards", "silty-soil", "solid", "spiral", "sprouts", "stipple", "stipple-edge", "stipple-noise",
    "stone-cluster", "sunburst", "terrazzo", "triangles", "truchet", "wave-grid", "wave_grid", "waves", "wood",
    "zigzag",
];

/// Flat colour fill (SVG `fill`, no pen strokes). Colour comes from the draw
/// entry's `stroke.color`, like hatch ink.
pub fn is_solid(spec: &FillSpec) -> bool {
    spec.source.is_none() && spec.generator.as_deref() == Some("solid")
}

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

    fn num(&self, key: &str) -> Result<Option<f64>, FillError> {
        match self.options.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(n)) => Ok(n.as_f64()),
            Some(_) => Err(self.bad(key, "expected a number")),
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

/// The spacing a fill will run at, in mm, without running it: what the cost
/// estimate needs. `None` when the spec sets none and the generator has no
/// fixed default worth guessing.
pub fn spacing_mm(spec: &FillSpec) -> Option<f64> {
    spec.spacing.map(|m| m.0).or_else(|| {
        let generator = spec.generator.as_deref()?;
        matches!(generator, "dots" | "waves" | "zigzag" | "rectilinear" | "lines" | "grid").then_some(0.5)
    })
}

/// Whether `generator` hands its strokes on a row at a time rather than all
/// at the end: for these a fill's memory does not grow with its area.
pub fn streams(generator: &str) -> bool {
    matches!(generator, "rectilinear" | "lines" | "grid" | "dots" | "waves")
}

fn run_generator(region: &Region, generator: &str, spec: &FillSpec) -> Result<penfill::Strokes, FillError> {
    let mut out = Vec::new();
    run_generator_into(region, generator, spec, &mut out)?;
    Ok(out)
}

fn run_generator_into(region: &Region, generator: &str, spec: &FillSpec, sink: &mut dyn penfill::Sink) -> Result<(), FillError> {
    use penfill::*;
    let o = Opts { generator, options: &spec.options };
    let s = spec.spacing.map_or(0.5, |m| m.0);
    let a = spec.angle.unwrap_or_else(|| default_angle(generator));
    let seed = spec.seed.unwrap_or(0);
    // Waves sit under their own outline, with a hair of clearance.
    let inset = spec.inset.map(|m| m.0).or((generator == "waves").then_some(0.1));
    let shrunk = prepared(region, spec);
    let r = &shrunk;
    let mark = |default: f64| spec.mark.map_or(default, |m| m.0);
    let at = anchor(&o)?;
    // The generators that stream hand their rows to `sink` themselves; the
    // rest make the whole fill and pass it on at the end.
    match generator {
        "rectilinear" => rectilinear::fill_rectilinear_into(r, s, a, inset, at, sink),
        "lines" => grid::fill_lines_into(r, s, a, at, sink),
        "grid" => grid::fill_grid_into(r, s, a, at, sink),
        "dots" => {
            let lattice = match o.str("lattice")?.unwrap_or("square") {
                "square" => Lattice::Square,
                "hex" | "hexagonal" => Lattice::Hexagonal,
                other => return Err(o.bad("lattice", format!("{other:?}: use square or hexagonal"))),
            };
            dotswaves::fill_dots_with_lattice_into(r, s, a, mark(0.2), lattice, at, sink);
        }
        "waves" => dotswaves::fill_waves_into(r, s, a, at, sink),
        _ => {}
    }
    if streams(generator) {
        return Ok(());
    }
    let whole = match generator {
        "zigzag" => zigzag::fill_zigzag_inset(r, s, a, inset, at),
        "triangles" => grid::fill_triangles(r, s, a, at),
        "honeycomb" => honeycomb::fill_honeycomb(r, s, a, o.mm("line_width")?.unwrap_or(0.0), at),
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
        "isoline-blobs" | "isoline-stack" => covering(r, spec, true)?.strokes,
        "growth" => {
            use penfill::growth::{fill_growth, GrowthParams, RootSource};
            // `spacing` is the gap between twigs; attractors sit ~2.5× closer.
            let a = s * 0.4;
            let roots = match o.num("roots")? {
                Some(n) => RootSource::Generate(n.max(0.0) as usize),
                None => RootSource::Every(o.mm("root_spacing")?.unwrap_or(s * 12.0)),
            };
            let params = GrowthParams {
                seed,
                roots,
                spacing: a,
                step: o.mm("step")?.unwrap_or(a * 0.4),
                reach: o.mm("reach")?.unwrap_or(a * 8.0),
                kill: o.mm("kill")?.unwrap_or(a),
                jitter: o.num("jitter")?.unwrap_or(0.1),
                max_steps: o.num("max_steps")?.map_or(20_000, |n| n.max(0.0) as usize),
                pen: o.mm("line_width")?.unwrap_or(0.15),
                max_passes: o.num("trunk")?.map_or(3, |n| n.max(0.0) as usize),
                ..GrowthParams::default()
            };
            fill_growth(r, &params)
        }
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
        "none" | "solid" => vec![],
        other => match crate::fill_extra::run(other, r, s, a, seed, at) {
            Some(whole) => whole,
            None => return Err(FillError::UnknownGenerator(other.into())),
        },
    };
    sink.batch(whole);
    Ok(())
}

/// Generators that know what they cover, which may be less (clearings) or
/// more (overflow) than the area they are given.
fn covers(generator: &str) -> bool {
    matches!(generator, "isoline-blobs" | "isoline-stack")
}

thread_local! {
    /// Runs made for a [`cover`], kept until the fill pass draws them, so a
    /// footprint and its lines are one run, not two.
    static COVERED: std::cell::RefCell<std::collections::HashMap<u64, penfill::FillWithCoverage>> =
        Default::default();
}

fn run_key(region: &Region, spec: &FillSpec) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(spec).unwrap_or_default().hash(&mut h);
    for ring in region.all_rings_mm() {
        ring.len().hash(&mut h);
        for (x, y) in ring {
            x.to_bits().hash(&mut h);
            y.to_bits().hash(&mut h);
        }
    }
    h.finish()
}

/// A covering generator's lines and footprint on `r`. `take` hands over a
/// run a cover kept; otherwise the run is kept for the fill that follows.
fn covering(r: &Region, spec: &FillSpec, take: bool) -> Result<penfill::FillWithCoverage, FillError> {
    let key = run_key(r, spec);
    if let Some(kept) = COVERED.with(|c| if take { c.borrow_mut().remove(&key) } else { c.borrow().get(&key).cloned() }) {
        return Ok(kept);
    }
    let generator = spec.generator.as_deref().unwrap_or_default();
    let o = Opts { generator, options: &spec.options };
    let s = spec.spacing.map_or(0.5, |m| m.0);
    let seed = spec.seed.unwrap_or(0);
    let run = match generator {
        "isoline-blobs" => {
            let params = penfill::IsolineFieldParams {
                seed,
                source: penfill::FieldSource::Noise,
                feature_size: s,
                contour_spacing: o.mm("contour")?.unwrap_or(s * 0.045),
                warp: o.num("warp")?.unwrap_or(0.45),
                threshold: o.num("threshold")?.unwrap_or(0.25),
            };
            penfill::fill_isoline_blobs_with_coverage(r, &params)
        }
        "isoline-stack" => {
            use penfill::isoline_stack::{fill_isoline_stack_with_coverage, CrownSource, EdgeMode, IsolineStackParams};
            let edge = match o.str("edge")?.unwrap_or("clip") {
                "clip" => EdgeMode::Clip,
                "inside" => EdgeMode::Inside,
                "overflow" => EdgeMode::Overflow(o.mm("overflow")?.unwrap_or(s * 0.4)),
                other => return Err(o.bad("edge", format!("{other:?}: use clip, inside or overflow"))),
            };
            let light = match o.num("light")?.filter(|s| *s > 0.0) {
                Some(strength) => Some(penfill::isoline_stack::Light {
                    from_deg: o.num("light_angle")?.unwrap_or(0.0),
                    strength,
                    elevation_deg: o.num("light_elevation")?.unwrap_or(35.0),
                    hatch: o.mm("hatch")?.unwrap_or(0.4),
                }),
                None => None,
            };
            let params = IsolineStackParams {
                seed,
                crowns: CrownSource::Generate,
                crown: s,
                bubble: o.mm("bubble")?.unwrap_or(s * 0.3),
                coverage: o.num("coverage")?.unwrap_or(0.6),
                slices: o.num("slices")?.map_or(14, |n| n.clamp(1.0, 64.0) as usize),
                jitter: o.num("jitter")?.unwrap_or(0.8),
                edge,
                light,
            };
            fill_isoline_stack_with_coverage(r, &params)
        }
        other => unreachable!("{other} does not report coverage"),
    };
    if !take && !r.is_empty() {
        COVERED.with(|c| c.borrow_mut().insert(key, run.clone()));
    }
    Ok(run)
}

/// Drop cached isoline runs from the last draw (call at the start of each map).
pub fn clear_cover_cache() {
    COVERED.with(|c| c.borrow_mut().clear());
}

/// One OSM forest polygon per region for covering fills: one huge bounding
/// box over every patch is what made `fills.cover` take tens of seconds.
fn work_regions(mp: &MultiPolygon<f64>, spec: &FillSpec) -> Vec<Region> {
    if !spec.generator.as_deref().is_some_and(covers) || mp.0.len() <= 1 {
        return regions(mp);
    }
    mp.0
        .iter()
        .filter(|p| p.exterior().0.len() >= 4)
        .map(|p| {
            let polys: Vec<Vec<Vec<(f64, f64)>>> = vec![std::iter::once(p.exterior())
                .chain(p.interiors())
                .map(|ring| ring.0.iter().map(|c| (c.x, c.y)).collect())
                .collect()];
            Region::from_polygons(&polys)
        })
        .filter(|r| !r.is_empty())
        .collect()
}

/// What a fill of `region` covers on paper: for most patterns the area
/// itself; for those that leave clearings or spill over, their footprint.
/// What `fills.cover` masks other layers with.
pub fn cover(region: &MultiPolygon<f64>, spec: &FillSpec) -> Result<MultiPolygon<f64>, FillError> {
    if spec.source.is_some() || !spec.generator.as_deref().is_some_and(covers) {
        return Ok(region.clone());
    }
    let mut parts = Vec::new();
    for r in work_regions(region, spec) {
        let r = prepared(&r, spec);
        for part in covering(&r, spec, false)?.coverage.parts() {
            let mut rings = part.all_rings_mm().into_iter().map(|ring| {
                let mut cs: Vec<Coord<f64>> = ring.into_iter().map(|(x, y)| Coord { x, y }).collect();
                if cs.first() != cs.last() {
                    cs.push(cs[0]);
                }
                LineString::new(cs)
            });
            if let Some(outer) = rings.next() {
                parts.push(MultiPolygon(vec![Polygon::new(outer, rings.collect())]));
            }
        }
    }
    Ok(geom::union_multi(&parts))
}

/// `region` shrunk by the spec's `inset`, for generators that don't take
/// one themselves.
fn prepared(region: &Region, spec: &FillSpec) -> Region {
    let generator = spec.generator.as_deref().unwrap_or_default();
    let inset = spec.inset.map(|m| m.0).or((generator == "waves").then_some(0.1));
    match inset {
        Some(i) if !insets_natively(generator) && i > 0.0 => region.inset(i),
        _ => region.clone(),
    }
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
/// Region to paint for a solid fill, with mask areas subtracted.
pub fn solid_regions(area: &MultiPolygon<f64>, mask: &MultiPolygon<f64>) -> MultiPolygon<f64> {
    if mask.0.is_empty() {
        return area.clone();
    }
    geom::difference(area, mask)
}

pub fn validate(spec: &FillSpec, sources: &Sources) -> Result<(), FillError> {
    if let Some(src) = &spec.source {
        if !sources.contains_key(&src.file) {
            return Err(FillError::MissingSource(src.file.clone()));
        }
        return Ok(());
    }
    let generator = spec.generator.as_deref().ok_or(FillError::Nothing)?;
    if generator == "solid" {
        return Ok(());
    }
    if !GENERATORS.contains(&generator) {
        return Err(FillError::UnknownGenerator(generator.into()));
    }
    let empty = Region::default();
    run_generator(&empty, generator, spec).map(|_| ())
}

/// Fill `region` (output mm) as `spec` says.
pub fn fill(region: &MultiPolygon<f64>, spec: &FillSpec, sources: &Sources) -> Result<Lines, FillError> {
    let mut out = Vec::new();
    fill_into(region, spec, sources, &mut out)?;
    Ok(to_lines(out))
}

/// [`fill`], handing the strokes to `sink` as they are made instead of
/// keeping them.
pub fn fill_into(region: &MultiPolygon<f64>, spec: &FillSpec, sources: &Sources, sink: &mut dyn penfill::Sink) -> Result<(), FillError> {
    for r in work_regions(region, spec) {
        match (&spec.source, spec.generator.as_deref()) {
            (Some(_), _) => sink.batch(run_source(&r, spec, sources)?),
            (None, Some(g)) => run_generator_into(&r, g, spec, sink)?,
            (None, None) => return Err(FillError::Nothing),
        }
    }
    Ok(())
}

/// `content` cut to `region`: lines made elsewhere used as the fill's pattern.
pub fn fill_with(region: &MultiPolygon<f64>, content: &[LineString<f64>]) -> Lines {
    let strokes: penfill::Strokes =
        content.iter().map(|l| l.0.iter().map(|c| (c.x, c.y)).collect()).collect();
    regions(region).iter().flat_map(|r| to_lines(r.clip_strokes(&strokes))).collect()
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
    fn cover_is_the_footprint_and_its_run_feeds_the_fill() {
        use geo::Area;
        let sq = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 60.0, y: 0.0), (x: 60.0, y: 60.0), (x: 0.0, y: 60.0)]]);
        let mut spec = FillSpec { generator: Some("isoline-stack".into()), ..FillSpec::spacing(5.0) };
        spec.options.insert("coverage".into(), serde_json::json!(0.4));
        let fresh = fill(&sq, &spec, &Sources::new()).unwrap();
        let footprint = cover(&sq, &spec).unwrap();
        let a = footprint.unsigned_area();
        assert!(a > 0.0 && a < 0.95 * 3600.0, "clearings stay out of the footprint: {a}");
        assert_eq!(fill(&sq, &spec, &Sources::new()).unwrap(), fresh);
        let dots = FillSpec { generator: Some("dots".into()), ..FillSpec::spacing(1.0) };
        assert_eq!(cover(&sq, &dots).unwrap(), sq);
    }

    #[test]
    fn isoline_stack_edge_modes() {
        let sq = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 40.0, y: 0.0), (x: 40.0, y: 40.0), (x: 0.0, y: 40.0)]]);
        let run = |edge: &str| {
            let mut spec = FillSpec { generator: Some("isoline-stack".into()), ..FillSpec::spacing(5.0) };
            spec.options.insert("edge".into(), edge.into());
            spec.options.insert("coverage".into(), serde_json::json!(1.0));
            fill(&sq, &spec, &Sources::new()).unwrap()
        };
        let out_of = |lines: &Lines| lines.iter().flat_map(|l| l.0.iter()).filter(|c| c.x < 0.0 || c.y < 0.0 || c.x > 40.0 || c.y > 40.0).count();
        assert_eq!(out_of(&run("inside")), 0);
        assert!(out_of(&run("overflow")) > 0, "overflow stays in");
        let mut bad = FillSpec { generator: Some("isoline-stack".into()), ..FillSpec::spacing(5.0) };
        bad.options.insert("edge".into(), "bleed".into());
        assert!(matches!(validate(&bad, &Sources::new()), Err(FillError::BadOption { .. })));
    }

    #[test]
    fn growth_branches_inside_the_region() {
        let sq = MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: 60.0, y: 0.0), (x: 60.0, y: 60.0), (x: 0.0, y: 60.0)]]);
        let spec = FillSpec { generator: Some("growth".into()), seed: Some(3), ..FillSpec::spacing(3.0) };
        let lines = fill(&sq, &spec, &Sources::new()).unwrap();
        assert!(lines.len() > 20, "only {} segments", lines.len());
        for l in &lines {
            for c in &l.0 {
                assert!(c.x >= 0.0 && c.x <= 60.0 && c.y >= 0.0 && c.y <= 60.0, "{c:?} outside");
            }
        }
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
