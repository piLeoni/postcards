"""Parallel hatch lines, clipped to the region.

This is the current building fill expressed under the fills contract, so the
other algorithms have a baseline to beat. It is deliberately the same idea as
``patterns.lines.lines_pattern`` plus a clip, but it returns LineStrings in the
region's own frame rather than drawing a band on the whole card and trimming it
afterwards.
"""

from __future__ import annotations

from shapely.geometry import LineString

from postcards.utils.fills._common import (
    as_region,
    clip_lines,
    default_inset,
    inset,
    sweep_lines,
)


def fill_rectilinear(
    region,
    spacing: float,
    angle: float = 45.0,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """Lines ``spacing`` mm apart at ``angle`` degrees, alternating direction.

    Alternating the direction of consecutive lines does not join them — they
    are still separate strokes — but it halves the pen travel between them once
    ``linesort`` gets hold of the result.
    """
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    target = inset(geo, amount)
    if target.is_empty:
        return []

    lines = sweep_lines(target, spacing, angle)
    # The sweep is generated inside the inset polygon already, but clipping
    # against it once more is cheap insurance and makes containment explicit.
    lines = clip_lines(lines, target)

    out = []
    for index, line in enumerate(lines):
        coords = list(line.coords)
        if index % 2:
            coords.reverse()
        out.append(LineString(coords))
    return out
