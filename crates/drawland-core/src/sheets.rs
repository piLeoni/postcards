//! The paper the drawing goes on: a blank `padding` inside the output's edge,
//! and the output cut into `slices`, `columns × rows` sheets of equal size with
//! a blank `slices.gutter` between their drawings, half on each side of a
//! cut, like the panels of a triptych. Both crop the composed drawing;
//! nothing is moved or scaled.

use crate::geom::Lines;
use crate::svg;
use crate::units::MmXY;
use geo::{Coord, LineString};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Slices {
    #[serde(default = "one")]
    pub columns: u32,
    #[serde(default = "one")]
    pub rows: u32,
    /// Blank space between neighbouring sheets' drawings, across and down;
    /// the outer edges keep the output's padding.
    #[serde(default)]
    pub gutter: MmXY,
}

fn one() -> u32 {
    1
}

impl Default for Slices {
    fn default() -> Self {
        Slices { columns: 1, rows: 1, gutter: MmXY::default() }
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
    let (sw, sh) = (width / cols as f64, height / rows as f64);
    let (hx, hy) = (slices.gutter.x / 2.0, slices.gutter.y / 2.0);
    let mut out = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            let (x0, y0) = (c as f64 * sw, r as f64 * sh);
            let at = [x0, y0, x0 + sw, y0 + sh];
            let inner = [
                if c == 0 { padding.x } else { x0 + hx },
                if r == 0 { padding.y } else { y0 + hy },
                if c + 1 == cols { width - padding.x } else { x0 + sw - hx },
                if r + 1 == rows { height - padding.y } else { y0 + sh - hy },
            ];
            out.push(Sheet { name: format!("r{}c{}", r + 1, c + 1), at, inner });
        }
    }
    out
}

/// The output's SVG and, when it is cut, one SVG per sheet.
pub struct Paper {
    pub svg: String,
    /// Strokes per group on the whole output, after cropping.
    pub groups: Vec<(String, usize)>,
    /// `(name, svg)` per sheet, each in its own millimetres; empty for one sheet.
    pub slices: Vec<(String, String)>,
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
}

/// Bytes of SVG text a part holds before handing them out.
pub const PIECE: usize = 1 << 20;

impl Layout {
    pub fn new(width: f64, height: f64, padding: MmXY, slices: &Slices) -> Layout {
        let sheets = sheets(width, height, padding, slices);
        let cropped = padding.x > 0.0 || padding.y > 0.0 || sheets.len() > 1;
        let mut parts = vec![svg::header(width, height)];
        if sheets.len() > 1 {
            let um = |v: f64| (v * 1000.0).round() / 1000.0;
            parts.extend(sheets.iter().map(|s| svg::header(um(s.at[2] - s.at[0]), um(s.at[3] - s.at[1]))));
        }
        Layout { sheets, cropped, parts, groups: Vec::new() }
    }

    fn cut(&self) -> bool {
        self.sheets.len() > 1
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

    /// Lines of the group begun last.
    pub fn lines(&mut self, lines: &[LineString<f64>], out: &mut Out) {
        let cropped_lines;
        let whole = if self.cropped {
            cropped_lines = self.sheets.iter().flat_map(|s| clip(lines, s.inner)).collect::<Lines>();
            &cropped_lines[..]
        } else {
            lines
        };
        if let Some(g) = self.groups.last_mut() {
            g.1 += whole.len();
        }
        for l in whole {
            svg::polyline(&mut self.parts[0], l);
        }
        if self.cut() {
            for (k, s) in self.sheets.iter().enumerate() {
                let [x0, y0, _, _] = s.at;
                for l in clip(whole, s.inner) {
                    let moved = LineString::new(l.0.into_iter().map(|c| Coord { x: c.x - x0, y: c.y - y0 }).collect());
                    svg::polyline(&mut self.parts[k + 1], &moved);
                }
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
/// back exactly as it was, so consecutive segments join on equality.
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
        let s = sheets(150.0, 100.0, even(5.0), &Slices { columns: 3, rows: 2, gutter: even(4.0) });
        assert_eq!(s.len(), 6);
        assert_eq!(s[0].name, "r1c1");
        assert_eq!(s[5].name, "r2c3");
        assert_eq!(s[0].at, [0.0, 0.0, 50.0, 50.0]);
        // The output's padding on the outside edges, half the gutter on each side of a cut.
        assert_eq!(s[0].inner, [5.0, 5.0, 48.0, 48.0]);
        assert_eq!(s[4].inner, [52.0, 52.0, 98.0, 95.0]);
        let thin = sheets(150.0, 100.0, even(0.0), &Slices { columns: 2, rows: 1, gutter: even(6.0) });
        assert_eq!(thin[0].inner, [0.0, 0.0, 72.0, 100.0], "a gutter leaves the outer edges alone");
        let apart = sheets(150.0, 100.0, MmXY { x: 6.0, y: 2.0 }, &Slices { columns: 2, rows: 2, gutter: MmXY { x: 8.0, y: 0.0 } });
        assert_eq!(apart[3].inner, [79.0, 50.0, 144.0, 98.0], "across and down apart");
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
        let paper = lay_out(150.0, 100.0, MmXY::default(), &Slices { columns: 2, rows: 1, gutter: MmXY { x: 6.0, y: 6.0 } }, vec![("g".into(), vec![across])]);
        assert_eq!(paper.groups, vec![("g".to_string(), 2)], "the gutter splits the line");
        assert_eq!(paper.slices.len(), 2);
        assert!(paper.slices[1].1.contains("width=\"75mm\""), "{}", &paper.slices[1].1[..200]);
        let one = lay_out(150.0, 100.0, MmXY::default(), &Slices::default(), vec![("g".into(), vec![])]);
        assert!(one.slices.is_empty());
    }
}
