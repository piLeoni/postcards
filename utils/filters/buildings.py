from utils.ops import polygons_to_linestrings,geometry_to_linestrings, flatten
import shapely
from shapely.geometry import MultiPolygon, Polygon

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
        if ('building' in tags 
            and feature.get('geometry', {}).get('type') != "Point"
            and int(feature.get('properties', {}).get('tags', {}).get('level', 0)) >= 0 
            ):
            buildings.append(process_feature(feature))
    
    # Merge all building geometries into a single geometry
    # mask = shapely.union_all(buildings)
    # if isinstance(mask, MultiPolygon):
    #     mask = flatten(mask.geoms)
    # print(type(mask))
    # mask = flatten(shapely.union_all(buildings))
    mask = [g for g in flatten(shapely.union_all(buildings)) if isinstance(g, (Polygon, MultiPolygon))]

    contour_lines = flatten([polygons_to_linestrings(g) for g in mask])
    countour_mask = shapely.union_all([g.buffer(0.02) for g in contour_lines])

    building_lines = flatten([polygons_to_linestrings(g) for g in buildings])
    buildings_lines = shapely.MultiLineString(shapely.union_all(building_lines))
    buildings_details = list(buildings_lines.difference(countour_mask).geoms)
    buildings_outlines = [geometry_to_linestrings(g) for g in mask]

    return {
        # "geometry": flatten([buildings, [polygons_to_linestrings(g) for g in mask] ]),
        # "geometry": flatten([[polygons_to_linestrings(g) for g in mask], buildings_details ]),
        "geometry": flatten([buildings_outlines, buildings_details ]),
        "internal_details": flatten(buildings_details),
        "outlines": flatten(buildings_outlines),
        "mask": mask
        }  # Ensure that flatten works as expected
