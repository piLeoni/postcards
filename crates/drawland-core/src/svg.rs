//! The layered SVG: one `<g id>` per group, polylines in output mm. The group
//! ids are the contract with vpype (`[layers.<id>]`) and the G-code export.

use crate::geom::Lines;
use std::fmt::Write;

/// Set on the root and inherited, so a group's own `style` wins over it.
const DEFAULT_STYLE: &str = "\nsvg {\n  fill: none;\n  stroke: black;\n  stroke-width: 0.1;\n}\n";

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
