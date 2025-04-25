import svgwrite
import matplotlib.pyplot as plt
from shapely.geometry import MultiPolygon, Polygon, LineString, MultiLineString, Point
import xml.etree.ElementTree as ET
import re


def lerp_color(t):
    # Create a colormap with a spectrum from red to blue
    cmap = plt.get_cmap('rainbow')  # You can also use 'viridis', 'plasma', etc.
    color = cmap(t)  # Get the color corresponding to the value of t (between 0 and 1)
    return f"rgb({int(color[0] * 255)},{int(color[1] * 255)},{int(color[2] * 255)})"

def geometry_to_svg(geometry, svg_drawing, stroke_params):
    """
    Converts a Shapely geometry to an SVG representation with the given stroke parameters.
    """

    if geometry.geom_type == 'LineString':
        points = [(x, y) for x, y in geometry.coords]
        svg_drawing.add(svg_drawing.polyline(points,  **stroke_params))
    
    elif geometry.geom_type == 'Polygon':
        exterior_points = [(x, y) for x, y in geometry.exterior.coords]
        svg_drawing.add(svg_drawing.polygon(exterior_points, **stroke_params))
        for interior in geometry.interiors:
            interior_points = [(x, y) for x, y in interior.coords]
            svg_drawing.add(svg_drawing.polygon(interior_points,  **stroke_params))
    
    elif geometry.geom_type == 'MultiPolygon':
        for polygon in geometry.geoms:
            exterior_points = [(x, y) for x, y in polygon.exterior.coords]
            svg_drawing.add(svg_drawing.polygon(exterior_points,  **stroke_params))
            for interior in polygon.interiors:
                interior_points = [(x, y) for x, y in interior.coords]
                svg_drawing.add(svg_drawing.polygon(interior_points,  **stroke_params))

    elif geometry.geom_type == 'MultiLineString':
        for line in geometry.geoms:
            points = [(x, y) for x, y in line.coords]
            svg_drawing.add(svg_drawing.polyline(points,  **stroke_params))
    
    elif geometry.geom_type == 'Point':
        x, y = geometry.coords[0]
        svg_drawing.add(svg_drawing.circle(center=(x, y), r=1,  **stroke_params))

def save_svg(features, params, lerp = False):
    """
    Saves the SVG drawing to a file, coloring features based on their order.
    """
    svg_drawing = svgwrite.Drawing(
        params["output"],
        size=(f"{params['width_mm']}mm", f"{params['height_mm']}mm"),
        viewBox=(f"0 0 {params['width_mm']} {params['height_mm']}"),
        style="background-color: white;"  # Set the background color here
    )

    
    # Prepare stroke parameters that are passed to each geometry
    stroke_width = 0.1
    fill_color = 'none'  # Keep the fill color as none for all geometries
    total = len(features)

    # Iterate through features
    if isinstance(features, (list, tuple)):
        for idx, feature in enumerate(features):
            t = idx / max(total - 1, 1)  # avoid division by zero
            if lerp:
                stroke_color = lerp_color(t)
            else:
                stroke_color = "rgb(0,0,0)"

            # Pack stroke parameters into a dict
            stroke_params = {'stroke': stroke_color, 'fill': fill_color, 'stroke_width': stroke_width}
            geometry_to_svg(feature, svg_drawing, stroke_params)
    else:
        print("else")
        stroke_color = "rgb(255,0,0)"  # default color for single feature
        stroke_params = {'stroke': stroke_color, 'fill': fill_color, 'stroke_width': stroke_width}
        geometry_to_svg(features, svg_drawing, stroke_params)
    
    # Save the generated SVG file
    svg_drawing.save()
    
    

def gdf_to_svg(gdf, params, lerp=False):
    # Create the SVG header
    svg_content = f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
    <svg width="{params['width_mm']}mm" height="{params['height_mm']}mm" 
     viewBox="0 0 {params['width_mm']} {params['height_mm']}"
     xmlns="http://www.w3.org/2000/svg"
     style="background-color: white;">
    <g stroke="black" fill="none" stroke-width="0.1">\n
'''
    
    # Add styling if needed
    # svg_content += '<style type="text/css">\n  path { stroke: black; fill: none; stroke-width: 0.1; }\n</style>\n'
    
    # Add each geometry's SVG content
    for geom in gdf.geometry:
        if geom.is_empty:
            continue
        
        # Get the SVG representation and add it
        svg_element = geom.svg().replace('\n', '')
        if svg_element:
            svg_clean = re.sub(r'\s(fill|stroke|stroke-width|opacity|fill-rule)="[^"]+"', '', svg_element)
            svg_content += svg_clean + '\n'
    
    # Close the SVG tag
    svg_content += '</g>\n</svg>'
    
    # Write to file
    with open(params["output"], 'w') as f:
        f.write(svg_content)



def shapely_geom_to_path(geom):
    if geom.geom_type == "Polygon":
        exterior = geom.exterior.coords
        path_d = f"M {exterior[0][0]},{-exterior[0][1]}"
        for x, y in exterior[1:]:
            path_d += f" L{x},{-y}"
        path_d += " Z"
        return path_d

    elif geom.geom_type == "LineString":
        coords = list(geom.coords)
        path_d = f"M {coords[0][0]},{-coords[0][1]}"
        for x, y in coords[1:]:
            path_d += f" L{x},{-y}"
        return path_d

    elif geom.geom_type == "Point":
        # Handle as a circle instead of path
        return None

    return None


class SVG_composer:
    def __init__(self, params):
        self.svg = ""
        self.params = params
        
    def generateHeader(self):
        self.svg += f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
                    <svg width="{self.params['width_mm']}mm" height="{self.params['height_mm']}mm" 
                     viewBox="0 0 {self.params['width_mm']} {self.params['height_mm']}"
                     xmlns="http://www.w3.org/2000/svg"
                     style="background-color: white;">
                    '''
        return self
    def close(self):
        self.svg += "\n</svg>"
        return self
    
    def save_svg(self, filename):
        with open(filename, 'w') as f: 
            f.write(self.svg)
        return self
    
    def add_gdf(self, gdf):
        self.svg += '<g stroke="black" fill="none" stroke-width="0.1">\n'
        for geom in gdf.geometry:
            if geom.is_empty:
                continue
            # Get the SVG representation and add it
            svg_element = geom.svg().replace('\n', '')
            if svg_element:
                svg_clean = re.sub(r'\s(fill|stroke|stroke-width|opacity|fill-rule)="[^"]+"', '', svg_element)
                self.svg += svg_clean + '\n'   
        self.svg += '</g>\n'
        return self

    def colorize_elements(self, start_color=(255, 0, 0), end_color=(0, 0, 255)):
        """
        Apply color gradient to all paths and polylines in the existing SVG,
        interpolating from start_color to end_color across the spectrum.
        Should be called after close().

        Args:
            start_color: RGB tuple for first color (r,g,b)
            end_color: RGB tuple for last color (r,g,b)
        """
        # Find all path and polyline elements in the SVG
        element_pattern = re.compile(r'<(path|polyline)[^>]*>')
        elements = element_pattern.findall(self.svg)

        if not elements:
            return self

        total_elements = len(elements)
        processed_count = 0

        # Process each SVG element
        for match in re.finditer(r'<(path|polyline)([^>]*)>', self.svg):
            # Calculate interpolated color based on index
            if total_elements > 1:
                t = processed_count / (total_elements - 1)
            else:
                t = 0

            r = int(start_color[0] + t * (end_color[0] - start_color[0]))
            g = int(start_color[1] + t * (end_color[1] - start_color[1]))
            b = int(start_color[2] + t * (end_color[2] - start_color[2]))

            color = f"rgb({r},{g},{b})"

            tag = match.group(1)  # 'path' or 'polyline'
            attrs = match.group(2)
            element = match.group(0)

            # Replace or add stroke attribute
            if 'stroke="' in attrs:
                colored_element = re.sub(r'stroke="[^"]+"', f'stroke="{color}"', element)
            else:
                # Add the stroke attribute
                colored_element = f'<{tag}{attrs} stroke="{color}">'

            self.svg = self.svg.replace(element, colored_element, 1)
            processed_count += 1

        return self

