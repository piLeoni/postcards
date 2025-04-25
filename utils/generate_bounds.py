from geopy.distance import geodesic
from shapely.geometry import Polygon

def generate_bounds(params):
    center_coords = params['center_coords']
    width_mm = params['width_mm']
    height_mm = params['height_mm']
    scale = params['scale']
    lon, lat = center_coords
    scale_ratio = int(scale.split(":")[1])
    width_m = width_mm / 1000.0 * scale_ratio
    height_m = height_mm / 1000.0 * scale_ratio
    center_point = (lat, lon)
    north_point = geodesic(meters=height_m / 2).destination(center_point, 0)
    south_point = geodesic(meters=height_m / 2).destination(center_point, 180)
    east_point = geodesic(meters=width_m / 2).destination(center_point, 90)
    west_point = geodesic(meters=width_m / 2).destination(center_point, 270)
    
    north = north_point.latitude
    south = south_point.latitude
    east = east_point.longitude
    west = west_point.longitude
    
    return {"north":north, "south":south, "east": east, "west":west}

def generate_rectangle_polygon(params):
    """
    Generate a rectangular polygon based on center coordinates, dimensions and optional bearing.
    
    Args:
        params: Dictionary containing:
            center_coords: Tuple of (longitude, latitude)
            width_mm: Width in millimeters 
            height_mm: Height in millimeters
            scale: Scale as string (e.g. "1:10000")
            bearing: Optional rotation angle in degrees (clockwise from north)
    
    Returns:
        Shapely Polygon representing the rectangle
    """
    center_coords = params['center_coords']
    width_mm = params['width_mm']
    height_mm = params['height_mm']
    scale = params['scale']
    bearing = params.get('bearing', 0)  # Default to 0 if not provided
    
    # Parse scale and convert dimensions to meters
    scale_ratio = int(scale.split(":")[1])
    width_m = width_mm / 1000.0 * scale_ratio
    height_m = height_mm / 1000.0 * scale_ratio
    
    # Note: center_coords is (lon, lat) but geopy expects (lat, lon)
    lon, lat = center_coords
    center_point = (lat, lon)
    
    # Calculate the four corners
    # First, get the North point (rotated by bearing)
    north = geodesic(meters=height_m/2).destination(center_point, bearing)
    south = geodesic(meters=height_m/2).destination(center_point, (bearing + 180) % 360)
    
    # Then calculate east and west points from the north point
    # (perpendicular to the north-south line)
    east_bearing = (bearing + 90) % 360
    west_bearing = (bearing + 270) % 360
    
    # From center
    east_point = geodesic(meters=width_m/2).destination(center_point, east_bearing)
    west_point = geodesic(meters=width_m/2).destination(center_point, west_bearing)
    
    # Calculate the corners by combining offsets
    ne_point = geodesic(meters=width_m/2).destination(north, east_bearing)
    nw_point = geodesic(meters=width_m/2).destination(north, west_bearing)
    se_point = geodesic(meters=width_m/2).destination(south, east_bearing)
    sw_point = geodesic(meters=width_m/2).destination(south, west_bearing)
    
    # Create polygon coordinates (lon, lat) for shapely
    coords = [
        (ne_point.longitude, ne_point.latitude),
        (nw_point.longitude, nw_point.latitude),
        (sw_point.longitude, sw_point.latitude),
        (se_point.longitude, se_point.latitude),
        (ne_point.longitude, ne_point.latitude)  # Close the ring
    ]
    
    return Polygon(coords)