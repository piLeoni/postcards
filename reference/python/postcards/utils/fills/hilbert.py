"""Hilbert-curve fill.

A space-filling curve clipped to the region. Locality is excellent for a CNC
that cares about travel, but for a pen the constant turning makes it look busy.
Kept as a classic to measure against, not as a recommendation — see docs/fills.md.
"""

from __future__ import annotations

import math

from shapely.geometry import LineString

from postcards.utils.fills._common import (
    MIN_SEGMENT_MM,
    as_region,
    default_inset,
    inset,
    polylines,
)


def _hilbert_xy(index: int, order: int) -> tuple[float, float]:
    """Map ``index`` in ``[0, 4^order)`` to a point on the unit Hilbert curve."""
    x = y = 0
    t = index
    s = 1
    for _ in range(order):
        rx = 1 & (t // 2)
        ry = 1 & (t ^ rx)
        if ry == 0:
            if rx == 1:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        x += s * rx
        y += s * ry
        t //= 4
        s *= 2
    n = 1 << order
    return x / n, y / n


def _order_for(side_mm: float, spacing: float) -> int:
    """Hilbert order so consecutive points are about ``spacing`` apart."""
    if side_mm <= 0 or spacing <= 0:
        return 1
    # Aim for cell width ≈ spacing/2 so clipped spikes (stars, thin arms) still
    # meet the coverage criterion used by the pattern tests.
    order = max(1, int(math.ceil(math.log2(max(side_mm / (spacing * 0.5), 2)))))
    return min(order, 8)  # 4^8 = 65536 points — enough for a postcard


def fill_hilbert(
    region,
    spacing: float,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """A Hilbert curve over the region's bounding box, clipped to the region."""
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    target = inset(geo, amount)
    if target.is_empty:
        return []

    minx, miny, maxx, maxy = target.bounds
    width = maxx - minx
    height = maxy - miny
    side = max(width, height)
    if side <= 0:
        return []

    order = _order_for(side, spacing)
    n = 1 << (2 * order)
    # Centre the square covering the bounds so the curve is not biased.
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    coords = []
    for i in range(n):
        u, v = _hilbert_xy(i, order)
        coords.append((cx - side / 2 + u * side, cy - side / 2 + v * side))

    curve = LineString(coords)
    clipped = curve.intersection(target)
    return [line for line in polylines(clipped) if line.length >= MIN_SEGMENT_MM]
