import shapely
import pprint
import numpy as np
from utils.ops import  flatten
def clipping_area(params):
    rectangle = shapely.Polygon([(params["padding"], params["padding"]),
                                (params["padding"], params["height_mm"]-params["padding"]),
                                (params["width_mm"]-params["padding"], params["height_mm"]-params["padding"]),
                                (params["width_mm"]-params["padding"], params["padding"]),
                                (params["padding"], params["padding"])
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
    # output = flatten([g.intersection(shapely.union_all(clipper)) for g in flatten(to_clip)])
    # output = [g for g in output if isinstance(g, shapely.geometry.base.BaseGeometry) and not g.is_empty and g.is_valid]
    output =  flatten(shapely.MultiLineString(to_clip).intersection(shapely.union_all(clipper)).geoms)
    return output

def cut_by(to_clip, clipper):
    """
    Clip a geometry by another geometry.
    """
    # output = flatten([g.difference(clipper) for g in flatten(to_clip)])
    # output = [g for g in output if isinstance(g, shapely.geometry.base.BaseGeometry) and not g.is_empty and g.is_valid]
    output =  flatten(shapely.MultiLineString(to_clip).difference(shapely.union_all(clipper)).geoms)

    return output