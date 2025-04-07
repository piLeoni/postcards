
from shapely.geometry import shape, Point, LineString, Polygon, MultiPolygon, MultiLineString

def process_feature_factory(transformer, **kwargs):
    """
    Creates a function to process GeoJSON features using keyword arguments.
    Returns transformed Shapely geometries.
    """
    
    def process_feature(feature):
        geom = shape(feature['geometry'])
        transformed_geom = None
        
        if geom.geom_type == 'Point':
            # Handle Point geometry
            x, y = project_and_scale(geom.coords[0], transformer, kwargs)
            transformed_geom = Point(x, y)
        
        elif geom.geom_type == 'LineString':
            # Handle LineString geometry
            points = [project_and_scale(coord, transformer, kwargs) for coord in geom.coords]
            transformed_geom = LineString(points)
        
        elif geom.geom_type == 'Polygon':
            # Handle Polygon geometry
            points = [project_and_scale(coord, transformer, kwargs) for coord in geom.exterior.coords]
            transformed_geom = Polygon(points)
        
        elif geom.geom_type == 'MultiPolygon':
            # Handle MultiPolygon geometry
            transformed_polygons = []
            for polygon in geom.geoms:
                points = [project_and_scale(coord, transformer, kwargs) for coord in polygon.exterior.coords]
                transformed_polygons.append(Polygon(points))
            transformed_geom = MultiPolygon(transformed_polygons)
        
        elif geom.geom_type == 'MultiLineString':
            # Handle MultiLineString geometry
            transformed_lines = []
            for line in geom.geoms:
                points = [project_and_scale(coord, transformer, kwargs) for coord in line.coords]
                transformed_lines.append(LineString(points))
            transformed_geom = MultiLineString(transformed_lines)
        
        # Return the transformed geometry
        return transformed_geom

    return process_feature

def project_and_scale(coords, transformer, params):
    """
    Projects and scales coordinates using parameters from a dictionary.
    """
    center_x, center_y = transformer.transform(params['center_coords'][0], params['center_coords'][1])
    width_m = params['width_mm'] * 0.001
    height_m = params['height_mm'] * 0.001
    scale_factor = int(params['scale'].split(":")[1])
    map_width_m = width_m * scale_factor
    map_height_m = height_m * scale_factor

    min_x = center_x - map_width_m / 2
    max_y = center_y + map_height_m / 2 #corrected from max_x to max_y.

    x, y = transformer.transform(coords[0], coords[1])
    scaled_x = (x - min_x) / map_width_m * params['width_mm']
    scaled_y = (max_y - y) / map_height_m * params['height_mm']

    return scaled_x, scaled_y
