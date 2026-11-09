//! The layered SVG: one `<g id>` per group, polylines in output mm. The group
//! ids are the contract with vpype (`[layers.<id>]`) and the G-code export.

use crate::geom::Lines;
use geo::{LineString, MultiPolygon};
use std::fmt::Write;

/// Default ink for open strokes. Do not set `fill: none` on `svg` itself: filled
/// polygons live in nested groups (`solid`, `background`) and must inherit fill
/// when the page shows the SVG as a rasterized `<img>`.
const DEFAULT_STYLE: &str = "\nsvg {\n  stroke: black;\n  stroke-width: 0.1;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n}\npolyline, line {\n  fill: none;\n}\n";

/// Default decimal places for SVG coordinates (0.1 µm in mm).
pub const DEFAULT_DECIMALS: u8 = 4;

/// Shortest decimal for `v` at `decimals` places (up to 6).
fn num_with(out: &mut String, v: f64, decimals: u8) {
    if !v.is_finite() {
        let _ = write!(out, "{v}");
        return;
    }
    let d = decimals.min(6) as u32;
    let scale_i = 10_i64.pow(d);
    let scale_f = scale_i as f64;
    let scaled = (v * scale_f).round();
    if scaled == 0.0 {
        out.push('0');
        return;
    }
    if scaled.abs() < (i64::MAX as f64) {
        let mut n = scaled as i64;
        if n < 0 {
            out.push('-');
            n = -n;
        }
        let int_part = n / scale_i;
        let mut frac = (n % scale_i) as u32;
        let _ = write!(out, "{int_part}");
        if frac != 0 && d > 0 {
            out.push('.');
            let mut div = (scale_i / 10) as u32;
            while frac != 0 && div > 0 {
                let digit = frac / div;
                out.push(char::from(b'0' + digit as u8));
                frac %= div;
                div /= 10;
            }
        }
    } else {
        let r = scaled / scale_f;
        let _ = write!(out, "{r}");
    }
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


/// One multipolygon as filled paths (exterior and holes per polygon).
pub fn multipolygon(s: &mut String, mp: &MultiPolygon<f64>) {
    multipolygon_filled(s, mp, None);
}

/// Like [`multipolygon`], with an explicit `fill` on each path (needed when the
/// SVG is shown as a rasterized `<img>` and group `fill` does not inherit).
pub fn multipolygon_filled(s: &mut String, mp: &MultiPolygon<f64>, fill: Option<&str>) {
    multipolygon_filled_with_decimals(s, mp, fill, DEFAULT_DECIMALS);
}

pub fn multipolygon_filled_with_decimals(s: &mut String, mp: &MultiPolygon<f64>, fill: Option<&str>, decimals: u8) {
    // One path per polygon, holes as its subpaths: `fill-rule: evenodd` only
    // opens a hole inside the same path. Holes as paths of their own were
    // painted solid (a letter's counter, a lake in a band).
    for poly in &mp.0 {
        let start = s.len();
        s.push_str("\n<path d=\"");
        let body = s.len();
        for ring in std::iter::once(poly.exterior()).chain(poly.interiors()) {
            ring_subpath(s, ring, decimals);
        }
        if s.len() == body {
            s.truncate(start);
            continue;
        }
        s.push('"');
        if let Some(color) = fill {
            let _ = write!(s, " fill=\"{color}\"");
        }
        s.push_str(" />");
    }
}

/// One closed ring as an `M … Z` subpath; nothing for fewer than three points.
fn ring_subpath(s: &mut String, ring: &LineString<f64>, decimals: u8) {
    let pts = &ring.0;
    let n = pts.len();
    let end = if n > 0 && pts.first() == pts.last() { n - 1 } else { n };
    if end < 3 {
        return;
    }
    if !s.ends_with('"') {
        s.push(' ');
    }
    for (i, c) in pts[..end].iter().enumerate() {
        s.push(if i == 0 { 'M' } else { 'L' });
        num_with(s, c.x, decimals);
        s.push(' ');
        num_with(s, c.y, decimals);
    }
    s.push_str(" Z");
}

/// One line; nothing for a line of fewer than two points.
pub fn polyline(s: &mut String, line: &geo::LineString<f64>) {
    polyline_with_decimals(s, line, DEFAULT_DECIMALS);
}

pub fn polyline_with_decimals(s: &mut String, line: &geo::LineString<f64>, decimals: u8) {
    if line.0.len() < 2 {
        return;
    }
    s.push_str("\n<polyline points=\"");
    for (i, c) in line.0.iter().enumerate() {
        if i > 0 {
            s.push(' ');
        }
        num_with(s, c.x, decimals);
        s.push(',');
        num_with(s, c.y, decimals);
    }
    s.push_str("\" />");
}

/// Round fractional numbers inside `<polyline points="…"` and `<path d="…"` to
/// `decimals` places, leaving the SVG header and style untouched.
pub fn round_svg_decimals(svg_text: &str, decimals: u8) -> String {
    let mut out = String::with_capacity(svg_text.len());
    for line in svg_text.split_inclusive('\n') {
        if line.starts_with("<polyline points=\"") || line.starts_with("<path d=\"") {
            let bytes = line.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                let b = bytes[i];
                let prev = if i > 0 { bytes[i - 1] } else { b' ' };
                let starts_num = (b.is_ascii_digit() || (b == b'-' && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit()))
                    && matches!(prev, b'"' | b' ' | b',' | b'M' | b'L');
                if starts_num {
                    let start = i;
                    if bytes[i] == b'-' {
                        i += 1;
                    }
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    if i < bytes.len() && bytes[i] == b'.' {
                        i += 1;
                        while i < bytes.len() && bytes[i].is_ascii_digit() {
                            i += 1;
                        }
                        if let Ok(v) = line[start..i].parse::<f64>() {
                            num_with(&mut out, v, decimals);
                            continue;
                        }
                    }
                    out.push_str(&line[start..i]);
                } else {
                    out.push(b as char);
                    i += 1;
                }
            }
        } else {
            out.push_str(line);
        }
    }
    out
}

/// Split a rendered SVG into one complete SVG per top-level `<g id="…">` group.
pub fn split_svg_layers(svg_text: &str) -> Vec<(String, String)> {
    let Some(close) = svg_text.rfind("</svg>") else { return Vec::new() };
    let Some(style_end) = svg_text[..close].find("</style>") else { return Vec::new() };
    let header_end = style_end + "</style>".len();
    let header = &svg_text[..header_end];
    let footer = &svg_text[close..];
    let body = &svg_text[header_end..close];

    let mut out = Vec::new();
    let mut pos = 0;
    while pos < body.len() {
        let Some(rel_g) = body[pos..].find("<g") else { break };
        let g = pos + rel_g;
        if !body[pos..g].trim().is_empty() {
            break;
        }
        let rest = &body[g..];
        let Some(id_prefix) = rest.strip_prefix("<g id=\"") else { break };
        let Some(id_quote) = id_prefix.find('"') else { break };
        let id = id_prefix[..id_quote].to_string();

        let mut depth = 0usize;
        let mut j = g;
        let mut end = None;
        while j < body.len() {
            let next_open = body[j..].find("<g").map(|k| j + k);
            let Some(next_close) = body[j..].find("</g>").map(|k| j + k) else { break };
            if let Some(open_pos) = next_open.filter(|&o| o < next_close) {
                depth += 1;
                j = open_pos + 2;
            } else {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    end = Some(next_close + 4);
                    break;
                }
                j = next_close + 4;
            }
        }
        let Some(end_pos) = end else { break };
        let chunk = &body[g..end_pos];
        let mut layer_svg = String::with_capacity(header.len() + chunk.len() + footer.len() + 2);
        layer_svg.push_str(header);
        layer_svg.push('\n');
        layer_svg.push_str(chunk);
        layer_svg.push('\n');
        layer_svg.push_str(footer);
        out.push((id, layer_svg));
        pos = end_pos;
    }
    out
}

/// Sanitize a layer id for use as a file name token (`a-z0-9` joined by `-`).
pub fn slug_token(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            if dash && !out.is_empty() {
                out.push('-');
            }
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else {
            dash = true;
        }
    }
    if out.is_empty() { "layer".to_string() } else { out }
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

    #[test]
    fn round_and_split_layers() {
        let groups = vec![
            ("roads_outlines".to_string(), vec![line_string![(x: 0.0, y: 1.2345), (x: 2.5678, y: 3.0)]]),
            ("parks".to_string(), vec![line_string![(x: 5.1234, y: 6.7891), (x: 8.0, y: 9.0)]]),
        ];
        let svg = write_svg(100.0, 50.0, &groups);
        let rounded = round_svg_decimals(&svg, 2);
        assert!(rounded.contains("points=\"0,1.23 2.57,3\""));
        let layers = split_svg_layers(&rounded);
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[0].0, "roads_outlines");
        assert_eq!(layers[1].0, "parks");
        assert!(layers[0].1.contains("<g id=\"roads_outlines\">"));
        assert!(!layers[0].1.contains("id=\"parks\""));
        assert_eq!(slug_token("roads_outlines"), "roads-outlines");
    }
}
