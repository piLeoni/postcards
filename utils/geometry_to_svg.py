import svgwrite
from shapely.geometry import MultiPolygon, Polygon, LineString, MultiLineString

def geometry_to_svg(geometry, svg_drawing):
    """
    Converts a Shapely geometry to an SVG representation.
    """
    stroke_width = 0.02
    if geometry.geom_type == 'LineString':
        # Handle LineString geometry: Draw a polyline for LineString
        points = [(x, y) for x, y in geometry.coords]
        svg_drawing.add(svg_drawing.polyline(points, stroke='black', fill='none', stroke_width=stroke_width))
    
    elif geometry.geom_type == 'Polygon':
        # Handle Polygon geometry: Draw the exterior and any interior holes for Polygon
        # Draw the exterior
        exterior_points = [(x, y) for x, y in geometry.exterior.coords]
        svg_drawing.add(svg_drawing.polygon(exterior_points, stroke='black', fill='none', stroke_width=stroke_width))
        
        # Draw any interior (holes)
        for interior in geometry.interiors:
            interior_points = [(x, y) for x, y in interior.coords]
            svg_drawing.add(svg_drawing.polygon(interior_points, stroke='black', fill='none', stroke_width=stroke_width))
    
    elif geometry.geom_type == 'MultiPolygon':
        # Flatten MultiPolygon: Iterate through each individual Polygon
        for polygon in geometry.geoms:
            # Handle exterior
            exterior_points = [(x, y) for x, y in polygon.exterior.coords]
            svg_drawing.add(svg_drawing.polygon(exterior_points, stroke='black', fill='none', stroke_width=stroke_width))
            
            # Handle any interiors (holes)
            for interior in polygon.interiors:
                interior_points = [(x, y) for x, y in interior.coords]
                svg_drawing.add(svg_drawing.polygon(interior_points, stroke='black', fill='none', stroke_width=stroke_width))

    elif geometry.geom_type == 'MultiLineString':
        # Flatten MultiLineString: Iterate through each individual LineString
        for line in geometry.geoms:
            points = [(x, y) for x, y in line.coords]
            svg_drawing.add(svg_drawing.polyline(points, stroke='black', fill='none', stroke_width=stroke_width))
    
    # Uncomment if you want to handle Point geometries
    # elif geometry.geom_type == 'Point':
    #     x, y = geometry.coords[0]
    #     svg_drawing.add(svg_drawing.circle(center=(x, y), r=1, stroke='black', fill='none', stroke_width=0.1))


def save_svg(features, params):
    """
    Saves the SVG drawing to a file.
    """
    # Create an SVG drawing with specified width and height in millimeters
    svg_drawing = svgwrite.Drawing(params["svg_filename"], size=(f"{params['width_mm']}mm", f"{params['height_mm']}mm"), viewBox=(f"0 0 {params['width_mm']} {params['height_mm']}"))
    
    # Iterate through all features and convert them to SVG
    for feature in features:
        geometry_to_svg(feature, svg_drawing)
    
    # Save the generated SVG file
    svg_drawing.save()
