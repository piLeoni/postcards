#!/usr/bin/env python3
"""Colorize SVG shapes in draw order, for visually checking path ordering.

Not part of the production pipeline — a debugging aid. Run it on an optimized
SVG to see the order the plotter will draw in as a rainbow gradient.

Usage:
    python experiments/colorize_order.py in.svg out.svg
"""

import sys
import xml.etree.ElementTree as ET

from matplotlib import colormaps
from matplotlib.colors import to_hex

SHAPE_TAGS = ["path", "polyline", "polygon", "rect", "circle", "ellipse", "line"]


def get_all_shapes(svg_root):
    """Find all shape elements in the SVG, handling namespaces."""
    if "}" in svg_root.tag:
        ns = {"svg": svg_root.tag.split("}")[0].strip("{")}
        shapes = []
        for tag in SHAPE_TAGS:
            shapes.extend(svg_root.findall(f".//svg:{tag}", ns))
    else:
        shapes = []
        for tag in SHAPE_TAGS:
            shapes.extend(svg_root.findall(f".//{tag}"))
    print(f"Found {len(shapes)} shape elements.")
    return shapes


def apply_spectrum_color(shapes):
    """Give each shape a stroke colour by index, so order is readable."""
    num_shapes = len(shapes)
    if num_shapes == 0:
        print("No shapes to colorize.")
        return
    colormap = colormaps.get_cmap("rainbow").resampled(num_shapes)

    for i, shape in enumerate(shapes):
        color = to_hex(colormap(i / (num_shapes - 1) if num_shapes > 1 else 0))
        style = shape.attrib.get("style", "")
        style = ";".join(
            s
            for s in style.split(";")
            if not s.strip().startswith("fill:") and not s.strip().startswith("stroke:")
        )
        style = f"{style};stroke:{color};fill:none" if style else f"stroke:{color};fill:none"
        shape.set("style", style)


def colorize_svg(input_svg_path, output_svg_path):
    tree = ET.parse(input_svg_path)
    root = tree.getroot()
    apply_spectrum_color(get_all_shapes(root))
    tree.write(output_svg_path, encoding="utf-8", xml_declaration=True)
    print(f"Saved colorized SVG to: {output_svg_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python colorize_order.py input.svg output.svg")
        sys.exit(1)
    colorize_svg(sys.argv[1], sys.argv[2])
