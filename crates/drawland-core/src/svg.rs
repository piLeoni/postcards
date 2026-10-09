//! The layered SVG: one `<g id>` per group, polylines in output mm. The group
//! ids are the contract with vpype (`[layers.<id>]`) and the G-code export.

use crate::geom::Lines;
use geo::{LineString, MultiPolygon};
use std::fmt::Write;

/// Default ink for open strokes. Do not set `fill: none` on `svg` itself: filled
/// polygons live in nested groups (`solid`, `background`) and must inherit fill
/// when the page shows the SVG as a rasterized `<img>`.
const DEFAULT_STYLE: &str = "\nsvg {\n  stroke: black;\n  stroke-width: 0.1;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n}\npolyline, line {\n  fill: none;\n}\n";

/// Shortest decimal for `v` at 0.1 µm resolution.
fn num(out: &mut String, v: f64) {
    let r = (v * 1e4).round() / 1e4;
    let r = if r == 0.0 { 0.0 } else { r };
    let _ = write!(out, "{r}");
}

pub fn write_svg(width_mm: f64, height_mm: f64, groups: &[(String, Lines)]) -> String {
    write_svg_with_styles(width_mm, height_mm, groups, &[])
}

pub fn write_svg_with_styles(width_mm: f64, height_mm: f64, groups: &[(String, Lines)], styles: &[(String, Option<&crate::profile::StrokeSpec>)]) -> String {
    let mut s = header(width_mm, height_mm);
    for (i, (id, lines)) in groups.iter().enumerate() {
        let stroke_spec = styles.get(i).and_then(|(_, spec)| *spec);
        group_open_with_style(&mut s, id, stroke_spec);
        for line in lines {
            polyline(&mut s, line);
        }
        group_close(&mut s);
    }
    s.push_str(FOOTER);
    s
}

/// The document's start, up to its first group. With [`group_open`],
/// [`polyline`], [`group_close`] and [`FOOTER`], an SVG written a piece at a
/// time comes out the same as [`write_svg`]'s.
pub fn header(width_mm: f64, height_mm: f64) -> String {
    let mut s = String::new();
    s.push_str("<?xml version='1.0' encoding='utf-8'?>\n");
    let _ = write!(
        s,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width_mm}mm\" height=\"{height_mm}mm\" viewBox=\"0 0 {width_mm} {height_mm}\">"
    );
    let _ = write!(s, "<style>{DEFAULT_STYLE}</style>");
    s
}

pub const FOOTER: &str = "\n</svg>\n";

pub fn group_open(s: &mut String, id: &str) {
    group_open_with_style(s, id, None);
}

pub fn group_open_with_style(s: &mut String, id: &str, stroke_spec: Option<&crate::profile::StrokeSpec>) {
    if let Some(spec) = stroke_spec {
        let mut style_attrs = String::new();
        
        // Add color if specified
        if let Some(color) = &spec.color {
            style_attrs.push_str(&format!("stroke:{};", color));
        }
        
        // Add width if specified (convert mm to user units)
        if let Some(width) = &spec.width {
            style_attrs.push_str(&format!("stroke-width:{};", width.0));
        }
        
        // Add line cap if specified
        if let Some(cap) = &spec.cap {
            style_attrs.push_str(&format!("stroke-linecap:{};", cap));
        }
        if let Some(join) = &spec.join {
            style_attrs.push_str(&format!("stroke-linejoin:{};", join));
        }

        if !style_attrs.is_empty() {
            let _ = write!(s, "\n<g id=\"{id}\" style=\"{style_attrs}\">");
        } else {
            let _ = write!(s, "\n<g id=\"{id}\">");
        }
    } else {
        let _ = write!(s, "\n<g id=\"{id}\">");
    }
}

pub fn group_close(s: &mut String) {
    s.push_str("\n</g>");
}

/// A group of filled polygons (`stroke:none`). `color` is a CSS colour.
pub fn group_open_fill(s: &mut String, id: &str, color: &str) {
    let _ = write!(
        s,
        "\n<g id=\"{id}\" style=\"stroke:none;fill:{color};fill-rule:evenodd\">"
    );
}

/// Fill colour from a draw stroke, defaulting to black ink.
pub fn fill_color(stroke_spec: Option<&crate::profile::StrokeSpec>) -> String {
    stroke_spec
        .and_then(|s| s.color.as_deref())
        .filter(|c| !c.is_empty())
        .unwrap_or("#000000")
        .to_string()
}

fn path_ring(s: &mut String, ring: &LineString<f64>, fill: Option<&str>) {
    let pts = &ring.0;
    if pts.len() < 4 {
        return;
    }
    let n = pts.len();
    let closed = pts.first() == pts.last();
    let end = if closed { n - 1 } else { n };
    if end < 3 {
        return;
    }
    s.push_str("\n<path d=\"");
    for (i, c) in pts[..end].iter().enumerate() {
        if i == 0 {
            s.push('M');
        } else {
            s.push('L');
        }
        num(s, c.x);
        s.push(' ');
        num(s, c.y);
    }
    s.push_str(" Z\"");
    if let Some(color) = fill {
        let _ = write!(s, " fill=\"{color}\"");
    }
    s.push_str(" />");
}

/// One multipolygon as filled paths (exterior and holes per polygon).
pub fn multipolygon(s: &mut String, mp: &MultiPolygon<f64>) {
    multipolygon_filled(s, mp, None);
}

/// Like [`multipolygon`], with an explicit `fill` on each path (needed when the
/// SVG is shown as a rasterized `<img>` and group `fill` does not inherit).
pub fn multipolygon_filled(s: &mut String, mp: &MultiPolygon<f64>, fill: Option<&str>) {
    for poly in &mp.0 {
        path_ring(s, poly.exterior(), fill);
        for hole in poly.interiors() {
            path_ring(s, hole, fill);
        }
    }
}

/// One line; nothing for a line of fewer than two points.
pub fn polyline(s: &mut String, line: &geo::LineString<f64>) {
    if line.0.len() < 2 {
        return;
    }
    s.push_str("\n<polyline points=\"");
    for (i, c) in line.0.iter().enumerate() {
        if i > 0 {
            s.push(' ');
        }
        num(s, c.x);
        s.push(',');
        num(s, c.y);
    }
    s.push_str("\" />");
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::line_string;
    use crate::profile::StrokeSpec;
    use crate::units::Mm;

    #[test]
    fn groups_and_points() {
        let groups = vec![("roads_outlines".to_string(), vec![line_string![(x: 0.0, y: 1.23456), (x: 2.5, y: -0.0)]])];
        let svg = write_svg(152.4, 101.6, &groups);
        assert!(svg.contains("width=\"152.4mm\""));
        assert!(svg.contains("<g id=\"roads_outlines\">"));
        assert!(svg.contains("points=\"0,1.2346 2.5,0\""));
    }

    #[test]
    fn groups_with_stroke_styles() {
        let groups = vec![("test_group".to_string(), vec![line_string![(x: 0.0, y: 0.0), (x: 10.0, y: 10.0)]])];
        let stroke_spec = StrokeSpec {
            color: Some("#ff0000".to_string()),
            width: Some(Mm(0.5)),
            cap: Some("round".to_string()),
            ..Default::default()
        };
        let styles = vec![("test_group".to_string(), Some(&stroke_spec))];
        let svg = write_svg_with_styles(100.0, 50.0, &groups, &styles);
        assert!(svg.contains("<g id=\"test_group\" style=\"stroke:#ff0000;stroke-width:0.5;stroke-linecap:round;\">"));
    }
}
