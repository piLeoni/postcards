from utils.ops import polygons_to_linestrings,geometry_to_linestrings, flatten
from utils.process_feature_factory import process_feature_factory
import shapely
from shapely.geometry import MultiPolygon, Polygon
from utils.optimize import order_geometries_tsp, connect_nearby_paths
from utils.clipping_area import clipping_area, clip_by, cut_by
from utils.patterns.lines import lines_pattern
import pprint

def filter_buildings(params):
    """
    Filters buildings from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered building features.
    """
    
    def get_highest_level(feature):
        """Extracts the highest numeric level from a feature's tags."""
        tags = feature.get('properties', {}).get('tags', {})
        level_str = str(tags.get('level', '0'))  # force to string, just in case

        try:
            # Split on ';' (even if there's no ';', split() still returns ['number'])
            levels = [
                int(lvl.strip()) 
                for lvl in level_str.split(';') 
                if lvl.strip().lstrip('-').isdigit()
            ]
            return max(levels) if levels else 0
        except Exception:
            return 0
        
    def get_highest_layer(feature):
        """Extracts the highest numeric layer from a feature's tags."""
        tags = feature.get('properties', {}).get('tags', {})
        layer_str = str(tags.get('layer', '0'))  # force to string, just in case

        try:
            # Split on ';' (even if there's no ';', split() still returns ['number'])
            layers = [
                int(lvl.strip()) 
                for lvl in layer_str.split(';') 
                if lvl.strip().lstrip('-').isdigit()
            ]
            return max(layers) if layers else 0
        except Exception:
            return 0
        
    buildings = []
    
    # Process the features into the buildings list
    process_feature = process_feature_factory( params["trasformer"], **params)

    for feature in params['geojson_data']['features']:
        tags = feature.get('properties', {}).get('tags', {})
        if ('building' in tags 
            and feature.get('geometry', {}).get('type') != "Point"
            and get_highest_level(feature) >= 0 
            and get_highest_layer(feature) >= 0 
            ):
            buildings.append(process_feature(feature))
    
   
    mask = [g for g in flatten(shapely.union_all(buildings)) if isinstance(g, (Polygon, MultiPolygon))]

    def geometry():
        contour_lines = flatten([polygons_to_linestrings(g) for g in mask])
        countour_mask = shapely.union_all([g.buffer(0.02) for g in contour_lines])
        building_lines = flatten([polygons_to_linestrings(g) for g in buildings])
        buildings_lines = shapely.MultiLineString(shapely.union_all(building_lines))
        buildings_details = order_geometries_tsp(connect_nearby_paths(list(buildings_lines.difference(countour_mask).geoms), 0.35))
        buildings_outlines = order_geometries_tsp(flatten([geometry_to_linestrings(g) for g in mask]))
        return flatten([buildings_outlines, buildings_details])
    
    def patterns():
        return clip_by(lines_pattern(params, 0.5, 45), mask)

    return {
        # "geometry": flatten([buildings, [polygons_to_linestrings(g) for g in mask] ]),
        # "geometry": flatten([[polygons_to_linestrings(g) for g in mask], buildings_details ]),
        "geometry": geometry,
        "patterns": patterns,
        # "internal_details": flatten(buildings_details),
        # "outlines": buildings_outlines,
        "mask": mask
        }  # Ensure that flatten works as expected

def process_buildings(params):
    buildings = filter_buildings(params)
    geometry = buildings["geometry"]()
    patterns = buildings["patterns"]()
    return [geometry, patterns]
