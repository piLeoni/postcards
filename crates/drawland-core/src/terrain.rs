//! Terrain lines, drawn by burin: pen-and-ink hatching, contours, and the
//! coast itself, from the elevation under the output.
//!
//! The elevation comes from terramask's terrain tiles (Terrarium PNG), one
//! grid over the output; burin's expression trees say the colour and the width
//! at every dash; this maps its pixels back to output millimetres and hands the
//! result over as ordinary lines, so they are clipped, masked and composed
//! like anything else.
//!
//! The engine is `burin-map-core`, our own crate, used by path: the same code
//! the burin command line and page run.

use crate::geom::{self, Lines};
use crate::grammar::Terrain as Spec;
use crate::output::Output;
use burin_map_core::atlas::Atlas;
use burin_map_core::script;
use burin_map_core::{Drawing, Region, Ring, Surface};
use geo::{BoundingRect, Coord, LineString, MultiPolygon, Polygon};

/// The elevation grid burin draws on, and the transform back to millimetres.
pub struct Grid {
    /// Heights in metres, row 0 north.
    pub elev: Vec<f32>,
    pub width: usize,
    pub height: usize,
    /// Metres per pixel on the ground.
    pub px_m: f64,
    /// Lon/lat of the grid's north-west corner.
    pub nw_lon: f64,
    pub nw_lat: f64,
    /// Degrees per pixel.
    pub deg_per_px_lon: f64,
    pub deg_per_px_lat: f64,
}

/// How many pixels across the elevation grid is: burin's own default, so the
/// same script draws the same hatching whichever front end runs it.
pub const WIDTH_PX: usize = 1024;

/// Where grid (0, 0) sits in output millimetres, and the scale from pixels.
pub struct Placed {
    pub kx: f64,
    pub ky: f64,
    pub x0: f64,
    pub y0: f64,
}

impl Grid {
    /// A grid over `bounds` (`[west, south, east, north]`), from heights in
    /// metres, row 0 north, `width` px across. `merc` is the box in Mercator
    /// metres, which fixes the metres per pixel.
    pub fn new(bounds: [f64; 4], merc: [f64; 4], elev: Vec<f32>, width: usize) -> Grid {
        let height = elev.len() / width.max(1);
        let height = height.max(1);
        Grid {
            elev,
            width: width.max(1),
            height,
            px_m: (merc[2] - merc[0]) / width.max(1) as f64,
            nw_lon: bounds[0],
            nw_lat: bounds[3],
            deg_per_px_lon: (bounds[2] - bounds[0]) / width.max(1) as f64,
            deg_per_px_lat: (bounds[3] - bounds[1]) / height as f64,
            
        }
    }

    /// Where the grid's pixels land in output millimetres, through the same
    /// projection the rest of the document uses.
    pub fn placed(&self, projector: &crate::projection::Projector) -> Placed {
        // Two corners, so a non-square grid and a bearing both come out right.
        let (nx, ny) = projector.project(self.nw_lon, self.nw_lat);
        let (sx, sy) = projector.project(
            self.nw_lon + self.deg_per_px_lon * self.width as f64,
            self.nw_lat - self.deg_per_px_lat * self.height as f64,
        );
        Placed {
            kx: (sx - nx) / self.width as f64,
            ky: (sy - ny) / self.height as f64,
            x0: nx,
            y0: ny,
        }
    }
}

/// Build the atlas from a `tools_terrain` spec: one batch, whose colour, width,
/// band and style are burin's own JSON batch, so a script says the same thing
/// here as it does at burin's own front ends. `draw` picks hatching, a fill of
/// the band, or stippling.
pub fn atlas_of(spec: &Spec) -> Result<Atlas, String> {
    let mut atlas = Atlas::new();
    if spec.shore {
        atlas.shore(burin_map_core::water::Shoreline::default());
    }
    let mut body = serde_json::Map::new();
    body.insert(
        "draw".into(),
        serde_json::Value::String(
            match spec.draw {
                crate::grammar::TerrainDraw::Lines => "lines",
                crate::grammar::TerrainDraw::Fill => "fill",
                crate::grammar::TerrainDraw::Dots => "dots",
            }
            .into(),
        ),
    );
    if let Some(color) = &spec.color {
        // `color` is the line's own; a fill's flat colour is the same idea.
        body.insert(
            if spec.draw == crate::grammar::TerrainDraw::Fill { "color".into() } else { "shade".into() },
            color.clone(),
        );
    }
    if let Some(width) = &spec.width {
        body.insert("width".into(), width.clone());
    }
    if let Some(layer) = &spec.layer {
        body.insert("layer".into(), serde_json::Value::String(layer.clone()));
    }
    if spec.angle != 0.0 {
        body.insert("angle".into(), serde_json::json!(spec.angle));
    }
    if !spec.band.is_empty() {
        body.insert("where".into(), serde_json::Value::Object(spec.band.clone()));
    }
    for (k, v) in &spec.style {
        body.insert(k.clone(), v.clone());
    }
    let batch = script::batch_from(&serde_json::Value::Object(body))?;
    atlas.batch(batch);
    Ok(atlas)
}

/// Draw `spec` over the whole of `grid`.
pub fn draw(grid: &Grid, spec: &Spec) -> Result<Drawing, String> {
    run(&atlas_of(spec)?, grid, &[])
}

/// Draw a whole burin document (`spec.atlas`: the JSON `burin.json()` writes)
/// over the whole of `grid`. It is burin's own atlas, built by burin's own
/// language inside the profile, so whatever burin grows is available here
/// unchanged. Where it goes is the profile's: clip it, fill an area with it,
/// mask it, like any other lines.
///
/// `regions` maps each name batches may use in `within` / `outside` to an area
/// in output millimetres, rasterised onto the elevation grid.
pub fn draw_burin(grid: &Grid, spec: &crate::grammar::Burin, regions: &[(&str, Region)]) -> Result<Drawing, String> {
    run(&script::atlas_from(&spec.atlas)?, grid, regions)
}

fn run(atlas: &Atlas, grid: &Grid, regions: &[(&str, Region)]) -> Result<Drawing, String> {
    let surface = Surface::new(&grid.elev, grid.width, grid.height, grid.px_m as f32).regions(regions);
    atlas.draw(&surface, None)
}

/// An output area as burin regions on the elevation grid.
pub fn region_from_area(area: &MultiPolygon<f64>, at: &Placed) -> Region {
    let mut rings = Vec::new();
    for poly in &area.0 {
        if poly.exterior().coords().count() >= 4 {
            rings.push(ring_from_line(poly.exterior(), true, at));
        }
        for hole in poly.interiors() {
            if hole.coords().count() >= 4 {
                rings.push(ring_from_line(hole, false, at));
            }
        }
    }
    Region::Rings(rings)
}

fn ring_from_line(ls: &LineString<f64>, exterior: bool, at: &Placed) -> Ring {
    Ring {
        exterior,
        points: ls
            .coords()
            .map(|c| [(c.x - at.x0) / at.kx, (c.y - at.y0) / at.ky])
            .collect(),
    }
}

/// A drawing's dashes as draw.land lines, in output millimetres. Fills come
/// through as their rings: a `tools_terrain` def that draws a band is a fill,
/// and its rings are the belt.
pub fn lines(d: &Drawing, at: &Placed) -> Lines {
    let mut out: Lines = d
        .paths
        .iter()
        .filter(|l| l.len() >= 2)
        .map(|l| placed_line(l, at))
        .collect();
    for f in &d.fills {
        out.extend(f.rings.iter().filter(|r| r.len() >= 2).map(|r| placed_line(r, at)));
    }
    out
}

/// One burin line, in output millimetres.
fn placed_line(l: &burin_map_core::Line, at: &Placed) -> LineString<f64> {
    LineString::new(
        l.iter()
            .map(|p| Coord { x: at.x0 + p[0] as f64 * at.kx, y: at.y0 + p[1] as f64 * at.ky })
            .collect(),
    )
}

/// The same, grouped by the layer each run belongs to, in draw order: what a
/// script gets back per layer name (the batch's, or `terrain`). Fills are
/// their own layer, at the point they sit in the drawing.
pub fn layers(d: &Drawing, at: &Placed) -> Vec<(String, Lines)> {
    let mut out: Vec<(String, Lines)> = Vec::new();
    let mut start = 0usize;
    let mut fills = d.fills.iter().peekable();
    let push = |out: &mut Vec<(String, Lines)>, name: String, mine: Lines| match out
        .iter_mut()
        .find(|(n, _)| *n == name)
    {
        Some((_, all)) => all.extend(mine),
        None => out.push((name, mine)),
    };
    for (i, (pen, end)) in d.runs.iter().enumerate() {
        // Anything filled under this run comes first.
        while fills.peek().is_some_and(|f| f.above <= i) {
            let f = fills.next().unwrap();
            let name = f.pen.layer.clone().unwrap_or_else(|| "terrain".into());
            let mine: Lines = f.rings.iter().filter(|r| r.len() >= 2).map(|r| placed_line(r, at)).collect();
            push(&mut out, name, mine);
        }
        let layer = pen.layer.clone().unwrap_or_else(|| "terrain".into());
        let mine: Lines = d.paths[start..*end].iter().filter(|l| l.len() >= 2).map(|l| placed_line(l, at)).collect();
        push(&mut out, layer, mine);
        start = *end;
    }
    // A fill above every run (a drawing of fills only).
    for f in fills {
        let name = f.pen.layer.clone().unwrap_or_else(|| "terrain".into());
        let mine: Lines = f.rings.iter().filter(|r| r.len() >= 2).map(|r| placed_line(r, at)).collect();
        push(&mut out, name, mine);
    }
    out
}

/// The land polygon the drawing covers: the output frame itself.
pub fn frame(output: &Output) -> MultiPolygon<f64> {
    MultiPolygon::new(vec![output.query_polygon()])
}

/// How far past the output the elevation is read, as a fraction of the ground
/// size. Burin traces and dashes ink only where its grid has heights, so a grid
/// cut exactly to the frame leaves the last contours and dashes just short of
/// the border. Reading a margin past it lets the ink run off the page; the clip
/// to the frame trims it back, so the lines reach the edge instead of a blank
/// strip inside it.
const TERRAIN_MARGIN: f64 = 0.05;

/// The bounds (`[west, south, east, north]`) to read terrain for: the output's
/// area, grown by `TERRAIN_MARGIN` on every side so the ink reaches the border.
pub fn bounds_of(output: &Output) -> [f64; 4] {
    // A box already carries a rotation's corners; grow each side of it by the
    // margin, in metres, so the overhang is the same at any bearing.
    let r = output.query_polygon().bounding_rect();
    let Some(r) = r else {
        return [0.0, 0.0, 0.0, 0.0];
    };
    let (gw, gh) = output.ground_size_m();
    let (pad_x, pad_y) = (gw * TERRAIN_MARGIN, gh * TERRAIN_MARGIN);
    let g = geographiclib_rs::Geodesic::wgs84();
    use geographiclib_rs::DirectGeodesic;
    // Padding in degrees at the box's own latitude: a metre of longitude is
    // shorter near the poles, so derive it from a geodesic walk, not a fixed
    // degrees-per-metre.
    let mid_lat = (r.min().y + r.max().y) / 2.0;
    let mid_lon = (r.min().x + r.max().x) / 2.0;
    let (_, east_lon): (f64, f64) = g.direct(mid_lat, mid_lon, 90.0, pad_x);
    let (north_lat, _): (f64, f64) = g.direct(mid_lat, mid_lon, 0.0, pad_y);
    let d_lon = (east_lon - mid_lon).abs();
    let d_lat = (north_lat - mid_lat).abs();
    [r.min().x - d_lon, r.min().y - d_lat, r.max().x + d_lon, r.max().y + d_lat]
}

/// Whether `(x, y)` is inside `a`, rings counted, holes kept out.
pub fn point_in(a: &MultiPolygon<f64>, x: f64, y: f64) -> bool {
    let p = geo::Point::new(x, y);
    use geo::Contains;
    a.0.iter().any(|poly: &Polygon<f64>| poly.contains(&p))
}

/// Mask lines to an area, keeping the parts inside.
pub fn clip_to(lines: &Lines, area: &MultiPolygon<f64>) -> Lines {
    geom::clip_lines(lines, area, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProjectionMode;

    fn an_output() -> Output {
        Output {
            center: (-122.3934746, 37.7955487),
            width_mm: 152.4,
            height_mm: 101.6,
            scale: 10000.0,
            bearing: 0.0,
            projection: ProjectionMode::Utm,
            tile_zoom: None,
        }
    }

    #[test]
    fn terrain_is_read_past_the_frame() {
        let output = an_output();
        let [w, s, e, n] = bounds_of(&output);
        let frame = output.bounds();
        let [fw, fs, fe, fn_] = frame;
        // Every side reaches past the output, so burin's ink runs off the page
        // and the clip to the frame trims it to the border.
        assert!(w < fw && s < fs && e > fe && n > fn_, "padded: {w} {s} {e} {n} vs frame {frame:?}");
        // The margin is a few percent, not a whole extra frame: each side is
        // grown by about TERRAIN_MARGIN of the ground size.
        let (gw, _gh) = output.ground_size_m();
        let g = geographiclib_rs::Geodesic::wgs84();
        use geographiclib_rs::DirectGeodesic;
        let mid_lat = fs + (fn_ - fs) / 2.0;
        let mid_lon = fw + (fe - fw) / 2.0;
        let (_, east_lon): (f64, f64) = g.direct(mid_lat, mid_lon, 90.0, gw * TERRAIN_MARGIN);
        let want_d_lon = (east_lon - mid_lon).abs();
        let got_d_lon = e - fe;
        assert!((got_d_lon - want_d_lon).abs() < want_d_lon * 0.1, "margin {got_d_lon} vs {want_d_lon}");
        assert!(got_d_lon < gw / 90.0 * 0.2, "a margin, not a second frame");
    }
}
