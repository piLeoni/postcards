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
use burin_map_core::Drawing;
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

/// Build the atlas from a `tools_terrain` spec: one batch of streamlines, whose
/// colour, width and style are burin's own JSON batch, so a script says the
/// same thing here as it does at burin's own front ends.
pub fn atlas_of(spec: &Spec) -> Result<Atlas, String> {
    let mut atlas = Atlas::new();
    if spec.shore {
        atlas.shore(burin_map_core::water::Shoreline::default());
    }
    let mut body = serde_json::Map::new();
    if let Some(color) = &spec.color {
        body.insert("shade".into(), color.clone());
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
    for (k, v) in &spec.style {
        body.insert(k.clone(), v.clone());
    }
    let batch = script::batch_from(&serde_json::Value::Object(body))?;
    atlas.batch(batch);
    Ok(atlas)
}

/// Draw `spec` over `grid`, masked to `area` when the def names one.
pub fn draw(grid: &Grid, spec: &Spec, output: &Output, area: Option<&MultiPolygon<f64>>) -> Result<Drawing, String> {
    let atlas = atlas_of(spec)?;
    let mut d = atlas.draw(&grid.elev, grid.width, grid.height, grid.px_m as f32);
    if let Some(a) = area {
        // burin works in pixels; the mask is in millimetres, so pixels are
        // tested by whether their own corner lands in it.
        let projector = crate::projection::Projector::new(output);
        let at = grid.placed(&projector);
        d.paths.retain(|line| {
            line.iter().any(|p| {
                let x = at.x0 + p[0] as f64 * at.kx;
                let y = at.y0 + p[1] as f64 * at.ky;
                point_in(a, x, y)
            })
        });
    }
    Ok(d)
}

/// A drawing's dashes as draw.land lines, in output millimetres.
pub fn lines(d: &Drawing, at: &Placed) -> Lines {
    d.paths
        .iter()
        .filter(|l| l.len() >= 2)
        .map(|l| {
            LineString::new(
                l.iter()
                    .map(|p| Coord { x: at.x0 + p[0] as f64 * at.kx, y: at.y0 + p[1] as f64 * at.ky })
                    .collect(),
            )
        })
        .collect()
}

/// The same, grouped by the layer each run belongs to, in draw order: what a
/// script gets back per layer name (the batch's, or `terrain`).
pub fn layers(d: &Drawing, at: &Placed) -> Vec<(String, Lines)> {
    let mut out: Vec<(String, Lines)> = Vec::new();
    let mut start = 0usize;
    for (pen, end) in &d.runs {
        let layer = pen.layer.clone().unwrap_or_else(|| "terrain".into());
        let mine: Lines = d.paths[start..*end]
            .iter()
            .filter(|l| l.len() >= 2)
            .map(|l| {
                LineString::new(
                    l.iter()
                        .map(|p| Coord { x: at.x0 + p[0] as f64 * at.kx, y: at.y0 + p[1] as f64 * at.ky })
                        .collect(),
                )
            })
            .collect();
        match out.iter_mut().find(|(name, _)| *name == layer) {
            Some((_, all)) => all.extend(mine),
            None => out.push((layer, mine)),
        }
        start = *end;
    }
    out
}

/// The land polygon the drawing covers: the output frame itself.
pub fn frame(output: &Output) -> MultiPolygon<f64> {
    MultiPolygon::new(vec![output.query_polygon()])
}

/// The bounds (`[west, south, east, north]`) to read terrain for.
pub fn bounds_of(output: &Output) -> [f64; 4] {
    let r = output.query_polygon().bounding_rect();
    match r {
        Some(r) => [r.min().x, r.min().y, r.max().x, r.max().y],
        None => [0.0, 0.0, 0.0, 0.0],
    }
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
