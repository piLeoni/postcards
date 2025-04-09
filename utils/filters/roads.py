from utils.ops import polygon_to_lines, flatten, to_lines
import shapely
from shapely.geometry import MultiPolygon
import pprint



def filter_roads(geojson_data, process_feature):
    """
    Filters roads from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered roads features.
    """
    roads = []
    
    # Process the features into the buildings list
    for feature in geojson_data['features']:
        tags = feature.get('properties', {}).get('tags', {})
        if 'highway' in tags and feature.get('geometry', {}).get('type') != "Point":
            roads.append(process_feature(feature))
    buffered = []
    for road in roads:
        if isinstance(road, shapely.LineString):
            buffered.append(road.buffer(0.25))
        if isinstance(road, shapely.MultiLineString):
            for segment in road.geoms:
                buffered.append(segment.buffer(0.25))
        if isinstance(road, shapely.Polygon):
            buffered.append(road)
        if isinstance(road, shapely.MultiPolygon):
            buffered.append(road)

            # pprint.pprint(road)
        # else:
        #     buffered.append(road)
    
    # roads = buffered
    # Merge all building geometries into a single geometry
    roads = shapely.union_all(buffered)

    
    return {
        "geometry": flatten(to_lines(roads)),

        "mask":roads
        }  # Ensure that flatten works as expected
