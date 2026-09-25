"""Honeycomb (hexagonal) fill.

Three sets of parallel lines at 0°, 60° and 120°, spaced so they form a
hexagonal lattice. Classic slicer ``honeycomb`` / ``triangles`` look; denser
than a single hatch, and the three directions give it a woven texture under a
pen.
"""

from __future__ import annotations

from shapely.geometry import LineString

from postcards.utils.fills._common import as_region, default_inset
from postcards.utils.fills.rectilinear import fill_rectilinear


def fill_honeycomb(
    region,
    spacing: float,
    angle: float = 0.0,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """Three hatches at ``angle``, ``angle+60``, ``angle+120``.

    The line spacing is ``spacing * √3 / 2`` so the intersections form regular
    hexagons of apothem ≈ ``spacing / 2``.
    """
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    # Slightly wider than ``spacing`` so the three directions do not pile up
    # into a near-solid black at the intersections.
    line_spacing = spacing * (3**0.5) / 2
    out: list[LineString] = []
    for offset in (0.0, 60.0, 120.0):
        out.extend(
            fill_rectilinear(
                geo, line_spacing, angle=angle + offset, inset_mm=amount
            )
        )
    return out
