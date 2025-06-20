import xml.etree.ElementTree as ET
import random
import sys

# SVG namespace
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)

# Tags that represent drawable shapes
SHAPE_TAGS = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}

def shuffle_layer_elements(svg_root):
    """Shuffle child shape elements inside each <g> group (layer), preserving group attributes."""
    for group in svg_root.findall(f".//{{{SVG_NS}}}g"):
        children = list(group)
        
        # Separate shapes and non-shapes
        shapes = [el for el in children if strip_ns(el.tag) in SHAPE_TAGS]
        others = [el for el in children if strip_ns(el.tag) not in SHAPE_TAGS]

        random.shuffle(shapes)  # Shuffle the shapes only

        # Preserve group attributes
        group_attrib = dict(group.attrib)

        # Clear the group and re-add in new shuffled order
        group.clear()
        # Restore group attributes
        group.attrib.update(group_attrib)
        for el in shapes + others:
            group.append(el)

def strip_ns(tag):
    """Remove namespace from tag name."""
    return tag.split("}")[-1] if "}" in tag else tag

def shuffle_svg_layers(input_svg_path, output_svg_path):
    tree = ET.parse(input_svg_path)
    root = tree.getroot()

    shuffle_layer_elements(root)

    tree.write(output_svg_path, encoding="utf-8", xml_declaration=True)
    print(f"Saved shuffled SVG to: {output_svg_path}")

# Example usage
if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python shuffle_svg_layers.py input.svg output.svg")
    else:
        input_svg = sys.argv[1]
        output_svg = sys.argv[2]
        shuffle_svg_layers(input_svg, output_svg)
