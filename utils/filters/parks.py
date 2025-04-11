from utils.ops import polygons_to_linestrings,geometry_to_linestrings, flatten
import shapely
from shapely.geometry import MultiPolygon

def filter_parks(geojson_data, process_feature):
    """
    Filters buildings from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered building features.
    """
    parks = []
    
    # Process the features into the buildings list
    for feature in geojson_data['features']:
        landuse = feature.get('properties', {}).get('tags', {}).get("landuse")
        leisure = feature.get('properties', {}).get('tags', {}).get("leisure")
        natural = feature.get('properties', {}).get('tags', {}).get("natural")
        
        if(landuse == "grass" or leisure == "park" or natural == "wood"):
            parks.append(process_feature(feature))
        # if ('landuse' in tags and ):
            # buildings.append(process_feature(feature))
    
    # Merge all building geometries into a single geometry
    mask = shapely.union_all(parks)
    if isinstance(mask, MultiPolygon):
        mask = flatten(list(mask.geoms))
    contour_lines = flatten([polygons_to_linestrings(g) for g in mask])
    countour_mask = shapely.union_all([g.buffer(0.02) for g in contour_lines])

    parks_lines = flatten([polygons_to_linestrings(g) for g in parks])
    parks_lines = [g for g in parks_lines if g.geom_type in ("LineString", "MultiLineString")]
    parks = shapely.MultiLineString(shapely.union_all(parks_lines))
    parks = list([parks.difference(countour_mask)])

    
    return {
        # "geometry": flatten([buildings, [polygons_to_linestrings(g) for g in mask] ]),
        "geometry": flatten([[polygons_to_linestrings(g) for g in mask], parks ]),
        "internal_details": flatten([parks ]),
        "outlines": flatten([geometry_to_linestrings(g) for g in mask]),

        "mask": shapely.MultiPolygon(mask)
        }  # Ensure that flatten works as expected
