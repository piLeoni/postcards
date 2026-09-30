"""Orthogonal grid: two serpentines at right angles.

Not two sets of disconnected hatch fragments — that would leave joining to
``linesort``, which can route outside the footprint. Each direction is a
``zigzag`` traversal, so the pen finishes one orientation as a handful of
continuous strokes before starting the other.
"""

from __future__ import annotations

from shapely.geometry import LineString

from postcards.utils.fills._common import as_region, default_inset
from postcards.utils.fills.zigzag import fill_zigzag


def fill_grid(
    region,
    spacing: float,
    angle: float = 0.0,
    inset_mm: float | None = None,
    connector: str = "band",
    **options,
) -> list[LineString]:
    """Zigzag at ``angle``, then zigzag at ``angle+90``, same spacing."""
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    kwargs = dict(inset_mm=amount, connector=connector)
    a = fill_zigzag(geo, spacing, angle=angle, **kwargs)
    b = fill_zigzag(geo, spacing, angle=angle + 90.0, **kwargs)
    return a + b
