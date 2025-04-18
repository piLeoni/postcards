from geopy.distance import geodesic

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