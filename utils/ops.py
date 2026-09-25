"""Geometry type conversions and clipping helpers.

Everything here works on plain Shapely geometries or lists of them; the
GeoDataFrame-flavoured helpers live in :mod:`utils.gdf_ops`.
"""

from __future__ import annotations

import shapely


def geometry_to_linestrings(geom) -> list[shapely.LineString]:
    """Flatten any geometry into its constituent LineStrings (rings included)."""
    if geom is None:
        return []
    if isinstance(geom, shapely.LineString):
        return [geom]
    if isinstance(geom, shapely.MultiLineString):
        return list(geom.geoms)
    if isinstance(geom, shapely.Polygon):
        lines = [shapely.LineString(geom.exterior)]
        lines.extend(shapely.LineString(ring) for ring in geom.interiors)
        return lines
    if isinstance(geom, shapely.MultiPolygon):
        lines = []
        for poly in geom.geoms:
            lines.extend(geometry_to_linestrings(poly))
        return lines
    if isinstance(geom, shapely.GeometryCollection):
        lines = []
        for part in geom.geoms:
            lines.extend(geometry_to_linestrings(part))
        return lines
    raise TypeError(f"Unsupported geometry type: {type(geom)}")


def flatten(obj) -> list:
    """Recursively expand lists/tuples/multi-geometries into a flat list."""
    if isinstance(obj, (list, tuple, set, shapely.geometry.base.GeometrySequence)):
        result = []
        for item in obj:
            result.extend(flatten(item))
        return result
    if isinstance(obj, shapely.GeometryCollection):
        result = []
        for geom in obj.geoms:
            result.extend(flatten(geom))
        return result
    return [obj]


def clip_by(to_clip, clipper) -> list:
    """Keep only the parts of ``to_clip`` that fall inside ``clipper``.

    Returns a flat list of valid, non-empty geometries (lines, as this is used
    for stroke work).
    """
    clipper_union = shapely.union_all(clipper)
    parts = flatten([geometry_to_linestrings(g) for g in flatten(to_clip)])
    output = [g.intersection(clipper_union) for g in parts]
    return _valid_lines(output)


def cut_by(to_clip, clipper) -> list:
    """Remove the parts of ``to_clip`` covered by ``clipper``."""
    clipper_union = shapely.union_all(clipper)
    parts = flatten([geometry_to_linestrings(g) for g in flatten(to_clip)])
    output = [g.difference(clipper_union) for g in parts]
    return _valid_lines(output)


def _valid_lines(geoms: list) -> list:
    """Flatten intersections/differences and drop empties and invalid results."""
    flat = flatten(geoms)
    return [
        g
        for g in flat
        if isinstance(g, shapely.geometry.base.BaseGeometry)
        and not g.is_empty
        and g.is_valid
    ]


def clipping_rectangle(params: dict) -> shapely.Polygon:
    """The drawable card area, inset by ``padding`` mm on all sides."""
    pad = params["padding"]
    width, height = params["width_mm"], params["height_mm"]
    return shapely.Polygon(
        [
            (pad, pad),
            (pad, height - pad),
            (width - pad, height - pad),
            (width - pad, pad),
            (pad, pad),
        ]
    )
