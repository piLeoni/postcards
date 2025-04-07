from utils.ops import polygon_to_lines, flatten
import shapely
from shapely.geometry import MultiPolygon

def filter_buildings(geojson_data, process_feature):
    """
    Filters buildings from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered building features.
    """
    buildings = []
    
    # Process the features into the buildings list
    for feature in geojson_data['features']:
        tags = feature.get('properties', {}).get('tags', {})
        if 'building' in tags and feature.get('geometry', {}).get('type') != "Point":
            buildings.append(process_feature(feature))
    
    # Merge all building geometries into a single geometry
    mask = shapely.union_all(buildings)
    if isinstance(mask, MultiPolygon):
        mask = flatten(list(mask.geoms))
    countour_mask = shapely.union_all([polygon_to_lines(g).buffer(0.02) for g in mask])

    
    buildings = shapely.MultiLineString(shapely.union_all([polygon_to_lines(g) for g in buildings]))
    buildings = buildings.difference(countour_mask)

    
    return {
        "geometry": flatten([buildings, [polygon_to_lines(g) for g in mask] ]),
        "mask":mask
        }  # Ensure that flatten works as expected
