from utils.ops import flatten, geometry_to_linestrings, multipolygon_to_polygons
from utils.clipping_area import  cut_fast_by
from utils.process_feature_factory import process_feature_factory
from utils.optimize import order_geometries_tsp, connect_nearby_paths

import shapely
from shapely.geometry import MultiPolygon
import pprint



def filter_roads(params):
    """
    Filters roads from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered roads features.
    """
    
    
    width_index = {
        "motorway": 25,          # Range 15-30m, 25 is a reasonable average
        "motorway_link": 10,     # Range 7-12m, 10 is a reasonable average
        "trunk": 18,             # Range 10-25m, 18 is a reasonable average
        "trunk_link": 8,         # Range 6-10m, 8 is a reasonable average
        "primary": 12,           # Range 7-15m, 12 is a reasonable average
        "primary_link": 8,       # Range 6-10m, 8 is a reasonable average
        "secondary": 9,          # Range 6-12m, 9 is a reasonable average
        "secondary_link": 7,     # Range 5-8m, 7 is a reasonable average
        "tertiary": 7,           # Range 5-10m, 7 is a reasonable average
        "tertiary_link": 6,      # Range 5-7m, 6 is a reasonable average
        "residential": 4,        # Range 4-8m, 6 is a reasonable average
        "living_street": 4,      # Range 3-6m, 4 is a reasonable average
        "service": 4,            # Range 3-6m, 4 is a reasonable average
        "pedestrian": 5,         # Range 3-10m, 5 is a reasonable average
        "footway": 1.5,          # Range 1-2m, 1.5 is a reasonable average
        "cycleway": 2,           # Range 1.5-3m, 2 is a reasonable average
        "bridleway": 2.5,        # Range 2-3m, 2.5 is a reasonable average
        "path": 1.5,             # Range 1-2m, 1.5 is a reasonable average
        "steps": 1,              # Roughly 1m
        "unclassified": 6,       # Range 4-8m, 6 is a reasonable average
        "construction": 5,       # Highly variable; assuming average 5m
        "elevator": 1.5,         # Not a road, but minimal width (~1.5m)
    }
    
    process_feature = process_feature_factory( params["trasformer"], **params)
    roads = []
    scale_ratio = 1/(int(params["scale"].split(":")[1])/1000) *1.25
    buffered = []
    types = set()
    # Process the features into the buildings list
    for feature in params["geojson_data"]['features']:
        tags = feature.get('properties', {}).get('tags', {})
        if (
            'highway' in tags 
            and feature.get('geometry', {}).get('type') != "Point"
            and not (tags.get('highway') == 'footway' and tags.get('footway') == 'crossing')
        ):
            shape = process_feature(feature) 
            types.add(feature["properties"]["tags"]["highway"])
            if isinstance(shape, shapely.LineString):
                buffered.append(shape.buffer(width_index.get(feature["properties"]["tags"]["highway"], 10) * scale_ratio))
            if isinstance(shape, shapely.MultiLineString):
                for segment in shape.geoms:
                    buffered.append(segment.buffer(width_index.get(feature["properties"]["tags"]["highway"], 10) * scale_ratio))
            # if isinstance(shape, shapely.Polygon):
            #     buffered.append(shape)
            # if isinstance(shape, shapely.MultiPolygon):
            #     buffered.append(shape)
            
    roads = shapely.union_all(buffered)
    
    from utils.filters.buildings import filter_buildings
    from utils.filters.parks import filter_parks
    
    def geometry():
        clipped = cut_fast_by(flatten(geometry_to_linestrings(roads)), filter_buildings(params)["mask"] )
        # clipped = cut_fast_by(clipped, filter_parks(params)["mask"] )   
        return order_geometries_tsp(connect_nearby_paths(clipped, 0.35))

    
    return {
        "geometry": geometry,
        "mask":roads
        }  # Ensure that flatten works as expected

def process_roads(params):
    return filter_roads(params)["geometry"]()
