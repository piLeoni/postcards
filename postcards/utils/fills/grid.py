"""Orthogonal grid: horizontal and vertical hatch at ``spacing``.

The classic slicer ``grid`` infill. Twice the ink of a single hatch, but the
crosses read as a solid fill from a distance and need no connectors — every
stroke is already a full scan line clipped to the region.
"""

from __future__ import annotations

from shapely.geometry import LineString

from postcards.utils.fills._common import as_region, default_inset
from postcards.utils.fills.rectilinear import fill_rectilinear


def fill_grid(
    region,
    spacing: float,
    angle: float = 0.0,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """Two orthogonal hatches, ``spacing`` apart, at ``angle`` and ``angle+90``."""
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    # Reuse rectilinear twice so the inset and clip contract stay identical.
    a = fill_rectilinear(geo, spacing, angle=angle, inset_mm=amount)
    b = fill_rectilinear(geo, spacing, angle=angle + 90.0, inset_mm=amount)
    return a + b
