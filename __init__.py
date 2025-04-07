from utils.process_feature_factory import process_feature_factory
from utils.transformer_factory import transformer_factory # ensure that this function is updated to take two parameters
from utils.fetch_osm import fetch_osm
from utils.geometry_to_svg import save_svg
from utils.ops import  flatten
from utils.filters.buildings import filter_buildings
from utils.clipping_area import clipping_area, clip_by
import shapely
import json

def project_geojson_to_svg(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """
    
    # with open("fetched.geojson", "w") as f:
    #     json.dump(params["geojson_data"], f, indent=2)

    try:
        process_feature = process_feature_factory( params["trasformer"], **params)

    
        buildings = filter_buildings(params['geojson_data'], process_feature)
        
        # rectangle = shapely.Polygon([(params["buffer"], params["buffer"]), 
        #                              (params["buffer"], params["buffer"]+params["height_mm"]),
        #                             ])
        # buildings = shapely.ops.unary_union(buildings)
                                    
        drawing_area = clipping_area(params)
        clip_by(buildings, drawing_area)
        # save_svg(buildings["geometry"], params)
        # save_svg(buildings["geometry"], params)
                # save_svg(buildings["geometry"], params)

        

    except KeyError as e:
        print(f"Error: Missing parameter in params: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

# Example usage:
_params = {
    'center_coords': (-122.4579532, 37.7778219),
    'width_mm': 152.4,
    'height_mm': 101.6,
    'scale': "1:10000",
    'projection': "utm",
    "svg_filename": ".tmp.svg",
    'buffer': 3
}
_params['geojson_data'] = fetch_osm(_params)
_params['trasformer'] = transformer_factory(_params)

project_geojson_to_svg(_params)