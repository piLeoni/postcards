"""Dash a continuous line into on/off segments for the plotter.

SVG ``stroke-dasharray`` does not survive vpype → G-code, so dashes must be
real geometry: short LineStrings with gaps between them.
"""

from __future__ import annotations

import shapely
from shapely.ops import substring


def dash_linestring(
    line: shapely.LineString,
    dash: float = 0.45,
    gap: float = 0.35,
) -> list[shapely.LineString]:
    """Split ``line`` into alternating dash/gap pieces along its length.

    ``dash`` / ``gap`` are lengths in the same units as the line (mm on card).
    """
    if line is None or line.is_empty or line.length <= 0:
        return []
    if dash <= 0:
        return [line]

    period = dash + max(gap, 0.0)
    out: list[shapely.LineString] = []
    t = 0.0
    length = float(line.length)
    while t < length - 1e-9:
        t1 = min(t + dash, length)
        if t1 - t > 1e-6:
            piece = substring(line, t, t1, normalized=False)
            if piece.is_empty:
                pass
            elif piece.geom_type == "LineString" and piece.length > 1e-6:
                out.append(piece)
            else:
                for g in getattr(piece, "geoms", []):
                    if g.geom_type == "LineString" and g.length > 1e-6:
                        out.append(g)
        t += period
    return out


def _lineal_parts(geom: shapely.geometry.base.BaseGeometry) -> list[shapely.LineString]:
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type == "LinearRing":
        return [shapely.LineString(geom.coords)]
    if geom.geom_type == "MultiLineString":
        return list(geom.geoms)
    if geom.geom_type == "Polygon":
        out = [shapely.LineString(geom.exterior.coords)]
        out.extend(shapely.LineString(r.coords) for r in geom.interiors)
        return out
    if geom.geom_type == "MultiPolygon":
        out: list[shapely.LineString] = []
        for poly in geom.geoms:
            out.extend(_lineal_parts(poly))
        return out
    if geom.geom_type == "GeometryCollection":
        out = []
        for g in geom.geoms:
            out.extend(_lineal_parts(g))
        return out
    return []


def dash_geometry(
    geom: shapely.geometry.base.BaseGeometry,
    dash: float = 0.45,
    gap: float = 0.35,
) -> list[shapely.LineString]:
    """Dash every lineal component of ``geom`` (rings, multilines, …)."""
    out: list[shapely.LineString] = []
    for line in _lineal_parts(geom):
        out.extend(dash_linestring(line, dash, gap))
    return out
