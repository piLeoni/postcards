import shapely



def geometry_to_linestrings(geom):
    if isinstance(geom, shapely.geometry.LineString):
        return [geom]
    elif isinstance(geom, shapely.geometry.MultiLineString):
        return list(geom.geoms)
    elif isinstance(geom, shapely.geometry.Polygon):
        lines = [shapely.LineString(geom.exterior)]
        lines.extend(shapely.LineString(ring) for ring in geom.interiors)
        return lines
    elif isinstance(geom, shapely.geometry.MultiPolygon):
        lines = []
        for poly in geom.geoms:
            lines.extend(geometry_to_linestrings(poly))
        return lines
    elif isinstance(geom, shapely.geometry.GeometryCollection):
        lines = []
        for g in geom.geoms:
            lines.extend(geometry_to_linestrings(g))
        return lines
    else:
        raise TypeError(f"Unsupported geometry type: {type(geom)}")


def polygons_to_linestrings(geom):
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geometry_to_linestrings(geom) 
    else:
        return geom
    
def multilinestring_to_linestrings(geom):
    if isinstance(geom, shapely.geometry.MultiLineString):
        return geometry_to_linestrings(geom) 
    else:
         return geom
     
def multipolygon_to_polygons(geom):
    if isinstance(geom, shapely.geometry.MultiPolygon):
        result = []
        for g in geom.geoms:
            result.extend(flatten(g))
        return result
    else:
        return geom


def flatten(obj):
    if isinstance(obj, (list, tuple, set, shapely.geometry.base.GeometrySequence)):
        result = []
        for item in obj:
            result.extend(flatten(item))
        return result
    elif isinstance(obj, shapely.geometry.GeometryCollection):
        result = []
        for geom in obj.geoms:
            result.extend(flatten(geom))
        return result
    else:
        return [obj]
    

