import shapely
import pprint
from utils.ops import  flatten
def clipping_area(params):
    rectangle = shapely.Polygon([(params["buffer"], params["buffer"]),
                                (params["buffer"], params["height_mm"]-params["buffer"]),
                                (params["width_mm"]-params["buffer"], params["height_mm"]-params["buffer"]),
                                (params["width_mm"]-params["buffer"], params["buffer"]),
                                (params["buffer"], params["buffer"])
                                ])      
    return rectangle

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
    
def clip_by(to_clip, clipper):
    """
    Clip a geometry by another geometry.
    """
    lines = []
    if isinstance(to_clip, (list, tuple)):
        for geom in flatten(to_clip):
            lines += to_lines(geom)   
    else:
        lines += to_lines(geom)
    
    return list(shapely.MultiLineString(shapely.union_all(lines)).intersection(clipper).geoms)

def cut_by(to_clip, clipper):
    """
    Cut a geometry by another geometry.
    """
    lines = []
    if isinstance(to_clip, (list, tuple)):
        for geom in flatten(to_clip):
            lines += to_lines(geom)   
    else:
        lines += to_lines(geom)
    
    return list(shapely.MultiLineString(shapely.union_all(lines)).difference(clipper).geoms)

