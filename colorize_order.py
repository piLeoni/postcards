import xml.etree.ElementTree as ET
from matplotlib import colormaps
from matplotlib.colors import to_hex
import sys

def get_all_shapes(svg_root):
    """Find all shape elements in the SVG, handling namespaces."""
    shape_tags = ['path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'line']
    if '}' in svg_root.tag:
        ns = {'svg': svg_root.tag.split('}')[0].strip('{')}
        shapes = []
        for tag in shape_tags:
            shapes.extend(svg_root.findall(f'.//svg:{tag}', ns))
    else:
        shapes = []
        for tag in shape_tags:
            shapes.extend(svg_root.findall(f'.//{tag}'))
    print(f"Found {len(shapes)} shape elements.")
    return shapes

def apply_spectrum_color(shapes):
    """Assign each shape a stroke color based on its index in the total list, with no fill."""
    num_shapes = len(shapes)
    if num_shapes == 0:
        print("No shapes to colorize.")
        return
    colormap = colormaps.get_cmap("rainbow").resampled(num_shapes)

    for i, shape in enumerate(shapes):
        color = to_hex(colormap(i / (num_shapes - 1) if num_shapes > 1 else 0))
        style = shape.attrib.get("style", "")
        # Remove any previous fill or stroke
        style = ';'.join([
            s for s in style.split(';')
            if not s.strip().startswith('fill:') and not s.strip().startswith('stroke:')
        ])
        style = f"{style};stroke:{color};fill:none" if style else f"stroke:{color};fill:none"
        shape.set("style", style)
        # print(f"Colorized shape {i} <{shape.tag}> with stroke {color}")

def colorize_svg(input_svg_path, output_svg_path):
    tree = ET.parse(input_svg_path)
    root = tree.getroot()

    shapes = get_all_shapes(root)
    apply_spectrum_color(shapes)

    tree.write(output_svg_path, encoding="utf-8", xml_declaration=True)
    print(f"Saved colorized SVG to: {output_svg_path}")

# Example usage
if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python colorize_svg_paths.py input.svg output.svg")
    else:
        input_svg = sys.argv[1]
        output_svg = sys.argv[2]
        colorize_svg(input_svg, output_svg)
