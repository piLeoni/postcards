from utils.process_feature_factory import process_feature_factory
from utils.transformer_factory import transformer_factory # ensure that this function is updated to take two parameters
from utils.fetch_osm import fetch_osm
from utils.geometry_to_svg import save_svg
from utils.ops import  flatten, multipolygon_to_polygons
from utils.filters.buildings import filter_buildings
from utils.filters.roads import filter_roads
from utils.filters.parks import filter_parks

from utils.patterns.lines import lines_pattern
from utils.patterns.dots import dots_pattern

from utils.clipping_area import clipping_area, clip_by, cut_by
from utils.optimize import order_geometries_tsp, connect_nearby_paths
import shapely
import json
import pprint
from utils.filters.parks import filter_parks
import traceback

def project_geojson_to_svg(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """
    
    drawing_area = clipping_area(params)
    
    process_feature = process_feature_factory( params["trasformer"], **params)
    
    buildings = filter_buildings(params['geojson_data'], process_feature)
    ordered_buildings_details = order_geometries_tsp(connect_nearby_paths(buildings["internal_details"], 0.35))
    ordered_buildings_outlines = order_geometries_tsp(buildings["outlines"])
    buildings_pattern = clip_by(lines_pattern(params, 0.5, 45), buildings["mask"])
    # pprint.pprint(buildings["mask"])

    
    parks = filter_parks(params['geojson_data'], process_feature) 
    ordered_parks = order_geometries_tsp(connect_nearby_paths(parks["geometry"], 0.35))
    # ordered_parks_outlines = order_geometries_tsp(parks["outlines"])
    parks_pattern = clip_by(dots_pattern(params, 0.5, 45), parks["mask"])
    parks_pattern = cut_by(parks_pattern, buildings["mask"])

    roads = filter_roads(params['geojson_data'], process_feature)
    # pprint.pprint(roads)
    clipped_roads = cut_by(roads["geometry"], buildings["mask"] )
    clipped_roads = cut_by(clipped_roads, parks["mask"])
    ordered_roads = order_geometries_tsp(connect_nearby_paths(clipped_roads, 0.35))
    parks_pattern = cut_by(parks_pattern, clipped_roads)

    
    
    
    # toPrint = clip_by(pattern, drawing_area)
    
    # pprint.pprint(clipped_roads)

    toPrint = clip_by(
                        []
                      + ordered_buildings_outlines 
                      + ordered_buildings_details 
                      + buildings_pattern
                      
                      + ordered_parks 
                      + parks_pattern
                      + ordered_roads 
                      , drawing_area)
    
    save_svg(toPrint, params, True)
        
   
# Example usage:
_params = {
    # 'center_coords': (-122.4579532, 37.7778219),
    # 'center_coords': (12.3380226, 45.4365404),
    # 'center_coords': (9.1909641, 45.4641617),
    # 'center_coords': (-73.9736543, 40.7644734),
    'center_coords': (-73.9764881, 40.7637373),
    'width_mm': 152.4,
    'height_mm': 101.6,
    'scale': "1:10000",
    'projection': "utm",
    "svg_filename": "postcard.svg",
    'padding': 3
}

_params['geojson_data'] = fetch_osm(_params, cached=True)
_params['trasformer'] = transformer_factory(_params)


project_geojson_to_svg(_params)
