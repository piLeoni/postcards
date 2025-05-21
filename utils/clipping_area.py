import shapely
from utils.ops import  flatten, geometry_to_linestrings


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
    
# def clip_by(to_clip, clipper):
#     """
#     Clip a geometry by another geometry.
#     """
#     # output = flatten([g.intersection(shapely.union_all(clipper)) for g in flatten(to_clip)])
#     # output = [g for g in output if isinstance(g, shapely.geometry.base.BaseGeometry) and not g.is_empty and g.is_valid]
#     output =  flatten(shapely.MultiLineString(to_clip).intersection(shapely.union_all(clipper)).geoms)
#     return output



def clip_fast_by(to_clip, clipper):
    """
    Clip a geometry by another geometry.
    """
    clipper = shapely.union_all(clipper)
    output = shapely.MultiLineString(to_clip).intersection(clipper)
    output = flatten(output.geoms)
    # output = [g for g in output if isinstance(g, shapely.geometry.base.BaseGeometry) and not g.is_empty and g.is_valid]
    return output


def clip_by(to_clip, clipper):
    """
    Clip a geometry by another geometry.
    """
    clipper = shapely.union_all(clipper)
    output = flatten([geometry_to_linestrings(g.intersection(clipper)) for g in flatten(to_clip)])
    output = [g for g in output if isinstance(g, shapely.geometry.base.BaseGeometry) and not g.is_empty and g.is_valid]    
    return output



# def cut_fast_by(to_clip, clipper):
#     """
#     Clip a geometry by another geometry.
#     """
#     output =  flatten(shapely.MultiLineString(to_clip).difference(shapely.union_all(clipper)).geoms)
#     return output
def cut_fast_by(to_clip, clipper):
    """
    Clip a geometry by another geometry, handling multiple result types safely.
    """
    # Filter to only valid, non-empty line-like geometries
    valid_lines = [g for g in to_clip if isinstance(g, shapely.geometry.LineString) and not g.is_empty and g.is_valid]
    if not valid_lines:
        return []

    # Create MultiLineString
    multi_line = shapely.MultiLineString(valid_lines)
    clipper_union = shapely.union_all(clipper)

    result = multi_line.difference(clipper_union)

    # Handle possible geometry types from the difference operation
    if isinstance(result, (shapely.geometry.MultiLineString, shapely.geometry.GeometryCollection)):
        return flatten(result.geoms)
    elif isinstance(result, shapely.geometry.LineString):
        return [result]
    elif result.is_empty:
        return []
    else:
        # If something unexpected is returned
        return [result]
    
def cut_by(to_clip, clipper):
    """
    Clip a geometry by another geometry.
    """
    clipper = shapely.union_all(clipper)
    output = flatten([geometry_to_linestrings(g.difference(clipper)) for g in flatten([to_clip])])
    output = [g for g in output if isinstance(g, shapely.geometry.base.BaseGeometry) and not g.is_empty and g.is_valid]    
    return output