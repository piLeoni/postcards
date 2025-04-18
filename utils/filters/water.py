from utils.ops import polygons_to_linestrings,geometry_to_linestrings, flatten
import shapely
from shapely.geometry import MultiPolygon, Polygon
from utils.clipping_area import clipping_area, clip_by, cut_by
from utils.patterns.waves import waves_pattern
from utils.process_feature_factory import process_feature_factory
from utils.clipping_area import clipping_area, clip_by, cut_fast_by


def safe_buffer(geom):
    """Try to fix an invalid geometry using buffer(0)."""
    if not geom.is_valid:
        try:
            return geom.buffer(0)
        except Exception:
            return None  # or handle differently
    return geom

def filter_water(params):
    """
    Filters buildings from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered building features.
    """
    waters = []
    coastline = []

    process_feature = process_feature_factory( params["trasformer"], **params)

    # Process the features into the buildings list
    for feature in params['geojson_data']['features']:
        nature = feature.get('properties', {}).get('tags', {}).get("nature")
        water = feature.get('properties', {}).get('tags', {}).get("water")
        natural = feature.get('properties', {}).get('tags', {}).get("natural")

        if(nature == "water" or water ):
            waters.append(safe_buffer(process_feature(feature)))
        if(natural == "coastline"):
            coastline.append(process_feature(feature))

        # if ('landuse' in tags and ):
            # buildings.append(process_feature(feature))
    
    # Merge all building geometries into a single geometry
    # print(">"*30,type(parks))
    # mask = shapely.union_all(parks)
    mask = [g for g in flatten(shapely.union_all(waters)) if isinstance(g, (Polygon, MultiPolygon))]

    # print(")"*30,type(mask))

    # mask = [g for g in flatten(shapely.union_all(parks)) if isinstance(g, (Polygon, MultiPolygon))]
    
    if isinstance(mask, MultiPolygon):
        mask = flatten(list(mask.geoms))
        
    # contour_lines = flatten([polygons_to_linestrings(g) for g in mask])
    # countour_mask = shapely.union_all([g.buffer(0.02) for g in contour_lines])

    # parks_lines = flatten([polygons_to_linestrings(g) for g in parks])
    # parks_lines = [g for g in parks_lines if g.geom_type in ("LineString", "MultiLineString")]
    # parks = shapely.MultiLineString(shapely.union_all(parks_lines))
    # parks = list([parks.difference(countour_mask)])
    
    from utils.filters.buildings import filter_buildings, process_buildings
    from utils.filters.roads import filter_roads, process_roads

    def geometry():
        print("coastline", coastline)
        water_outlines = flatten([[geometry_to_linestrings(g) for g in mask]])
        clipped = cut_fast_by(water_outlines, filter_roads(params)["mask"])
        clipped = cut_fast_by(clipped, filter_buildings(params)["mask"])
        return flatten(clipped)
    
    def patterns():
        pattern = clip_by(waves_pattern(params, 0.75, 0), mask)
        clipped = cut_fast_by(pattern, filter_roads(params)["mask"])
        clipped = cut_fast_by(clipped, filter_buildings(params)["mask"])
        return flatten([clipped])

        
        

    return {
        # "geometry": flatten([buildings, [polygons_to_linestrings(g) for g in mask] ]),
        # "geometry": flatten([[polygons_to_linestrings(g) for g in mask], parks ]),
        "geometry": geometry,
        "patterns": patterns,
        # "internal_details": flatten(parks),
        # "outlines": flatten([geometry_to_linestrings(g) for g in mask]),


        "mask": mask
        }  # Ensure that flatten works as expected

def process_water(params):
    water = filter_water(params)
    geometry = water["geometry"]()
    patterns = water["patterns"]()
    return [geometry, patterns]
