import math
from pyproj import Transformer

def get_utm_zone(lon, lat):
    """Calculates the UTM zone number for given coordinates."""
    zone_number = int((math.floor((lon + 180) / 6) % 60) + 1)
    return zone_number

def transformer_factory(params):
    if params["projection"] == "utm":
        lon, lat = params["center_coords"]
        zone_number = get_utm_zone(lon, lat)
        output_crs = f"+proj=utm +zone={zone_number} +ellps=WGS84 +datum=WGS84 +units=m +no_defs"
        input_crs = 'EPSG:4326'
    elif params["projection"] == "gnomic":
        input_crs = 'EPSG:4326'
        output_crs = f'+proj=gnom +lat_0={params["center_coords"][1]} +lon_0={params["center_coords"][0]} +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs'
    else:
        raise ValueError("Invalid projection. Choose 'utm' or 'gnomic'.")

    return Transformer.from_crs(input_crs, output_crs, always_xy=True)

#