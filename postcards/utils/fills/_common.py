"""Shared geometry for the fill algorithms.

Everything here is shapely only: a fill takes polygons in page millimetres and
returns LineStrings. The helpers cover the parts every algorithm needs — get
the region into a usable shape, inset it, decide on a spacing, extract the
individual rings — plus the small builders that turn a run of points into a
LineString without accidentally emitting zero-length strokes.
"""

from __future__ import annotations

import math

import shapely
import shapely.affinity
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

# A stroke shorter than this is not ink: it is a rounding artefact and vpype
# would filter it out later anyway. Keeping it out of the output means the
# drawn-length numbers mean something.
MIN_SEGMENT_MM = 1e-6


def as_region(region) -> shapely.Geometry:
    """Coerce whatever the caller passed into a valid polygonal geometry.

    Accepts a Polygon, MultiPolygon, a list of either, or a shapely geometry
    collection. Returns an empty Polygon when there is nothing usable, so the
    algorithms never have to special-case "no geometry".
    """
    if region is None:
        return Polygon()

    if isinstance(region, (list, tuple)):
        if not region:
            return Polygon()
        region = shapely.union_all(region)

    if isinstance(region, shapely.GeometryCollection):
        polygons = [g for g in region.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        region = shapely.union_all(polygons) if polygons else Polygon()

    if not isinstance(region, BaseGeometry):
        return Polygon()

    if region.geom_type not in ("Polygon", "MultiPolygon"):
        return Polygon()
    if region.is_empty:
        return Polygon()
    # Repair self-touching rings: buffering by zero is the cheap, reliable fix
    # and it leaves well-formed input untouched.
    if not region.is_valid:
        region = region.buffer(0)
    return region


def inset(region: shapely.Geometry, amount: float) -> shapely.Geometry:
    """Shrink ``region`` by ``amount`` mm, keeping crisp corners.

    ``join_style=2`` is mitred, which is what a building footprint wants: a
    round join would turn every convex corner into an arc and the hatch would
    stop short of it.
    """
    if amount <= 0:
        return region
    return region.buffer(-amount, join_style="mitre", mitre_limit=5.0)


def default_inset(spacing: float) -> float:
    """The inset that keeps strokes ``spacing / 2`` off the boundary.

    This is the contract in docs/fills.md: a stroke at the very edge would sit
    on top of the outline stroke that is drawn separately.
    """
    return spacing / 2


def ring_polygons(region: shapely.Geometry) -> list[Polygon]:
    """Split a polygonal geometry into its component Polygons, holes included."""
    if region.is_empty:
        return []
    if isinstance(region, Polygon):
        return [region]
    if isinstance(region, MultiPolygon):
        return list(region.geoms)
    return [g for g in shapely.get_parts(region) if isinstance(g, Polygon)]


def polylines(geometry) -> list[LineString]:
    """Every LineString inside a geometry, flattening multi-geometries."""
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    # GeometryCollection, MultiLineString, MultiPolygon, … — recurse.
    if hasattr(geometry, "geoms"):
        out: list[LineString] = []
        for part in geometry.geoms:
            out.extend(polylines(part))
        return out
    return []


def segment(pts, start=None, end=None) -> LineString | None:
    """A LineString through ``pts``, with optional points prepended/appended.

    Returns ``None`` for anything degenerate, so callers can append freely and
    filter at the end instead of testing every coordinate themselves.
    """
    coords = list(pts)
    if start is not None:
        coords.insert(0, start)
    if end is not None:
        coords.append(end)
    if len(coords) < 2:
        return None
    line = LineString(coords)
    if line.length < MIN_SEGMENT_MM:
        return None
    return line


def clip_lines(lines: list[LineString], region: shapely.Geometry) -> list[LineString]:
    """Clip every line to ``region`` and return the pieces that survive."""
    if not lines:
        return []
    clipped = shapely.intersection(shapely.union_all(lines), region)
    return [line for line in polylines(clipped) if line.length >= MIN_SEGMENT_MM]


def sweep_lines(
    region: shapely.Geometry,
    spacing: float,
    angle: float = 0.0,
) -> list[LineString]:
    """Parallel lines ``spacing`` apart at ``angle`` degrees, clipped to region.

    The lines are long enough to cross the whole region, then clipped, so the
    result is a set of fragments. This is the shared first step of every
    direction-based fill (rectilinear, zigzag, skeleton).
    """
    if region.is_empty or spacing <= 0:
        return []

    # Work in the rotated frame: sweep horizontally, then rotate back. The
    # sweep lines are grown by the diagonal so they always overhang the region.
    rotated = shapely.affinity.rotate(region, -angle, origin=(0, 0))
    minx, miny, maxx, maxy = rotated.bounds
    length = math.hypot(maxx - minx, maxy - miny) + 2 * spacing

    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    # Offset the sweep so it is symmetric about the region centre: the first and
    # last lines then stand the same distance from the boundary, which keeps the
    # fill from being visibly one-sided.
    count = int((maxy - miny) / spacing) + 1
    first = cy - (count - 1) * spacing / 2

    lines = []
    for i in range(count):
        y = first + i * spacing
        lines.append(LineString([(cx - length / 2, y), (cx + length / 2, y)]))

    clipped = clip_lines(lines, rotated)
    if angle:
        clipped = [shapely.affinity.rotate(line, angle, origin=(0, 0)) for line in clipped]
    return [line for line in clipped if line.length >= MIN_SEGMENT_MM]
