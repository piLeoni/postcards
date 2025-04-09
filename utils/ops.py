import shapely
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection, LineString, MultiLineString
from shapely.ops import unary_union
import concurrent.futures


def to_lines(geom):
    if isinstance(geom, shapely.geometry.LineString):
        return [geom]
    elif isinstance(geom, shapely.geometry.MultiLineString):
        return list(geom.geoms)
    elif isinstance(geom, shapely.geometry.Polygon):
        return [shapely.geometry.LineString(geom.exterior.coords)] + [
            shapely.geometry.LineString(interior.coords) for interior in geom.interiors
        ]
    elif isinstance(geom, shapely.geometry.MultiPolygon):
        lines = []
        for poly in geom.geoms:
            lines.extend(to_lines(poly))
        return lines
    else:
        raise TypeError(f"Unsupported geometry type: {type(geom)}")


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
    

