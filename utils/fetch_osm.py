import requests
from geopy.distance import geodesic
import geojson
import json
import osm2geojson

def fetch_osm(params, forceFetch=False):    
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
    old_params = {}
    try:
        with open(".cache/params.json", "r", encoding='utf-8') as file:
            old_params = geojson.load(file)
            
    except FileNotFoundError:
        print("No previouse params file cached.")

    if old_params == params and not forceFetch:
        try:
            with open('.cache/fetched.geojson', 'r', encoding='utf-8') as file:
                geojson_data = geojson.load(file)
                print("Loaded cached fetched.geojson")
                return geojson_data
        except FileNotFoundError as e:
            print(f"Cache file not found: {e}")
            return None
        

    else:
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
            
            print("Fetch OSM data from Overpass API")
            # query = f"""
            # [out:json];
            # (
            #   node({south},{west},{north},{east});
            #   way({south},{west},{north},{east});
            #   relation({south},{west},{north},{east});
            # );
            # out body;
            # >;
            # out skel qt;
            # """
            
            # import osmnx as ox

            # gdf = ox.features_from_bbox([east, south, west, north], tags={"building": True})            
            # print("gdf",gdf.to_json())
           
            query = f"""
            [out:json];
            (
              node({south},{west},{north},{east});
              way({south},{west},{north},{east});
              relation({south},{west},{north},{east});
            );
            (._;>;>;);
            out body;
            """
            url = "http://overpass-api.de/api/interpreter"
            response = requests.get(url, params={"data": query}, timeout=10)
            response.raise_for_status()
            osm_data = response.json()
            
            with open('.cache/osm.json', 'w', encoding='utf-8') as file:
                file.write(json.dumps(osm_data))
            print("Saved osm.json")

            geojson_data = osm2geojson.json2geojson(osm_data)
            with open('.cache/fetched.geojson', 'w', encoding='utf-8') as file:
                file.write(json.dumps(geojson_data))
            print("Saved fetched.geojson")
            
            with open(".cache/params.json", "w", encoding='utf-8') as file:
                file.write(json.dumps(params))
            print("Saved params.json")



            return geojson_data

        except requests.exceptions.RequestException as e:
            print(f"Error fetching data from Overpass API: {e}")
            return None
        except ValueError as e:
            print(f"Error processing scale: {e}")
            return None
     
