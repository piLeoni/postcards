//! Stacking: walking the layers top-down, every part of a layer loses what
//! the layers above it cover. Each occlusion rule is stated once, by order.

use crate::geom::{self, Lines};
use crate::themes::LayerParts;

/// `(layer id, parts)` bottom-most first → `("<id>_<part>", lines)` in draw
/// order, parts as outlines, details, trails, filling; empty groups are left out.
pub fn compose(stack: &[(String, LayerParts)]) -> Vec<(String, Lines)> {
    let mut above = geom::empty();
    let mut out: Vec<(String, Lines)> = Vec::new();
    for (id, parts) in stack.iter().rev() {
        if parts.is_empty() {
            continue;
        }
        let mut groups = Vec::new();
        let named = [
            ("outlines", &parts.outlines),
            ("details", &parts.details),
            ("trails", &parts.trails),
            ("filling", &parts.filling),
        ];
        for (suffix, lines) in named {
            let kept = geom::clip_lines(lines, &above, true);
            if !kept.is_empty() {
                groups.push((format!("{id}_{suffix}"), kept));
            }
        }
        out.splice(0..0, groups);
        if !parts.mask.0.is_empty() {
            above = geom::union_multi([&above, &parts.mask]);
        }
    }
    out
}
