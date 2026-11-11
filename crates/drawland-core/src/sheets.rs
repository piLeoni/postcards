//! The paper the drawing goes on: the output cut into `slices`, `columns ×
//! rows` sheets of equal size, like the panels of a triptych. The output's
//! `padding` is the margin round the card's outside edge only; at every cut
//! inside it each sheet keeps half the `slices.gutter`, so two neighbouring
//! drawings are exactly the gutter apart (none: they meet at the cut). Every
//! sheet's `inner` rectangle crops the composed drawing (padding zero still
//! clips to the card edge); nothing is moved or scaled.

use crate::geom::{self, Lines};
use crate::svg;
use crate::units::MmXY;
use geo::{Coord, LineString, MultiPolygon, polygon};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Slices {
    #[serde(default = "one")]
    pub columns: u32,
    #[serde(default = "one")]
    pub rows: u32,
    /// The blank space between neighbouring sheets' drawings, across and
    /// down: half of it on each side of every cut. The output's padding is
    /// only round the card's outside edge.
    #[serde(default)]
    pub gutter: MmXY,
    /// How much neighbouring sheets share, across and down: every sheet is
    /// the same size and runs this far over its neighbour, so the same strip
    /// of drawing is on both and one can be laid over the other to line them
    /// up (a poster printed in tiles). With no gutter the drawing runs to every
    /// cut, so an overlap of twice the printer's unprintable edge or more
    /// leaves no gap: trim that blank edge off one sheet and lay it on the next.
    #[serde(default, skip_serializing_if = "MmXY::is_zero")]
    pub overlap: MmXY,
}

fn one() -> u32 {
    1
}

impl Default for Slices {
    fn default() -> Self {
        Slices { columns: 1, rows: 1, gutter: MmXY::default(), overlap: MmXY::default() }
    }
}

/// `[x0, y0, x1, y1]` in output mm.
pub type Rect = [f64; 4];

/// One sheet: where it sits on the output, and the part of it drawn on.
#[derive(Debug, Clone, PartialEq)]
pub struct Sheet {
    /// `r1c2`: row and column, from 1, top left first.
    pub name: String,
    pub at: Rect,
    pub inner: Rect,
}

/// The sheets of a `width × height` mm output, row by row.
pub fn sheets(width: f64, height: f64, padding: MmXY, slices: &Slices) -> Vec<Sheet> {
    let (cols, rows) = (slices.columns.max(1), slices.rows.max(1));
    // Equal sheets, each `o` over the next: n sheets of s cover n·s − (n−1)·o.
    let (ox, oy) = (if cols > 1 { slices.overlap.x.max(0.0) } else { 0.0 }, if rows > 1 { slices.overlap.y.max(0.0) } else { 0.0 });
    let (sw, sh) = ((width + (cols - 1) as f64 * ox) / cols as f64, (height + (rows - 1) as f64 * oy) / rows as f64);
    // The padding on the card's outside edges, half the gutter at the cuts.
    let (gx, gy) = (slices.gutter.x / 2.0, slices.gutter.y / 2.0);
    let mut out = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            let (x0, y0) = (c as f64 * (sw - ox), r as f64 * (sh - oy));
            let at = [x0, y0, x0 + sw, y0 + sh];
            let left = if c == 0 { padding.x } else { gx };
            let right = if c == cols - 1 { padding.x } else { gx };
            let top = if r == 0 { padding.y } else { gy };
            let bottom = if r == rows - 1 { padding.y } else { gy };
            let inner = [x0 + left, y0 + top, x0 + sw - right, y0 + sh - bottom];
            out.push(Sheet { name: format!("r{}c{}", r + 1, c + 1), at, inner });
        }
    }
    out
}

/// The drawable area of the output after the `padding` (outside) and
/// `slices.gutter` (at the cuts) margins:
/// every sheet's `inner` rectangle, as a [`MultiPolygon`].
pub fn drawable_area(width: f64, height: f64, padding: MmXY, slices: &Slices) -> MultiPolygon<f64> {
    MultiPolygon::new(
        sheets(width, height, padding, slices)
            .into_iter()
            .filter_map(|s| {
                let [x0, y0, x1, y1] = s.inner;
                (x1 > x0 && y1 > y0).then(|| {
                    polygon![
                        (x: x0, y: y0),
                        (x: x1, y: y0),
                        (x: x1, y: y1),
                        (x: x0, y: y1),
                        (x: x0, y: y0),
                    ]
                })
            })
            .collect(),
    )
}

/// The output's SVG and, when it is cut, one SVG per sheet.
pub struct Paper {
    pub svg: String,
    /// Strokes per group on the whole output, after cropping.
    pub groups: Vec<(String, usize)>,
    /// `(name, svg)` per sheet, each in its own millimetres; empty for one sheet.
    pub slices: Vec<(String, String)>,
}

/// How to emit SVG files from a [`Paper`] (or rendered `svg` + `slices`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SliceExport {
    /// Only the whole uncut drawing (`<stem>.svg`).
    Whole,
    /// Only the cut sheets (`<stem>-r1c1.svg`, …), or the whole drawing when uncut.
    Slices,
    /// Both the whole drawing and each cut sheet (CLI default when sliced).
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportOptions {
    pub decimals: Option<u8>,
    pub per_layer: bool,
    pub slices: SliceExport,
}

impl Default for ExportOptions {
    fn default() -> Self {
        ExportOptions {
            decimals: None,
            per_layer: false,
            slices: SliceExport::Both,
        }
    }
}

/// Produce `(file_stem_suffix, svg_text)` pairs according to `opts`.
/// `file_stem_suffix` is `""` for the single whole file, or `"-r1c1"`, `"-roads"`, `"-r1c1-roads"`, etc.
pub fn export_svg_files(whole_svg: &str, slices: &[(String, String)], opts: ExportOptions) -> Vec<(String, String)> {
    let mut base_items: Vec<(String, String)> = Vec::new();
    match opts.slices {
        SliceExport::Whole => {
            base_items.push((String::new(), whole_svg.to_string()));
        }
        SliceExport::Slices => {
            if slices.is_empty() {
                base_items.push((String::new(), whole_svg.to_string()));
            } else {
                for (name, svg) in slices {
                    base_items.push((name.clone(), svg.clone()));
                }
            }
        }
        SliceExport::Both => {
            base_items.push((String::new(), whole_svg.to_string()));
            for (name, svg) in slices {
                base_items.push((name.clone(), svg.clone()));
            }
        }
    }

    let mut out = Vec::new();
    for (sheet_suffix, mut text) in base_items {
        if let Some(d) = opts.decimals {
            text = svg::round_svg_decimals(&text, d);
        }
        if opts.per_layer {
            let layers = svg::split_svg_layers(&text);
            if layers.len() > 1 {
                for (id, layer_svg) in layers {
                    let layer_tok = svg::slug_token(&id);
                    let suffix = if sheet_suffix.is_empty() {
                        format!("-{layer_tok}")
                    } else {
                        format!("-{sheet_suffix}-{layer_tok}")
                    };
                    out.push((suffix, layer_svg));
                }
                continue;
            }
        }
        let suffix = if sheet_suffix.is_empty() {
            String::new()
        } else {
            format!("-{sheet_suffix}")
        };
        out.push((suffix, text));
    }
    out
}

/// Lay the composed groups on the paper: cropped to the padding and the
/// sheets' margins, then cut into one drawing per sheet.
pub fn lay_out(width: f64, height: f64, padding: MmXY, slices: &Slices, groups: Vec<(String, Lines)>) -> Paper {
    let mut layout = Layout::new(width, height, padding, slices);
    let mut parts: Vec<String> = Vec::new();
    let mut out = |k: usize, text: &str| {
        if parts.len() <= k {
            parts.resize(k + 1, String::new());
        }
        parts[k].push_str(text);
    };
    for (id, lines) in &groups {
        layout.begin(id);
        layout.lines(lines, &mut out);
        layout.end();
    }
    let (groups, names) = layout.finish(&mut out);
    let mut parts = parts.into_iter();
    Paper { svg: parts.next().unwrap_or_default(), groups, slices: names.into_iter().zip(parts).collect() }
}

/// Where the drawing's text goes as it is written: part 0 is the whole
/// output, part `k` the `k`th sheet.
pub type Out<'a> = dyn FnMut(usize, &str) + 'a;

/// The paper written a batch of lines at a time: each batch is cropped,
/// cut into the sheets and turned into SVG text at once, so a drawing is
/// never held whole, as lines or as text. Text goes to the `out` callback
/// in pieces of about [`PIECE`] bytes per part.
pub struct Layout {
    sheets: Vec<Sheet>,
    cropped: bool,
    /// The text not yet handed out: the whole output first, then each sheet's.
    parts: Vec<String>,
    groups: Vec<(String, usize)>,
    /// Colour for [`multipolygon_filled`] while a [`begin_fill`] group is open.
    fill_paint: Option<String>,
    decimals: u8,
    /// Whether neighbouring sheets share drawing (`slices.overlap`).
    overlap: bool,
    /// Every sheet's inner rectangle together.
    drawable: MultiPolygon<f64>,
}

/// Bytes of SVG text a part holds before handing them out.
pub const PIECE: usize = 1 << 20;

impl Layout {
    pub fn new(width: f64, height: f64, padding: MmXY, slices: &Slices) -> Layout {
        Self::new_with_decimals(width, height, padding, slices, svg::DEFAULT_DECIMALS)
    }

    pub fn new_with_decimals(width: f64, height: f64, padding: MmXY, slices: &Slices, decimals: u8) -> Layout {
        let sheets = sheets(width, height, padding, slices);
        let cropped = true;
        let mut parts = vec![svg::header(width, height)];
        if sheets.len() > 1 {
            let um = |v: f64| (v * 1000.0).round() / 1000.0;
            parts.extend(sheets.iter().map(|s| svg::header(um(s.at[2] - s.at[0]), um(s.at[3] - s.at[1]))));
        }
        let overlap = sheets.len() > 1 && (slices.overlap.x > 0.0 || slices.overlap.y > 0.0);
        let drawable = if overlap { geom::union_multi(sheets.iter().map(|s| rect_mp(s.inner)).collect::<Vec<_>>().iter()) } else { geom::empty() };
        Layout { sheets, cropped, parts, groups: Vec::new(), fill_paint: None, decimals: decimals.min(6), overlap, drawable }
    }

    fn cut(&self) -> bool {
        self.sheets.len() > 1
    }

    /// Crop `lines` to the sheets' inner rectangles before `compose.optimize`
    /// runs, so border-clipped stubs are filtered, merged, and sorted.
    pub fn crop(&self, lines: &[LineString<f64>]) -> Lines {
        if !self.cropped {
            return lines.to_vec();
        }
        if self.overlaps() {
            return geom::clip_lines(lines, &self.drawable, false);
        }
        let mut out = Vec::new();
        for s in &self.sheets {
            out.extend(clip(lines, s.inner));
        }
        out
    }

    /// Sheets that share drawing: the whole output is then cropped to their
    /// union once, not sheet by sheet (which would draw the shared strips twice).
    fn overlaps(&self) -> bool {
        self.overlap
    }

    /// Start the group `id`, in every part.
    pub fn begin(&mut self, id: &str) {
        self.begin_with_style(id, None)
    }
    
    /// Start the group `id` with optional stroke style, in every part.
    pub fn begin_with_style(&mut self, id: &str, stroke_spec: Option<&crate::profile::StrokeSpec>) {
        for p in &mut self.parts {
            svg::group_open_with_style(p, id, stroke_spec);
        }
        self.groups.push((id.to_string(), 0));
    }

    /// Start a flat-fill group; colour from the draw entry's stroke.
    pub fn begin_fill(&mut self, id: &str, stroke_spec: Option<&crate::profile::StrokeSpec>) {
        let color = svg::fill_color(stroke_spec);
        self.fill_paint = Some(color.clone());
        for p in &mut self.parts {
            svg::group_open_fill(p, id, &color);
        }
        self.groups.push((id.to_string(), 0));
    }

    /// Filled polygons for the group begun last.
    pub fn solids(&mut self, mp: &MultiPolygon<f64>, out: &mut Out) {
        self.write_solids(mp, out, true, None);
    }

    /// Flat fill inside the current stroke group (does not start a counted group).
    pub fn fill_under(&mut self, color: &str, mp: &MultiPolygon<f64>, out: &mut Out) {
        if mp.0.is_empty() {
            return;
        }
        for p in &mut self.parts {
            svg::group_open_fill(p, "", color);
        }
        self.write_solids(mp, out, false, Some(color));
        for p in &mut self.parts {
            svg::group_close(p);
        }
    }

    fn write_solids(&mut self, mp: &MultiPolygon<f64>, out: &mut Out, count: bool, fill: Option<&str>) {
        let fill = fill.or(self.fill_paint.as_deref());
        if mp.0.is_empty() {
            return;
        }
        let per_sheet: Vec<MultiPolygon<f64>> = if self.cropped || self.cut() {
            self.sheets.iter().map(|s| geom::intersection(mp, &rect_mp(s.inner))).collect()
        } else {
            Vec::new()
        };
        let whole = if self.cropped {
            let mut merged = geom::empty();
            for piece in &per_sheet {
                merged = geom::union_multi([&merged, piece]);
            }
            merged
        } else {
            mp.clone()
        };
        let paths = whole.0.len();
        if count {
            if let Some(g) = self.groups.last_mut() {
                g.1 += paths;
            }
        }
        let d = self.decimals;
        svg::multipolygon_filled_with_decimals(&mut self.parts[0], &whole, fill, d);
        if self.cut() {
            for (k, (s, piece)) in self.sheets.iter().zip(per_sheet).enumerate() {
                if piece.0.is_empty() {
                    continue;
                }
                let [x0, y0, _, _] = s.at;
                let moved = MultiPolygon::new(
                    piece
                        .0
                        .into_iter()
                        .map(|p| {
                            let ext = LineString::new(
                                p.exterior()
                                    .0
                                    .iter()
                                    .map(|c| Coord { x: c.x - x0, y: c.y - y0 })
                                    .collect(),
                            );
                            let holes = p
                                .interiors()
                                .iter()
                                .map(|h| {
                                    LineString::new(h.0.iter().map(|c| Coord { x: c.x - x0, y: c.y - y0 }).collect())
                                })
                                .collect();
                            geo::Polygon::new(ext, holes)
                        })
                        .collect(),
                );
                svg::multipolygon_filled_with_decimals(&mut self.parts[k + 1], &moved, fill, d);
            }
        }
        for (k, p) in self.parts.iter_mut().enumerate() {
            if p.len() >= PIECE {
                out(k, p);
                p.clear();
            }
        }
    }

    /// Lines of the group begun last.
    pub fn lines(&mut self, lines: &[LineString<f64>], out: &mut Out) {
        let d = self.decimals;
        if self.cut() {
            let mut total_whole = 0;
            if self.overlaps() {
                let whole = geom::clip_lines(lines, &self.drawable, false);
                total_whole = whole.len();
                for l in &whole {
                    svg::polyline_with_decimals(&mut self.parts[0], l, d);
                }
            }
            for (k, s) in self.sheets.iter().enumerate() {
                let sheet_lines = clip(lines, s.inner);
                if !self.overlap {
                    total_whole += sheet_lines.len();
                }
                let [x0, y0, _, _] = s.at;
                for l in &sheet_lines {
                    if !self.overlap {
                        svg::polyline_with_decimals(&mut self.parts[0], l, d);
                    }
                    let moved = LineString::new(l.0.iter().map(|c| Coord { x: c.x - x0, y: c.y - y0 }).collect());
                    svg::polyline_with_decimals(&mut self.parts[k + 1], &moved, d);
                }
            }
            if let Some(g) = self.groups.last_mut() {
                g.1 += total_whole;
            }
        } else {
            let cropped_lines;
            let whole = if self.cropped {
                cropped_lines = self.sheets.first().map_or_else(Vec::new, |s| clip(lines, s.inner));
                &cropped_lines[..]
            } else {
                lines
            };
            if let Some(g) = self.groups.last_mut() {
                g.1 += whole.len();
            }
            for l in whole {
                svg::polyline_with_decimals(&mut self.parts[0], l, d);
            }
        }
        for (k, p) in self.parts.iter_mut().enumerate() {
            if p.len() >= PIECE {
                out(k, p);
                p.clear();
            }
        }
    }

    pub fn end(&mut self) {
        for p in &mut self.parts {
            svg::group_close(p);
        }
        self.fill_paint = None;
    }

    /// Close every part and hand out what is left: the strokes each group
    /// drew on the whole output, and the sheets' names (none when uncut).
    pub fn finish(mut self, out: &mut Out) -> (Vec<(String, usize)>, Vec<String>) {
        for (k, p) in self.parts.iter_mut().enumerate() {
            p.push_str(svg::FOOTER);
            out(k, p);
        }
        let names = if self.cut() { self.sheets.into_iter().map(|s| s.name).collect() } else { Vec::new() };
        (std::mem::take(&mut self.groups), names)
    }
}

fn rect_mp(r: Rect) -> MultiPolygon<f64> {
    MultiPolygon::new(vec![polygon![
        (x: r[0], y: r[1]),
        (x: r[2], y: r[1]),
        (x: r[2], y: r[3]),
        (x: r[0], y: r[3]),
        (x: r[0], y: r[1]),
    ]])
}

/// The parts of `lines` inside `r`, each run of inside segments one line.
pub fn clip(lines: &[LineString<f64>], r: Rect) -> Lines {
    let mut out = Vec::new();
    if r[2] <= r[0] || r[3] <= r[1] {
        return out;
    }
    let inside = |c: &Coord<f64>| c.x >= r[0] && c.x <= r[2] && c.y >= r[1] && c.y <= r[3];
    for line in lines {
        if line.0.len() == 1 {
            if inside(&line.0[0]) {
                out.push(line.clone());
            }
            continue;
        }
        let mut run: Vec<Coord<f64>> = Vec::new();
        for w in line.0.windows(2) {
            match clip_segment(w[0], w[1], r) {
                Some((p, q)) => {
                    if run.last() != Some(&p) {
                        if run.len() > 1 {
                            out.push(LineString::new(std::mem::take(&mut run)));
                        }
                        run = vec![p];
                    }
                    run.push(q);
                }
                None => {
                    if run.len() > 1 {
                        out.push(LineString::new(std::mem::take(&mut run)));
                    }
                    run.clear();
                }
            }
        }
        if run.len() > 1 {
            out.push(LineString::new(run));
        }
    }
    out
}

/// Liang–Barsky: the part of `a → b` inside `r`. An end already inside comes
/// back bit-for-bit, so the next segment in the line starts where this one
/// stopped and the run stays one polyline.
fn clip_segment(a: Coord<f64>, b: Coord<f64>, r: Rect) -> Option<(Coord<f64>, Coord<f64>)> {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    for (p, q) in [(-dx, a.x - r[0]), (dx, r[2] - a.x), (-dy, a.y - r[1]), (dy, r[3] - a.y)] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let t = q / p;
            if p < 0.0 {
                if t > t1 {
                    return None;
                }
                t0 = t0.max(t);
            } else {
                if t < t0 {
                    return None;
                }
                t1 = t1.min(t);
            }
        }
    }
    let at = |t: f64| Coord { x: a.x + dx * t, y: a.y + dy * t };
    Some((if t0 == 0.0 { a } else { at(t0) }, if t1 == 1.0 { b } else { at(t1) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn sheets_share_the_card_and_keep_their_margins() {
        let even = |v| MmXY { x: v, y: v };
        let s = sheets(150.0, 100.0, even(5.0), &Slices { columns: 3, rows: 2, gutter: even(4.0), ..Default::default() });
        assert_eq!(s.len(), 6);
        assert_eq!(s[0].name, "r1c1");
        assert_eq!(s[5].name, "r2c3");
        assert_eq!(s[0].at, [0.0, 0.0, 50.0, 50.0]);
        // The padding round the card's outside, half the 4 mm gutter at the cuts.
        assert_eq!(s[0].inner, [5.0, 5.0, 48.0, 48.0]);
        assert_eq!(s[4].inner, [52.0, 52.0, 98.0, 95.0]);
        assert_eq!(s[1].inner[0] - s[0].inner[2], 4.0, "neighbouring drawings are the gutter apart");
        let thin = sheets(150.0, 100.0, even(0.0), &Slices { columns: 2, rows: 1, gutter: even(6.0), ..Default::default() });
        assert_eq!(thin[0].inner, [0.0, 0.0, 72.0, 100.0], "a gutter alone leaves the outside edges bare");
        let apart = sheets(150.0, 100.0, MmXY { x: 6.0, y: 2.0 }, &Slices { columns: 2, rows: 2, ..Default::default() });
        assert_eq!(apart[3].inner, [75.0, 50.0, 144.0, 98.0], "no gutter: the drawings meet at the cuts, the padding only outside");
    }

    #[test]
    fn lines_are_cut_at_the_edge_and_split_where_they_leave() {
        let zig = LineString::from(vec![(-10.0, 5.0), (5.0, 5.0), (5.0, 20.0), (8.0, 20.0), (8.0, 5.0), (20.0, 5.0)]);
        let out = clip(&vec![zig], [0.0, 0.0, 10.0, 10.0]);
        assert_eq!(out.len(), 2, "out the top and back in: two pieces");
        assert_eq!(out[0].0.first().unwrap(), &Coord { x: 0.0, y: 5.0 });
        assert_abs_diff_eq!(out[1].0.last().unwrap().x, 10.0);
    }

    #[test]
    fn a_cut_card_writes_one_drawing_per_sheet() {
        let across = LineString::from(vec![(0.0, 50.0), (150.0, 50.0)]);
        let paper = lay_out(150.0, 100.0, MmXY::default(), &Slices { columns: 2, rows: 1, gutter: MmXY { x: 6.0, y: 6.0 }, ..Default::default() }, vec![("g".into(), vec![across])]);
        assert_eq!(paper.groups, vec![("g".to_string(), 2)], "the gutter splits the line");
        assert_eq!(paper.slices.len(), 2);
        assert!(paper.slices[1].1.contains("width=\"75mm\""), "{}", &paper.slices[1].1[..200]);
        let one = lay_out(150.0, 100.0, MmXY::default(), &Slices::default(), vec![("g".into(), vec![])]);
        assert!(one.slices.is_empty());

        let two_layers = lay_out(
            150.0,
            100.0,
            MmXY::default(),
            &Slices { columns: 2, rows: 1, gutter: MmXY { x: 6.0, y: 6.0 }, ..Default::default() },
            vec![
                ("roads_outlines".into(), vec![LineString::from(vec![(0.0, 50.1234), (150.0, 50.1234)])]),
                ("parks".into(), vec![LineString::from(vec![(0.0, 20.5678), (150.0, 20.5678)])]),
            ],
        );
        let exported = export_svg_files(
            &two_layers.svg,
            &two_layers.slices,
            ExportOptions {
                decimals: Some(2),
                per_layer: true,
                slices: SliceExport::Slices,
            },
        );
        let suffixes: Vec<&str> = exported.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(suffixes, vec!["-r1c1-roads-outlines", "-r1c1-parks", "-r1c2-roads-outlines", "-r1c2-parks"]);
        assert!(exported[0].1.contains("50.12"));
        assert!(!exported[0].1.contains("50.1234"));
    }

    #[test]
    fn overlapping_sheets_share_a_strip_and_the_whole_draws_it_once() {
        let even = |v| MmXY { x: v, y: v };
        // 3 sheets across 300 mm, 20 mm over each other: 113.33 mm each.
        let slices = Slices { columns: 3, rows: 1, overlap: even(20.0), ..Default::default() };
        let s = sheets(300.0, 100.0, even(5.0), &slices);
        let w = (300.0 + 2.0 * 20.0) / 3.0;
        for (k, sheet) in s.iter().enumerate() {
            assert!((sheet.at[2] - sheet.at[0] - w).abs() < 1e-9, "equal sheets");
            assert!((sheet.at[0] - k as f64 * (w - 20.0)).abs() < 1e-9);
        }
        assert!((s[2].at[2] - 300.0).abs() < 1e-9, "the last ends at the card's edge");
        assert!(s[0].at[2] - s[1].at[0] - 20.0 < 1e-9, "neighbours share 20 mm");
        // A line across: one stroke on the whole card, one on each sheet.
        let across = LineString::from(vec![(0.0, 50.0), (300.0, 50.0)]);
        let paper = lay_out(300.0, 100.0, even(5.0), &slices, vec![("g".into(), vec![across])]);
        assert_eq!(paper.groups, vec![("g".to_string(), 1)]);
        assert_eq!(paper.svg.matches("<polyline").count(), 1);
        assert!(paper.slices.iter().all(|(_, svg)| svg.matches("<polyline").count() == 1));
    }
}
