"""Plain-Shapely geometry helpers.

Everything here takes and returns Shapely geometries or plain lists of them.
The GeoDataFrame-flavoured helpers live in :mod:`postcards.utils.gdf_ops`.
"""

from __future__ import annotations

import shapely


def geometry_to_linestrings(geom) -> list[shapely.LineString]:
    """Flatten any geometry into its constituent LineStrings, rings included."""
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
    """Recursively expand nested lists and multi-geometries into a flat list.

    The single general-purpose flattener for this codebase; ``gdf_ops`` relies
    on it for its GeoDataFrame-level equivalents.
    """
    if obj is None:
        return []
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


def is_drawable(geom) -> bool:
    """True for geometries that can actually be drawn: valid and non-empty."""
    return (
        isinstance(geom, shapely.geometry.base.BaseGeometry)
        and not geom.is_empty
        and geom.is_valid
    )


def clip_by(to_clip, clipper) -> list:
    """Keep only the parts of ``to_clip`` inside ``clipper``.

    Returns a flat list of valid, non-empty geometries; the result may be mixed
    types because an intersection can produce them.
    """
    clipper_union = shapely.union_all(flatten(clipper))
    if clipper_union.is_empty:
        return []
    parts = flatten([geometry_to_linestrings(g) for g in flatten(to_clip)])
    return [g for g in (p.intersection(clipper_union) for p in parts) if is_drawable(g)]


def cut_by(to_clip, clipper) -> list:
    """Remove the parts of ``to_clip`` covered by ``clipper``."""
    clipper_union = shapely.union_all(flatten(clipper))
    parts = flatten([geometry_to_linestrings(g) for g in flatten(to_clip)])
    return [g for g in (p.difference(clipper_union) for p in parts) if is_drawable(g)]


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
