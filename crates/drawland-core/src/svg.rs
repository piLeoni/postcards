//! The layered SVG: one `<g id>` per group, polylines in output mm. The group
//! ids are the contract with vpype (`[layers.<id>]`) and the G-code export.

use crate::geom::Lines;
use std::fmt::Write;

const STYLE: &str = "\n* {\n  fill: none;\n  stroke: black;\n  stroke-width: 0.1;\n}\n";

/// Shortest decimal for `v` at 0.1 µm resolution.
fn num(out: &mut String, v: f64) {
    let r = (v * 1e4).round() / 1e4;
    let r = if r == 0.0 { 0.0 } else { r };
    let _ = write!(out, "{r}");
}

pub fn write_svg(width_mm: f64, height_mm: f64, groups: &[(String, Lines)]) -> String {
    let mut s = String::new();
    s.push_str("<?xml version='1.0' encoding='utf-8'?>\n");
    let _ = write!(
        s,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width_mm}mm\" height=\"{height_mm}mm\" viewBox=\"0 0 {width_mm} {height_mm}\">"
    );
    let _ = write!(s, "<style>{STYLE}</style>");
    for (id, lines) in groups {
        let _ = write!(s, "\n<g id=\"{id}\">");
        for line in lines {
            if line.0.len() < 2 {
                continue;
            }
            s.push_str("\n<polyline points=\"");
            for (i, c) in line.0.iter().enumerate() {
                if i > 0 {
                    s.push(' ');
                }
                num(&mut s, c.x);
                s.push(',');
                num(&mut s, c.y);
            }
            s.push_str("\" />");
        }
        s.push_str("\n</g>");
    }
    s.push_str("\n</svg>\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::line_string;

    #[test]
    fn groups_and_points() {
        let groups = vec![("roads_outlines".to_string(), vec![line_string![(x: 0.0, y: 1.23456), (x: 2.5, y: -0.0)]])];
        let svg = write_svg(152.4, 101.6, &groups);
        assert!(svg.contains("width=\"152.4mm\""));
        assert!(svg.contains("<g id=\"roads_outlines\">"));
        assert!(svg.contains("points=\"0,1.2346 2.5,0\""));
    }
}
