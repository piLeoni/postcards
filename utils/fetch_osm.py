import requests
from geopy.distance import geodesic
import geojson
import json
import osm2geojson

def fetch_osm(params):
    """
    Fetches OSM data as GeoJSON within a bounding box, using parameters from a dictionary.
s
    Args:
        params: A dictionary containing the following keys:
            - center_coords: Tuple of (longitude, latitude) in decimal degrees.
            - width_mm: Width of the bounding box in millimeters.
            - height_mm: Height of the bounding box in millimeters.
            - scale: Scale of the map (e.g., "1:10000").

    Returns:
        GeoJSON FeatureCollection, or None if an error occurs.
    """
    try:
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
        
        query = f"""
        [out:json];
        (
          node({south},{west},{north},{east});
          way({south},{west},{north},{east});
          relation({south},{west},{north},{east});
        );
        out body;
        >;
        out skel qt;
        """
        url = "http://overpass-api.de/api/interpreter"
        response = requests.get(url, params={"data": query})
        response.raise_for_status()
        osm_data = response.json()

        geojson_features = []
        node_locations = {}
        
        geojson_data = osm2geojson.json2geojson(osm_data)
        return geojson_data

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from Overpass API: {e}")
        return None
    except ValueError as e:
        print(f"Error processing scale: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None
