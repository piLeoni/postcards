"""Honeycomb fill: three serpentines at 60° to each other.

Same idea as ``grid`` — do not emit disconnected hatch fragments and hope
``linesort`` stitches them. Each direction is a ``zigzag`` path inside the
region; the three passes form the hexagonal lattice when overlaid.
"""

from __future__ import annotations

from shapely.geometry import LineString

from postcards.utils.fills._common import as_region, default_inset
from postcards.utils.fills.zigzag import fill_zigzag


def fill_honeycomb(
    region,
    spacing: float,
    angle: float = 0.0,
    inset_mm: float | None = None,
    connector: str = "band",
    **options,
) -> list[LineString]:
    """Zigzag at ``angle``, ``angle+60``, ``angle+120``.

    Line spacing is ``spacing · √3 / 2`` so the intersections form regular
    hexagons of apothem ≈ ``spacing / 2``.
    """
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    line_spacing = spacing * (3**0.5) / 2
    kwargs = dict(inset_mm=amount, connector=connector)
    out: list[LineString] = []
    for offset in (0.0, 60.0, 120.0):
        out.extend(
            fill_zigzag(geo, line_spacing, angle=angle + offset, **kwargs)
        )
    return out
