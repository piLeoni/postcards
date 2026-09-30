"""Spiral fill: concentric rings joined into one continuous path per polygon.

Built on top of ``fill_concentric``: the rings are already inset and ordered
outside-in; this stitches each ring to the next with a short radial hop so a
convex footprint becomes a single stroke. On a concave footprint the rings may
already be split, and each piece is spiralled independently.
"""

from __future__ import annotations

import math

from shapely.geometry import LineString

from postcards.utils.fills._common import as_region, default_inset, segment
from postcards.utils.fills.concentric import fill_concentric


def _closest_index(coords: list[tuple[float, float]], point: tuple[float, float]) -> int:
    best_i, best_d = 0, float("inf")
    for i, (x, y) in enumerate(coords):
        d = (x - point[0]) ** 2 + (y - point[1]) ** 2
        if d < best_d:
            best_i, best_d = i, d
    return best_i


def _rotate_to(coords: list[tuple[float, float]], index: int) -> list[tuple[float, float]]:
    """Open a closed ring so it starts (and ends) at ``coords[index]``."""
    if not coords:
        return coords
    # Drop the closing duplicate if present.
    ring = coords[:-1] if coords[0] == coords[-1] else list(coords)
    if not ring:
        return coords
    index %= len(ring)
    opened = ring[index:] + ring[:index]
    return opened + [opened[0]]


def _spiralise(rings: list[LineString], max_hop: float) -> list[LineString]:
    """Join rings outside-in into as few paths as possible."""
    if not rings:
        return []

    # Group by roughly-shared centroid so nested rings of one building stay
    # together and separate buildings do not get cross-joined.
    groups: list[list[LineString]] = []
    for ring in rings:
        c = ring.centroid
        placed = False
        for group in groups:
            gc = group[0].centroid
            if math.hypot(c.x - gc.x, c.y - gc.y) < max_hop * 4:
                group.append(ring)
                placed = True
                break
        if not placed:
            groups.append([ring])

    paths: list[LineString] = []
    for group in groups:
        # Outside-in: longest ring first.
        group = sorted(group, key=lambda r: -r.length)
        coords: list[tuple[float, float]] = []
        for ring in group:
            ring_coords = list(ring.coords)
            if not coords:
                coords = ring_coords
                continue
            # Attach at the point on the next ring closest to where we are.
            attach = _closest_index(ring_coords, coords[-1])
            hop = math.dist(coords[-1], ring_coords[attach])
            if hop > max_hop:
                path = segment(coords)
                if path is not None:
                    paths.append(path)
                coords = ring_coords
                continue
            rotated = _rotate_to(ring_coords, attach)
            # Skip the duplicate start point of the closed ring after the hop.
            coords.extend(rotated)
        path = segment(coords)
        if path is not None:
            paths.append(path)
    return paths


def fill_spiral(
    region,
    spacing: float,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """Concentric rings joined into spirals, one path per nested group."""
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    rings = fill_concentric(geo, spacing, inset_mm=amount)
    if not rings:
        return []

    # A hop longer than two spacings is a jump across a courtyard — refuse it.
    return _spiralise(rings, max_hop=spacing * 2.5)
