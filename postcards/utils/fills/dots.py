"""Area-fill algorithms that wrap the older card-wide patterns.

``dots`` and ``waves`` used to live only in ``postcards/utils/patterns/`` and
were hard-wired into the park / water filters. Registering them here lets any
theme pick them from ``[fill.<theme>]`` the same way buildings pick ``zigzag``.
"""

from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.affinity
from shapely.geometry import LineString

from postcards.utils.fills._common import as_region, clip_lines, inset, ring_polygons
from postcards.utils.patterns.dots import dots_pattern


def fill_dots(
    region,
    spacing: float,
    *,
    angle: float = 45,
    mark: float = 0.2,
    inset_mm: float | None = None,
    **_,
) -> list[LineString]:
    """Square grid of short marks clipped to ``region``."""
    region = as_region(region)
    if region.is_empty or spacing <= 0:
        return []
    # Stipple sits under a separate outline stroke; no default inset.
    if inset_mm is not None and inset_mm > 0:
        region = inset(region, inset_mm)
        if region.is_empty:
            return []

    # A mark shorter than the grid step is an isolated dab, so the grid can be
    # laid out on the region's whole rectangle and screened: dabs with both
    # ends inside are kept as built, dabs near the boundary are clipped. Going
    # through Shapely one dab at a time would walk a list of tens of thousands
    # of geometries per park, and a card-wide union of parks is exactly that.
    if mark < spacing:
        return _dab_grid(region, spacing, angle, mark)

    out: list[LineString] = []
    for poly in ring_polygons(region):
        bounds = poly.bounds
        marks = dots_pattern(
            {"width_mm": bounds[2] - bounds[0], "height_mm": bounds[3] - bounds[1]},
            spacing,
            angle,
            mark=mark,
            bounds=bounds,
        )
        out.extend(clip_lines(marks, poly))
    return out


def _dab_grid(region: shapely.Geometry, spacing: float, angle: float, mark: float) -> list[LineString]:
    """Dabs on a grid, clipped exactly to ``region``.

    Same result as `dots_pattern` + `clip_lines`, but the dabs are built from
    one coordinate array and every Shapely call stays a vectorised one.
    """
    minx, miny, maxx, maxy = region.bounds
    theta = math.radians(angle)
    cos, sin = abs(math.cos(theta)), abs(math.sin(theta))
    # The band is sized in the pattern's own frame, grown to the rotated
    # bounding box of the target (the `sweep_area` rule), then the grid is
    # rotated about the band centre — the same geometry `dots_pattern` lays
    # down, so the dabs land in exactly the same places it would put them.
    margin = spacing
    width = (maxx - minx) + 2 * margin
    height = (maxy - miny) + 2 * margin
    W, H = width * cos + height * sin, width * sin + height * cos
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    x0, y0 = cx - W / 2, cy - H / 2
    gx, gy = np.meshgrid(np.arange(x0, x0 + W, spacing), np.arange(y0, y0 + H, spacing))
    dx, dy = gx.ravel() - cx, gy.ravel() - cy
    tcos, tsin = math.cos(theta), math.sin(theta)
    px, py = cx + dx * tcos - dy * tsin, cy + dx * tsin + dy * tcos
    hx, hy = mark / 2 * tcos, mark / 2 * tsin

    coords = np.empty((px.size, 2, 2))
    coords[:, 0, 0], coords[:, 0, 1] = px - hx, py - hy
    coords[:, 1, 0], coords[:, 1, 1] = px + hx, py + hy
    marks = shapely.linestrings(coords)

    shapely.prepare(region)
    inside = shapely.contains_xy(region, coords[:, 0, 0], coords[:, 0, 1]) & shapely.contains_xy(
        region, coords[:, 1, 0], coords[:, 1, 1]
    )
    out: list = list(marks[inside])
    # Edge dabs: only these can cross the boundary, and an STRtree query keeps
    # the per-dab intersection loop down to the few that actually touch it.
    rest = np.flatnonzero(~inside)
    if rest.size:
        tree = shapely.STRtree(ring_polygons(region))
        touch = np.unique(tree.query(marks[rest], predicate="intersects"))
        clipped = shapely.intersection(marks[rest[touch]], region)
        out.extend(line for line in polylines(shapely.MultiLineString([l for l in clipped if not l.is_empty])) if line.length > 0)
    return out


def polylines(geometry):
    """Every LineString inside a geometry, flattening multi-geometries."""
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    if hasattr(geometry, "geoms"):
        out: list[LineString] = []
        for part in geometry.geoms:
            out.extend(polylines(part))
        return out
    return []


def fill_waves(
    region,
    spacing: float,
    *,
    angle: float = 0,
    inset_mm: float | None = None,
    **_,
) -> list[LineString]:
    """Sine-wave hatch clipped to ``region`` (historical water look)."""
    region = as_region(region)
    if region.is_empty or spacing <= 0:
        return []
    # Match the old water filter's 0.1 mm clearance unless the profile says otherwise.
    shrink = 0.1 if inset_mm is None else inset_mm
    if shrink > 0:
        region = inset(region, shrink)
        if region.is_empty:
            return []

    out: list[LineString] = []
    step = 0.1
    for poly in ring_polygons(region):
        minx, miny, maxx, maxy = poly.bounds
        margin = spacing
        width = (maxx - minx) + 2 * margin
        height = (maxy - miny) + 2 * margin
        cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
        if angle:
            theta = math.radians(angle)
            cos, sin = abs(math.cos(theta)), abs(math.sin(theta))
            width, height = width * cos + height * sin, width * sin + height * cos
        x0, y0 = cx - width / 2, cy - height / 2

        wavelength = spacing / 4
        frequency_scale = math.pi / wavelength / 8
        lines = []
        for y in np.arange(y0, y0 + height, spacing):
            coords = [
                (x, y + math.sin(x * frequency_scale) * wavelength)
                for x in np.arange(x0, x0 + width, step)
            ]
            if len(coords) >= 2:
                lines.append(LineString(coords))
        if angle != 0:
            lines = [
                shapely.affinity.rotate(line, angle, origin=(cx, cy)) for line in lines
            ]
        out.extend(clip_lines(lines, poly))
    return out
