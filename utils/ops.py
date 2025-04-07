import shapely
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection, LineString, MultiLineString
from shapely.ops import unary_union
import concurrent.futures

def polygon_to_lines(geom):
    if geom.geom_type in ("LineString", "MultiLineString"):
        return geom
    elif geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom.boundary  # Includes exterior and interior (holes)
    else:
        return None  # or raise ValueError(f"Unsupported geometry type: {geom.geom_type}"
    
def flatten(obj):
    if isinstance(obj, (list, tuple, set)):
        result = []
        for item in obj:
            result.extend(flatten(item))
        return result
    elif isinstance(obj, (shapely.geometry.MultiPolygon, shapely.geometry.GeometryCollection)):
        result = []
        for geom in obj.geoms:
            result.extend(flatten(geom))
        return result
    else:
        return [obj]
    

