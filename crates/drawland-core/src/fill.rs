//! A `FillSpec` run over a region with penfill's catalogue, and outline strokes.
//!
//! A region is a `geo` MultiPolygon in output mm; it becomes a penfill
//! `Region` here. A fill is a pattern from penfill's catalogue (a material
//! such as `gravel`, or a generator such as `scatter` with every option open)
//! or an SVG `source` (host-provided text) cut to the region.
//!
//! The catalogue owns the patterns: their names, their options, their
//! defaults and the checks on them. This module only translates a profile's
//! options into the catalogue's terms (lengths to millimetres, point lists to
//! polylines, `anchor` / `edge` / `fray` to penfill's own types) and keeps the
//! things that are draw.land's: SVG sources, flat colour, and the cache that
//! lets `fills.cover` and the fill share one run.

use crate::geom::{self, Lines};
use crate::profile::{FillSpec, StrokeSpec, StrokeStyle};
use crate::units::parse_length_mm;
use geo::{Coord, LineString, MultiPolygon, Polygon};
use penfill::catalog::{self, CatalogError, Spec, Value as Pv};
use penfill::pattern::EdgeMode;
use penfill::placement::Placement;
use penfill::svg::SvgDrawing;
use penfill::Region;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum FillError {
    /// The catalogue's own message: what is wrong and what it takes.
    #[error("{0}")]
    Catalog(CatalogError),
    #[error("fill {generator:?}: option {key:?}: {msg}")]
    BadOption { generator: String, key: String, msg: String },
    #[error("fill source {0:?} was not provided")]
    MissingSource(String),
    #[error("fill source {file:?}: {msg}")]
    BadSource { file: String, msg: String },
    #[error("fill needs a pattern or a source")]
    Nothing,
}

impl From<CatalogError> for FillError {
    fn from(e: CatalogError) -> FillError {
        FillError::Catalog(e)
    }
}

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
pub(crate) fn regions(mp: &MultiPolygon<f64>) -> Vec<Region> {
    let parts: Vec<&Polygon<f64>> = mp.0.iter().filter(|p| p.exterior().0.len() >= 4).collect();
    if parts.is_empty() {
        return vec![];
    }
    let depth: Vec<usize> = if parts.iter().any(|p| !p.interiors().is_empty()) {
        use geo::{BoundingRect, Contains};
        let holes: Vec<(usize, geo::Rect<f64>, Polygon<f64>)> = parts
            .iter()
            .enumerate()
            .flat_map(|(qi, q)| {
                q.interiors().iter().filter_map(move |h| {
                    let b = h.bounding_rect()?;
                    Some((qi, b, Polygon::new(h.clone(), vec![])))
                })
            })
            .collect();
        parts
            .iter()
            .enumerate()
            .map(|(pi, p)| {
                let c = p.exterior().0[0];
                let probe = geo::Point::from(c);
                holes
                    .iter()
                    .filter(|(qi, b, hp)| {
                        *qi != pi
                            && c.x >= b.min().x
                            && c.x <= b.max().x
                            && c.y >= b.min().y
                            && c.y <= b.max().y
                            && hp.contains(&probe)
                    })
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
                .map(|(p, _)| polygon_rings(p))
                .collect();
            Region::from_polygons(&polys)
        })
        .filter(|r| !r.is_empty())
        .collect()
}

fn polygon_rings(p: &Polygon<f64>) -> Vec<Vec<(f64, f64)>> {
    std::iter::once(p.exterior()).chain(p.interiors()).map(|ring| ring.0.iter().map(|c| (c.x, c.y)).collect()).collect()
}

fn to_lines(strokes: penfill::Strokes) -> Lines {
    strokes
        .into_iter()
        .filter(|s| s.len() >= 2)
        .map(|s| LineString::new(s.into_iter().map(|(x, y)| Coord { x, y }).collect()))
        .collect()
}

// ---------------------------------------------------------------------------
// A profile's fill options, in the catalogue's terms
// ---------------------------------------------------------------------------

/// The pattern name and the catalogue spec a `FillSpec` asks for.
pub(crate) fn catalog_spec(spec: &FillSpec) -> Result<(String, Spec), FillError> {
    let name = spec.generator.clone().ok_or(FillError::Nothing)?;
    let bad = |key: &str, msg: String| FillError::BadOption { generator: name.clone(), key: key.into(), msg };
    let mut out = Spec {
        spacing: spec.spacing.map(|m| m.0),
        angle: spec.angle,
        seed: spec.seed.unwrap_or(0),
        inset: spec.inset.map(|m| m.0),
        ..Spec::default()
    };
    if let Some(m) = spec.mark {
        out.options.set("mark", m.0);
    }
    // Where the lattice sits. Global by default: one lattice for the whole
    // output, so neighbouring areas filled alike don't show where one ends.
    let mut shift = (0.0, 0.0);
    let mut origin = penfill::Origin::Global;
    let mut overflow = None;
    let mut edge = None;
    for (key, value) in &spec.options {
        match key.as_str() {
            "anchor" => {
                origin = match value.as_str() {
                    Some("global") => penfill::Origin::Global,
                    Some("local") => penfill::Origin::Local,
                    _ => return Err(bad(key, format!("{value}: use \"global\" or \"local\""))),
                }
            }
            "shift" => shift = point(value).ok_or_else(|| bad(key, "expected [across, down] in mm".into()))?,
            "fray" => out.fray = length(value).ok_or_else(|| bad(key, "expected a length".into()))?,
            "edge" => edge = Some(value.as_str().ok_or_else(|| bad(key, "use \"clip\", \"inside\" or \"overflow\"".into()))?.to_string()),
            "overflow" => overflow = Some(length(value).ok_or_else(|| bad(key, "expected a length".into()))?),
            _ => {
                let v = option_value(value).ok_or_else(|| bad(key, format!("{value} is not a number, a length, a word, a list of them, or polylines")))?;
                out.options.set(key, v);
            }
        }
    }
    out.anchor = penfill::Anchor { origin, shift };
    out.edge = match edge.as_deref() {
        None => None,
        Some("clip") => Some(EdgeMode::Clip),
        Some("inside") => Some(EdgeMode::Inside),
        Some("overflow") => Some(EdgeMode::Overflow(overflow.unwrap_or(out.spacing.or(catalog::default_spacing(&name)).unwrap_or(1.0) * 0.4))),
        Some(other) => return Err(bad("edge", format!("{other:?}: use \"clip\", \"inside\" or \"overflow\""))),
    };
    Ok((name, out))
}

fn length(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => parse_length_mm(s).ok(),
        _ => None,
    }
}

fn point(v: &Value) -> Option<(f64, f64)> {
    match v.as_array()?.as_slice() {
        [x, y] => Some((length(x)?, length(y)?)),
        _ => None,
    }
}

/// A profile value as a catalogue value: numbers and lengths (`"0.5mm"`) as
/// millimetres, words as words, lists of them, and polylines — one
/// (`[[x, y], …]`) or several (`[[[x, y], …], …]`) — for a custom motif.
fn option_value(v: &Value) -> Option<Pv> {
    match v {
        Value::Bool(b) => Some(Pv::Flag(*b)),
        Value::Number(n) => n.as_f64().map(Pv::Num),
        Value::String(s) => Some(parse_length_mm(s).ok().filter(|_| looks_like_length(s)).map_or_else(|| Pv::Text(s.clone()), Pv::Num)),
        Value::Array(items) if items.iter().all(|i| length(i).is_some()) => Some(Pv::Nums(items.iter().filter_map(length).collect())),
        Value::Array(items) if items.iter().all(|i| point(i).is_some()) => Some(Pv::Lines(vec![items.iter().filter_map(point).collect()])),
        Value::Array(items) => {
            let lines: Option<Vec<Vec<(f64, f64)>>> =
                items.iter().map(|l| l.as_array().and_then(|pts| pts.iter().map(point).collect::<Option<Vec<_>>>())).collect();
            lines.map(Pv::Lines)
        }
        _ => None,
    }
}

/// `"0.5mm"`, `"2cm"`, `"1in"`, `"-0.3"`: a length, not a word that happens
/// to parse (`"inside"` does not).
fn looks_like_length(s: &str) -> bool {
    let t = s.trim();
    t.chars().next().is_some_and(|c| c.is_ascii_digit() || c == '-' || c == '.' || c == '+')
}

// ---------------------------------------------------------------------------
// Running a fill
// ---------------------------------------------------------------------------

fn run_pattern(region: &Region, spec: &FillSpec) -> Result<penfill::Strokes, FillError> {
    let (name, cs) = catalog_spec(spec)?;
    if name == "none" || name == "solid" {
        return Ok(vec![]);
    }
    // A run `fills.cover` already made (footprint and lines together) is
    // handed over; otherwise only the lines are made. The footprint is the
    // expensive part (a polygon round every mark, all merged), so it is never
    // built for a fill nobody masks with.
    if catalog::own_mask(&name) {
        if let Some(kept) = take_covered(region, spec) {
            return Ok(kept.strokes);
        }
    }
    Ok(catalog::fill(&name, region, &cs)?.strokes)
}

/// Runs made for a [`cover`], kept until the fill pass draws them, so a
/// footprint and its lines are one run, not two.
static COVERED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<u64, penfill::pattern::FillOutput>>> =
    std::sync::LazyLock::new(Default::default);

fn run_key(region: &Region, spec: &FillSpec) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(spec).unwrap_or_default().hash(&mut h);
    for ring in region.iter_rings_mm() {
        for (x, y) in ring {
            x.to_bits().hash(&mut h);
            y.to_bits().hash(&mut h);
        }
        0xff_u8.hash(&mut h);
    }
    h.finish()
}

/// A footprint-aware pattern's lines and footprint on `r`. `take` hands over
/// a run a cover kept; otherwise the run is kept for the fill that follows.
fn covering(r: &Region, spec: &FillSpec, take: bool) -> Result<penfill::pattern::FillOutput, FillError> {
    let key = run_key(r, spec);
    if let Some(kept) = {
        let mut guard = COVERED.lock().unwrap_or_else(|e| e.into_inner());
        if take { guard.remove(&key) } else { guard.get(&key).cloned() }
    } {
        return Ok(kept);
    }
    let (name, cs) = catalog_spec(spec)?;
    let run = catalog::fill_output(&name, r, &cs)?;
    if !take && !r.is_empty() {
        let mut guard = COVERED.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(key, run.clone());
    }
    Ok(run)
}

/// The run a [`cover`] kept for this region and spec, if any.
fn take_covered(r: &Region, spec: &FillSpec) -> Option<penfill::pattern::FillOutput> {
    let key = run_key(r, spec);
    COVERED.lock().unwrap_or_else(|e| e.into_inner()).remove(&key)
}

/// Drop cached runs from the last draw (call at the start of each map).
pub fn clear_cover_cache() {
    let mut guard = COVERED.lock().unwrap_or_else(|e| e.into_inner());
    guard.clear();
}

/// The spacing a fill will run at, in mm, without running it: what the cost
/// estimate needs.
pub fn spacing_mm(spec: &FillSpec) -> Option<f64> {
    spec.spacing.map(|m| m.0).or_else(|| catalog::default_spacing(spec.generator.as_deref()?))
}

/// Group polygons whose overflow reach can touch into the same `Region`, while
/// keeping distant patches separate so one huge bounding box over the whole
/// map does not slow down the footprint-aware patterns' grids.
fn work_regions(mp: &MultiPolygon<f64>, spec: &FillSpec) -> Vec<Region> {
    if !spec.generator.as_deref().is_some_and(catalog::own_mask) || mp.0.len() <= 1 {
        return regions(mp);
    }
    let valid: Vec<&Polygon<f64>> = mp.0.iter().filter(|p| p.exterior().0.len() >= 4).collect();
    if valid.len() <= 1 {
        return regions(mp);
    }
    // How far past a polygon's border the pattern can bulge (`overflow`),
    // plus a small margin so polygons whose halos touch share one field.
    let reach = match catalog_spec(spec).ok().and_then(|(_, cs)| cs.edge) {
        Some(EdgeMode::Overflow(m)) => m.max(0.0) + 0.25,
        _ => 0.0,
    };
    if reach == 0.0 {
        return regions(mp);
    }
    let bboxes: Vec<(f64, f64, f64, f64)> = valid
        .iter()
        .map(|p| {
            p.exterior().0.iter().fold((f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY), |(x0, y0, x1, y1), c| {
                (x0.min(c.x - reach), y0.min(c.y - reach), x1.max(c.x + reach), y1.max(c.y + reach))
            })
        })
        .collect();
    let n = valid.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for i in 0..n {
        let (ax0, ay0, ax1, ay1) = bboxes[i];
        for j in (i + 1)..n {
            let (bx0, by0, bx1, by1) = bboxes[j];
            if ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1 {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                if ri != rj {
                    parent[ri] = rj;
                }
            }
        }
    }
    let mut groups: BTreeMap<usize, Vec<Vec<Vec<(f64, f64)>>>> = BTreeMap::new();
    for (i, p) in valid.into_iter().enumerate() {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(polygon_rings(p));
    }
    groups.into_values().map(|polys| Region::from_disjoint_polygons(&polys)).filter(|r| !r.is_empty()).collect()
}

/// What a fill of `region` covers on paper: for most patterns the area
/// itself; for those that know their footprint (crowns, clouds, stones,
/// scattered marks), the footprint. What `fills.cover` masks other layers with.
pub fn cover(region: &MultiPolygon<f64>, spec: &FillSpec) -> Result<MultiPolygon<f64>, FillError> {
    use rayon::prelude::*;
    if spec.source.is_some() || !spec.generator.as_deref().is_some_and(catalog::own_mask) {
        return Ok(region.clone());
    }
    let per_region: Result<Vec<Vec<MultiPolygon<f64>>>, FillError> = work_regions(region, spec)
        .par_iter()
        .map(|r| {
            let mut local_parts = Vec::new();
            for part in covering(r, spec, false)?.mask.parts() {
                let mut rings = part.iter_rings_mm().map(|ring| {
                    let mut cs: Vec<Coord<f64>> = ring.map(|(x, y)| Coord { x, y }).collect();
                    if cs.first() != cs.last() {
                        cs.push(cs[0]);
                    }
                    LineString::new(cs)
                });
                if let Some(outer) = rings.next() {
                    local_parts.push(MultiPolygon(vec![Polygon::new(outer, rings.collect())]));
                }
            }
            Ok(local_parts)
        })
        .collect();
    let parts: Vec<MultiPolygon<f64>> = per_region?.into_iter().flatten().collect();
    Ok(geom::union_multi(&parts))
}

fn run_source(region: &Region, spec: &FillSpec, sources: &Sources) -> Result<penfill::Strokes, FillError> {
    let src = spec.source.as_ref().ok_or(FillError::Nothing)?;
    let drawing = sources.get(&src.file).ok_or_else(|| FillError::MissingSource(src.file.clone()))?;
    let region = match spec.inset.map(|m| m.0) {
        Some(i) if i > 0.0 => region.inset(i),
        _ => region.clone(),
    };
    if src.size.is_none() && src.position.is_none() && src.repeat.is_none() {
        return Ok(region.clip_strokes(&drawing.strokes));
    }
    let placement = Placement::parse(
        src.size.as_deref().unwrap_or("cover"),
        src.position.as_deref().unwrap_or("center"),
        src.repeat.as_deref().unwrap_or("no-repeat"),
    )
    .map_err(|msg| FillError::BadSource { file: src.file.clone(), msg })?;
    Ok(penfill::svg::fill_svg_placed(&region, drawing, &placement))
}

/// Region to paint for a solid fill, with mask areas subtracted.
pub fn solid_regions(area: &MultiPolygon<f64>, mask: &MultiPolygon<f64>) -> MultiPolygon<f64> {
    if mask.0.is_empty() {
        return area.clone();
    }
    geom::difference(area, mask)
}

/// Check a spec before any geometry work, so a typo fails as the profile is
/// read, with the catalogue's message.
pub fn validate(spec: &FillSpec, sources: &Sources) -> Result<(), FillError> {
    if let Some(src) = &spec.source {
        if !sources.contains_key(&src.file) {
            return Err(FillError::MissingSource(src.file.clone()));
        }
        return Ok(());
    }
    let (name, cs) = catalog_spec(spec)?;
    if name == "solid" || name == "none" {
        return Ok(());
    }
    Ok(catalog::validate(&name, &cs)?)
}

fn run(region: &Region, spec: &FillSpec, sources: &Sources) -> Result<penfill::Strokes, FillError> {
    match (&spec.source, spec.generator.as_deref()) {
        (Some(_), _) => run_source(region, spec, sources),
        (None, Some(_)) => run_pattern(region, spec),
        (None, None) => Err(FillError::Nothing),
    }
}

/// Fill a single polygon directly without wrapping in a temporary `MultiPolygon`.
pub fn fill_polygon(poly: &Polygon<f64>, spec: &FillSpec, sources: &Sources) -> Result<Lines, FillError> {
    if poly.exterior().0.len() < 4 {
        return Ok(vec![]);
    }
    let r = Region::from_polygons(&[polygon_rings(poly)]);
    if r.is_empty() {
        return Ok(vec![]);
    }
    Ok(to_lines(run(&r, spec, sources)?))
}

/// Fill `region` (output mm) as `spec` says.
pub fn fill(region: &MultiPolygon<f64>, spec: &FillSpec, sources: &Sources) -> Result<Lines, FillError> {
    let mut out = Vec::new();
    fill_into(region, spec, sources, &mut out)?;
    Ok(to_lines(out))
}

/// [`fill`], handing the strokes to `sink` as they are made. A large fill
/// whose pattern tiles (see [`streams`]) is drawn in tiles of [`TILE_MM`],
/// so its memory does not grow with its area.
pub fn fill_into(region: &MultiPolygon<f64>, spec: &FillSpec, sources: &Sources, sink: &mut dyn penfill::Sink) -> Result<(), FillError> {
    let tiled = spec.source.is_none().then(|| tiling(spec)).flatten();
    for r in work_regions(region, spec) {
        match &tiled {
            Some((name, cs, inset)) if big(&r) => fill_tiled(&r, name, cs, *inset, sink)?,
            _ => sink.batch(run(&r, spec, sources)?),
        }
    }
    Ok(())
}

/// The side of a tile when a fill is streamed, in mm.
pub const TILE_MM: f64 = 100.0;

/// Whether `spec` is drawn tile by tile when its area is large: its pattern
/// gives the same lines in pieces as whole.
pub fn streams(spec: &FillSpec) -> bool {
    spec.source.is_none() && tiling(spec).is_some()
}

fn tiling(spec: &FillSpec) -> Option<(String, Spec, f64)> {
    let (name, cs) = catalog_spec(spec).ok()?;
    if name == "none" || name == "solid" {
        return None;
    }
    let inset = catalog::tileable(&name, &cs)?;
    Some((name, cs, inset))
}

fn big(r: &Region) -> bool {
    let (x0, y0, x1, y1) = r.bounds_mm();
    (x1 - x0) > 1.5 * TILE_MM || (y1 - y0) > 1.5 * TILE_MM
}

/// `region` filled tile by tile, row by row. Strokes cut by a seam are held
/// and joined to their continuation in the next tile, so a line crossing
/// three tiles is still one stroke; a stroke goes to `sink` as soon as no
/// later tile can continue it.
fn fill_tiled(region: &Region, name: &str, cs: &Spec, inset: f64, sink: &mut dyn penfill::Sink) -> Result<(), FillError> {
    let base = if inset > 0.0 { region.inset(inset) } else { region.clone() };
    let per_tile = Spec { inset: Some(0.0), ..cs.clone() };
    let (x0, y0, x1, y1) = base.bounds_mm();
    let nx = ((x1 - x0) / TILE_MM).ceil().max(1.0) as usize;
    let ny = ((y1 - y0) / TILE_MM).ceil().max(1.0) as usize;
    let xs: Vec<f64> = (1..nx).map(|i| x0 + i as f64 * TILE_MM).collect();
    let ys: Vec<f64> = (1..ny).map(|j| y0 + j as f64 * TILE_MM).collect();
    let mut seams = Seams::new(xs, ys);
    for j in 0..ny {
        for i in 0..nx {
            let (tx, ty) = (x0 + i as f64 * TILE_MM, y0 + j as f64 * TILE_MM);
            let tile = Region::from_ring(&[(tx, ty), (tx + TILE_MM, ty), (tx + TILE_MM, ty + TILE_MM), (tx, ty + TILE_MM)]);
            let piece = base.intersection(&tile);
            if piece.is_empty() {
                continue;
            }
            let strokes = catalog::fill(name, &piece, &per_tile)?.strokes;
            let done = seams.add(strokes);
            sink.batch(done);
        }
        // Row `j` is drawn: what does not reach the seam below it is final.
        sink.batch(seams.settled(j));
    }
    sink.batch(seams.rest());
    Ok(())
}

/// Strokes ending on a tile seam, waiting for their continuation.
struct Seams {
    xs: Vec<f64>,
    ys: Vec<f64>,
    held: Vec<Option<Vec<(f64, f64)>>>,
    // seam point → index into `held`, for every held stroke's seam ends
    at: std::collections::HashMap<(usize, i64), Vec<usize>>,
}

/// How close an end must be to a seam to be on it, and the bin its position
/// along the seam is matched in (mm).
const ON_SEAM: f64 = 1e-6;
const SEAM_BIN: f64 = 1e-4;

impl Seams {
    fn new(xs: Vec<f64>, ys: Vec<f64>) -> Seams {
        Seams { xs, ys, held: Vec::new(), at: Default::default() }
    }

    /// The seam `p` lies on and its position along it: vertical seams are
    /// `0..xs.len()`, horizontal ones follow.
    fn seam(&self, p: (f64, f64)) -> Option<(usize, i64)> {
        if let Some(k) = self.xs.iter().position(|x| (p.0 - x).abs() < ON_SEAM) {
            return Some((k, (p.1 / SEAM_BIN).round() as i64));
        }
        let k = self.ys.iter().position(|y| (p.1 - y).abs() < ON_SEAM)?;
        Some((self.xs.len() + k, (p.0 / SEAM_BIN).round() as i64))
    }

    /// Take a tile's strokes: those touching no seam are returned at once;
    /// the rest are joined to what is held, or held.
    fn add(&mut self, strokes: penfill::Strokes) -> penfill::Strokes {
        let mut out = Vec::new();
        for s in strokes {
            if s.len() < 2 {
                continue;
            }
            let (a, b) = (self.seam(s[0]), self.seam(s[s.len() - 1]));
            if a.is_none() && b.is_none() {
                out.push(s);
                continue;
            }
            self.hold(s);
        }
        out
    }

    fn partner(&self, key: (usize, i64), not: Option<usize>) -> Option<usize> {
        for dk in [0, -1, 1] {
            if let Some(list) = self.at.get(&(key.0, key.1 + dk)) {
                if let Some(&i) = list.iter().find(|&&i| Some(i) != not && self.held[i].is_some()) {
                    return Some(i);
                }
            }
        }
        None
    }

    fn hold(&mut self, mut s: Vec<(f64, f64)>) {
        // Join at either end while a held stroke continues it there.
        loop {
            let mut joined = false;
            for end in [true, false] {
                let p = if end { s[s.len() - 1] } else { s[0] };
                let Some(key) = self.seam(p) else { continue };
                let Some(i) = self.partner(key, None) else { continue };
                let mut other = self.take(i);
                let near = |q: (f64, f64)| (q.0 - p.0).abs() < 1e-3 && (q.1 - p.1).abs() < 1e-3;
                match (end, near(other[0])) {
                    (true, true) => s.extend(other.drain(1..)),
                    (true, false) => {
                        other.reverse();
                        s.extend(other.drain(1..));
                    }
                    (false, false) => {
                        other.extend(s.drain(1..));
                        s = other;
                    }
                    (false, true) => {
                        other.reverse();
                        other.extend(s.drain(1..));
                        s = other;
                    }
                }
                joined = true;
                break;
            }
            if !joined {
                break;
            }
        }
        let i = self.held.len();
        for p in [s[0], s[s.len() - 1]] {
            if let Some(key) = self.seam(p) {
                self.at.entry(key).or_default().push(i);
            }
        }
        self.held.push(Some(s));
    }

    fn take(&mut self, i: usize) -> Vec<(f64, f64)> {
        let s = self.held[i].take().expect("held stroke");
        for p in [s[0], s[s.len() - 1]] {
            if let Some(key) = self.seam(p) {
                if let Some(list) = self.at.get_mut(&key) {
                    list.retain(|&k| k != i);
                }
            }
        }
        s
    }

    /// The held strokes no later tile can continue once row `row` is drawn:
    /// none of their ends is on the seam below that row.
    fn settled(&mut self, row: usize) -> penfill::Strokes {
        let below = self.ys.get(row).copied();
        let mut out = Vec::new();
        for i in 0..self.held.len() {
            let open = match (&self.held[i], below) {
                (Some(s), Some(y)) => [s[0], s[s.len() - 1]].iter().any(|p| (p.1 - y).abs() < ON_SEAM),
                (Some(_), None) => false,
                (None, _) => continue,
            };
            if !open {
                out.push(self.take(i));
            }
        }
        out
    }

    fn rest(&mut self) -> penfill::Strokes {
        (0..self.held.len()).filter_map(|i| self.held[i].take()).collect()
    }
}

/// `content` cut to `region`: lines made elsewhere used as the fill's pattern.
pub fn fill_with(region: &MultiPolygon<f64>, content: &[LineString<f64>]) -> Lines {
    let strokes: penfill::Strokes = content.iter().map(|l| l.0.iter().map(|c| (c.x, c.y)).collect()).collect();
    regions(region).iter().flat_map(|r| to_lines(r.clip_strokes(&strokes))).collect()
}

/// A motif drawn somewhere on the page (`lines.shape`, `lines.text`, any
/// lines), as polylines around the origin: what `motif` takes.
pub fn motif_polylines(lines: &[LineString<f64>]) -> Value {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for c in lines.iter().flat_map(|l| l.0.iter()) {
        x0 = x0.min(c.x);
        y0 = y0.min(c.y);
        x1 = x1.max(c.x);
        y1 = y1.max(c.y);
    }
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    Value::Array(
        lines
            .iter()
            .filter(|l| l.0.len() >= 2)
            .map(|l| Value::Array(l.0.iter().map(|c| serde_json::json!([c.x - cx, c.y - cy])).collect()))
            .collect(),
    )
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

    fn square(s: f64) -> MultiPolygon<f64> {
        MultiPolygon::new(vec![polygon![(x: 0.0, y: 0.0), (x: s, y: 0.0), (x: s, y: s), (x: 0.0, y: s)]])
    }

    fn spec(name: &str, spacing: f64) -> FillSpec {
        FillSpec { generator: Some(name.into()), ..FillSpec::spacing(spacing) }
    }

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
        let lines = fill(&square_with_island(), &spec("lines", 0.5), &Sources::new()).unwrap();
        let in_island = lines.iter().any(|l| l.0.iter().all(|c| (4.0..=6.0).contains(&c.x) && (4.0..=6.0).contains(&c.y)));
        assert!(in_island);
    }

    #[test]
    fn areas_side_by_side_share_one_lattice() {
        let rect = |x0: f64, x1: f64| MultiPolygon::new(vec![polygon![(x: x0, y: 0.0), (x: x1, y: 0.0), (x: x1, y: 12.0), (x: x0, y: 12.0)]]);
        let ink = |spec: &FillSpec, m: &MultiPolygon<f64>| -> f64 { fill(m, spec, &Sources::new()).unwrap().iter().map(geom::line_length).sum() };
        for name in ["lines", "crosshatch", "waves", "honeycomb"] {
            let mut spec = FillSpec { inset: Some(Mm(0.0)), ..spec(name, 0.7) };
            // off the outer walls: a line lying on one is a toss-up for the clip
            spec.options.insert("shift".into(), serde_json::json!([0.3, -0.2]));
            let (whole, halves) = (ink(&spec, &rect(0.0, 20.0)), ink(&spec, &rect(0.0, 8.3)) + ink(&spec, &rect(8.3, 20.0)));
            assert!((whole - halves).abs() < 2e-2 * whole, "{name}: {whole} vs {halves}");
        }
    }

    #[test]
    fn options_become_catalogue_values() {
        let mut s = spec("scatter", 1.0);
        s.options.insert("mark".into(), "0.4mm".into());
        s.options.insert("motif".into(), serde_json::json!([[[-1, 0], [1, 0]], [[0, -1], [0, 1]]]));
        s.options.insert("dash".into(), serde_json::json!(["1mm", 0.5]));
        s.options.insert("density".into(), "edge".into());
        let (_, cs) = catalog_spec(&s).unwrap();
        assert_eq!(cs.options.get("mark"), Some(&Pv::Num(0.4)));
        assert_eq!(cs.options.get("dash"), Some(&Pv::Nums(vec![1.0, 0.5])));
        assert_eq!(cs.options.get("density"), Some(&Pv::Text("edge".into())));
        assert!(matches!(cs.options.get("motif"), Some(Pv::Lines(l)) if l.len() == 2));
        assert_eq!(cs.anchor.origin, penfill::Origin::Global);
    }

    #[test]
    fn anchor_must_be_global_or_local() {
        let mut s = spec("lines", 0.5);
        s.options.insert("anchor".into(), "page".into());
        assert!(matches!(validate(&s, &Sources::new()), Err(FillError::BadOption { .. })));
        s.options.insert("anchor".into(), "local".into());
        s.options.insert("shift".into(), serde_json::json!([0.2, 0.1]));
        assert!(validate(&s, &Sources::new()).is_ok());
    }

    #[test]
    fn a_typo_names_what_the_pattern_takes() {
        let mut s = spec("hatch", 0.5);
        s.options.insert("crosss".into(), serde_json::json!(2));
        let msg = validate(&s, &Sources::new()).unwrap_err().to_string();
        assert!(msg.contains("crosss") && msg.contains("cross"), "{msg}");
        let msg = validate(&spec("zigzog", 0.5), &Sources::new()).unwrap_err().to_string();
        assert!(msg.contains("unknown pattern"), "{msg}");
    }

    #[test]
    fn cover_is_the_footprint_and_its_run_feeds_the_fill() {
        use geo::Area;
        let sq = square(60.0);
        let mut s = spec("isoline-stack", 10.0);
        s.options.insert("coverage".into(), serde_json::json!(0.4));
        let fresh = fill(&sq, &s, &Sources::new()).unwrap();
        let footprint = cover(&sq, &s).unwrap();
        let a = footprint.unsigned_area();
        assert!(a > 0.0 && a < 0.95 * 3600.0, "clearings stay out of the footprint: {a}");
        assert_eq!(fill(&sq, &s, &Sources::new()).unwrap(), fresh);
        assert_eq!(cover(&sq, &spec("lines", 1.0)).unwrap(), sq);
    }

    #[test]
    fn isoline_stack_edge_modes() {
        let sq = square(40.0);
        let run = |edge: &str| {
            let mut s = spec("isoline-stack", 10.0);
            s.options.insert("edge".into(), edge.into());
            s.options.insert("coverage".into(), serde_json::json!(1.0));
            fill(&sq, &s, &Sources::new()).unwrap()
        };
        let out_of = |lines: &Lines| lines.iter().flat_map(|l| l.0.iter()).filter(|c| c.x < 0.0 || c.y < 0.0 || c.x > 40.0 || c.y > 40.0).count();
        assert_eq!(out_of(&run("inside")), 0);
        assert!(out_of(&run("overflow")) > 0, "overflow stays in");
        let mut bad = spec("isoline-stack", 10.0);
        bad.options.insert("edge".into(), "bleed".into());
        assert!(matches!(validate(&bad, &Sources::new()), Err(FillError::BadOption { .. })));
    }

    #[test]
    fn growth_branches_inside_the_region() {
        let sq = square(60.0);
        let s = FillSpec { seed: Some(3), ..spec("growth", 3.0) };
        let lines = fill(&sq, &s, &Sources::new()).unwrap();
        assert!(lines.len() > 20, "only {} segments", lines.len());
        for l in &lines {
            for c in &l.0 {
                assert!(c.x >= 0.0 && c.x <= 60.0 && c.y >= 0.0 && c.y <= 60.0, "{c:?} outside");
            }
        }
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
        let lines = fill(&square(10.0), &spec, &sources).unwrap();
        let total: f64 = lines.iter().map(geom::line_length).sum();
        assert!((total - 10.0).abs() < 1e-3, "{total}");
    }

    #[test]
    fn a_large_fill_streams_in_tiles_and_draws_the_same() {
        // 350 × 250 mm: twelve tiles. Streamed against drawn whole.
        let big = MultiPolygon::new(vec![polygon![(x: 3.0, y: 5.0), (x: 353.0, y: 5.0), (x: 353.0, y: 255.0), (x: 3.0, y: 255.0)]]);
        let r = regions(&big).remove(0);
        for (name, spacing) in [("lines", 1.5), ("stipple", 2.0), ("gravel", 4.0), ("brick", 3.0), ("waves", 2.0), ("woodland", 5.0)] {
            let s = spec(name, spacing);
            assert!(streams(&s), "{name} should stream");
            let streamed = fill(&big, &s, &Sources::new()).unwrap();
            let whole = to_lines(run(&r, &s, &Sources::new()).unwrap());
            let ink = |l: &Lines| -> f64 { l.iter().map(geom::line_length).sum() };
            let (a, b) = (ink(&whole), ink(&streamed));
            assert!((a - b).abs() < 0.01 * a, "{name}: whole {a:.0} mm of ink, streamed {b:.0}");
            if name == "lines" || name == "waves" {
                // Lines cut at the seams are joined again: one stroke per line.
                assert_eq!(streamed.len(), whole.len(), "{name}: strokes");
            }
        }
        // What follows the true outline is drawn whole.
        let mut edge = spec("stipple", 2.0);
        edge.options.insert("density".into(), "edge".into());
        assert!(!streams(&edge));
        assert!(!streams(&spec("concentric", 1.0)));
    }

    #[test]
    fn motif_lines_are_centred() {
        let l = vec![LineString::from(vec![(10.0, 10.0), (14.0, 10.0)])];
        assert_eq!(motif_polylines(&l), serde_json::json!([[[-2.0, 0.0], [2.0, 0.0]]]));
    }
}
