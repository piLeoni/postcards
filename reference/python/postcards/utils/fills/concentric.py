"""Concentric rings: repeated inward offsets of the region.

Each ring is one closed polyline, so on a convex footprint this is a handful of
long strokes instead of a full set of hatch fragments. On a concave footprint
the rings split at the narrowings, which is the honest limitation of the
approach and the reason zigzag and skeleton exist.
"""

from __future__ import annotations

from shapely.geometry import LineString

from postcards.utils.fills._common import (
    as_region,
    default_inset,
    inset,
    ring_polygons,
)


def fill_concentric(
    region,
    spacing: float,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """Rings by iterated inward offset, ``spacing`` between neighbours.

    The first ring sits ``spacing / 2`` inside the boundary (the contract
    inset), and each subsequent ring is one ``spacing`` further in. Offsetting
    stops when the polygon vanishes, which happens sooner on thin shapes than
    the outer ring count suggests — that is correct, not a bug.
    """
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    current = inset(geo, amount)

    rings: list[LineString] = []
    # A generous guard rather than a `while True`: a spacing that is tiny
    # relative to the region should not be able to spin here.
    max_rings = 10_000
    guard = 0
    while not current.is_empty and guard < max_rings:
        guard += 1
        for polygon in ring_polygons(current):
            exterior = polygon.exterior
            if exterior.length > 0:
                rings.append(LineString(exterior.coords))
            # Holes become rings too: a courtyard is a legitimate path around,
            # and skipping them would leave the hole visibly empty.
            for interior in polygon.interiors:
                if interior.length > 0:
                    rings.append(LineString(interior.coords))
        current = inset(current, spacing)

    return rings
