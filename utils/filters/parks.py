from utils.ops import polygons_to_linestrings,geometry_to_linestrings, flatten
import shapely
from shapely.geometry import MultiPolygon, Polygon
from utils.clipping_area import clipping_area, clip_by, cut_by, cut_fast_by
from utils.patterns.dots import dots_pattern

from utils.process_feature_factory import process_feature_factory
from utils.optimize import order_geometries_tsp, connect_nearby_paths

def safe_buffer(geom):
    """Try to fix an invalid geometry using buffer(0)."""
    if not geom.is_valid:
        try:
            return geom.buffer(0)
        except Exception:
            return None  # or handle differently
    return geom

def filter_parks(params):
    """
    Filters buildings from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered building features.
    """
    parks = []
    process_feature = process_feature_factory( params["trasformer"], **params)

    
    # Process the features into the buildings list
    for feature in params['geojson_data']['features']:
        landuse = feature.get('properties', {}).get('tags', {}).get("landuse")
        leisure = feature.get('properties', {}).get('tags', {}).get("leisure")
        natural = feature.get('properties', {}).get('tags', {}).get("natural")
        if(landuse == "grass" or leisure == "park" or natural == "wood"):
            parks.append(safe_buffer(process_feature(feature)))

    mask = [g for g in flatten(shapely.union_all(parks)) if isinstance(g, (Polygon, MultiPolygon))]
    
    if isinstance(mask, MultiPolygon):
        mask = flatten(list(mask.geoms))
    
    from utils.filters.buildings import filter_buildings, process_buildings
    from utils.filters.roads import filter_roads, process_roads
    from utils.filters.water import filter_water

    def geometry():
        
        parks_outlines = flatten([geometry_to_linestrings(g) for g in mask])
        clipped = cut_fast_by(parks_outlines, filter_buildings(params)["mask"] )
        clipped = cut_fast_by(clipped, filter_roads(params)["mask"] )
        clipped = cut_fast_by(clipped, filter_water(params)["mask"] )

        return order_geometries_tsp(connect_nearby_paths(clipped, 0.35))
    
    def patterns():
        pattern = clip_by(dots_pattern(params, 0.5, 45), mask)
        clipped = cut_fast_by(pattern, filter_buildings(params)["mask"] )
        clipped = cut_fast_by(clipped, filter_roads(params)["mask"] )
        clipped = cut_fast_by(clipped, filter_water(params)["mask"] )

        return clipped

    return {
        "geometry": geometry,
        "patterns": patterns,
        "mask": mask
        } 
    
def process_parks(params):
    parks = filter_parks(params)
    geometry = parks["geometry"]()
    patterns = parks["patterns"]()
    return [geometry, patterns]
