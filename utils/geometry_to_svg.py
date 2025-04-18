import svgwrite
import matplotlib.pyplot as plt
from shapely.geometry import MultiPolygon, Polygon, LineString, MultiLineString, Point

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
