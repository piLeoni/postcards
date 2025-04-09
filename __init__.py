from utils.process_feature_factory import process_feature_factory
from utils.transformer_factory import transformer_factory # ensure that this function is updated to take two parameters
from utils.fetch_osm import fetch_osm
from utils.geometry_to_svg import save_svg
from utils.ops import  flatten
from utils.filters.buildings import filter_buildings
from utils.filters.roads import filter_roads

from utils.clipping_area import clipping_area, clip_by, to_lines, cut_by
from utils.order_geometries import order_geometries_tsp
import shapely
import json
import pprint

def project_geojson_to_svg(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """
    

    try:
        drawing_area = clipping_area(params)

        process_feature = process_feature_factory( params["trasformer"], **params)

        buildings = filter_buildings(params['geojson_data'], process_feature)
        ordered_buildings =order_geometries_tsp(buildings["geometry"])
        
        roads = filter_roads(params['geojson_data'], process_feature)
        clipped_roads = cut_by(roads["geometry"], buildings["mask"])
        ordered_roads = order_geometries_tsp(clipped_roads)
        
        toPrint = clip_by(ordered_buildings + ordered_roads, drawing_area)
    
        save_svg(toPrint, params, True)
        
    except KeyError as e:
        print(f"Error: Missing parameter in params: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

# Example usage:
_params = {
    # 'center_coords': (-122.4579532, 37.7778219),
    # 'center_coords': (12.3380226, 45.4365404),
    'center_coords': (9.1909641, 45.4641617),
    'width_mm': 152.4,
    'height_mm': 101.6,
    'scale': "1:10000",
    'projection': "utm",
    "svg_filename": "postcard.svg",
    'buffer': 3
}
_params['geojson_data'] = fetch_osm(_params)
_params['trasformer'] = transformer_factory(_params)

project_geojson_to_svg(_params)