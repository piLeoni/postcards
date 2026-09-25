"""Serpentine fill: parallel hatch lines joined into continuous paths.

This is the direct answer to the fragmentation problem in docs/fills.md. Rather
than generating a pattern outside the region and clipping it, the lines are
generated inside the region and then joined: consecutive lines are traversed in
opposite directions and connected at their ends.

The joining follows CuraEngine's ``connectInfills`` (AGPL), logic only — not the
code:

1. generate parallel lines and clip them to the region
2. group fragments into bands (contiguous columns of overlapping scan lines)
3. within a band, alternate direction so each line starts where the previous ended
4. join with a short connector

Default connector is ``band``: a straight hop between facing ends. That hop is
about one spacing long and stays inside the inset region whenever the two
fragments overlap in x — which is exactly the banding criterion. ``boundary``
routes along the outline instead (Cura's look); ``none`` only orders, no join.

Containment is enforced by refusing any connector that leaves the region, and
opening a new path instead. That keeps the pen honest without a post-clip that
would shatter the serpentine.
"""

from __future__ import annotations

import math

import shapely
import shapely.affinity
from shapely.geometry import LineString, Point

from postcards.utils.fills._common import (
    MIN_SEGMENT_MM,
    as_region,
    default_inset,
    inset,
    ring_polygons,
    segment,
    sweep_lines,
)

POINT = tuple[float, float]

# Fragments on adjacent scan lines belong in one band when they share this much
# x-extent (in spacings). Below that, the hop would leave the band.
MIN_OVERLAP_SPACINGS = 0.5

# Refuse connectors longer than this many spacings — better to lift.
MAX_CONNECTOR_SPACINGS = 8.0


def _y(line: LineString) -> float:
    ys = [p[1] for p in line.coords]
    return sum(ys) / len(ys)


def _x_span(line: LineString) -> tuple[float, float]:
    xs = [p[0] for p in line.coords]
    return min(xs), max(xs)


def _bands(fragments: list[LineString], spacing: float) -> list[list[int]]:
    """Group fragment indices into contiguous columns.

    Two fragments join the same band when they sit on adjacent scan lines and
    their x-extents overlap. A courtyard breaks the overlap, so the left and
    right walls of a ring become separate bands — which is what we want: the
    pen must not draw across the hole.
    """
    n = len(fragments)
    if n == 0:
        return []

    spans = [_x_span(f) for f in fragments]
    order = sorted(range(n), key=lambda i: (_y(fragments[i]), spans[i][0]))

    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    by_scan: dict[float, list[int]] = {}
    for i in order:
        by_scan.setdefault(round(_y(fragments[i]), 6), []).append(i)

    need = MIN_OVERLAP_SPACINGS * spacing
    scans = sorted(by_scan)
    for prev, curr in zip(scans, scans[1:]):
        if curr - prev > spacing * 1.5:
            continue
        for a in by_scan[prev]:
            lo_a, hi_a = spans[a]
            for b in by_scan[curr]:
                lo_b, hi_b = spans[b]
                if min(hi_a, hi_b) - max(lo_a, lo_b) >= need:
                    union(a, b)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    # Within a union-find group, split into monotonic runs: walk top-to-bottom
    # and start a new run when x-overlap with the previous fragment fails. That
    # separates the two walls of a ring even when both walls share a top/bottom
    # bar in the same union component.
    runs: list[list[int]] = []
    for members in groups.values():
        ordered = sorted(members, key=lambda i: (_y(fragments[i]), spans[i][0]))
        current: list[int] = []
        for i in ordered:
            if not current:
                current = [i]
                continue
            lo_a, hi_a = spans[current[-1]]
            lo_b, hi_b = spans[i]
            if min(hi_a, hi_b) - max(lo_a, lo_b) >= need:
                current.append(i)
            else:
                runs.append(current)
                current = [i]
        if current:
            runs.append(current)

    return sorted(runs, key=lambda run: (_y(fragments[run[0]]), spans[run[0]][0]))


def _facing(line: LineString, reverse: bool) -> tuple[POINT, POINT]:
    """Start and end of a fragment, optionally flipped for serpentine order."""
    coords = list(line.coords)
    if reverse:
        coords.reverse()
    return coords[0], coords[-1]


def _connector_ok(
    a: POINT, b: POINT, region, previous: LineString | None, limit: float
) -> bool:
    """Whether a straight hop from ``a`` to ``b`` is legal ink."""
    hop = LineString([a, b])
    if hop.length < MIN_SEGMENT_MM:
        return True
    if hop.length > limit:
        return False
    # Must stay inside the fill region (tiny slack for floating point).
    if not region.buffer(1e-6).covers(hop):
        return False
    # Must not scar the line just drawn.
    if previous is not None and previous.crosses(hop):
        return False
    return True


def _boundary_connector(
    region, a: POINT, b: POINT, limit: float
) -> list[POINT] | None:
    """Shorter exterior-arc between two points, or None if too long / unavailable.

    The arc is projected onto the region's exterior, then pulled a hair inward
    toward the region's centroid so the stroke does not sit on the outline.
    """
    exterior = region.exterior
    if exterior is None or exterior.length <= 0:
        return None

    from shapely.ops import substring

    da = exterior.project(Point(a))
    db = exterior.project(Point(b))
    forward = substring(exterior, da, db)
    backward = substring(exterior, db, da)
    arcs = [c for c in (forward, backward) if not c.is_empty and c.length > 0]
    if not arcs:
        return None
    arc = min(arcs, key=lambda c: c.length)
    if arc.length > limit:
        return None

    # Pull interior vertices toward the centroid so the connector is inset.
    cx, cy = region.centroid.x, region.centroid.y
    pull = 0.05
    mid = []
    for x, y in list(arc.coords)[1:-1]:
        dx, dy = cx - x, cy - y
        d = math.hypot(dx, dy)
        if d > pull:
            t = pull / d
            mid.append((x + dx * t, y + dy * t))
        else:
            mid.append((x, y))
    # Verify the resulting polyline stays inside.
    route = LineString([a, *mid, b])
    if not region.buffer(1e-6).covers(route):
        return None
    return mid


def _walk(
    ordered: list[int],
    fragments: list[LineString],
    region,
    connector: str,
    limit: float,
) -> list[LineString]:
    """Serpentine one band; break the path when no legal connector exists."""
    if connector == "none":
        out = []
        for step, i in enumerate(ordered):
            start, end = _facing(fragments[i], step % 2 == 1)
            out.append(LineString([start, end]))
        return out

    paths: list[LineString] = []
    coords: list[POINT] = []
    previous: LineString | None = None

    for step, i in enumerate(ordered):
        start, end = _facing(fragments[i], step % 2 == 1)

        if not coords:
            coords = [start, end]
            previous = fragments[i]
            continue

        prev_end = coords[-1]
        mid: list[POINT] | None = None

        if connector == "boundary":
            mid = _boundary_connector(region, prev_end, start, limit)
            if mid is not None and previous is not None:
                hop = LineString([prev_end, *mid, start])
                if previous.crosses(hop):
                    mid = None

        if mid is None and _connector_ok(prev_end, start, region, previous, limit):
            mid = []  # empty list = straight hop, no intermediate points

        if mid is None:
            path = segment(coords)
            if path is not None:
                paths.append(path)
            coords = [start, end]
        else:
            coords.extend(mid)
            coords.extend([start, end])

        previous = fragments[i]

    path = segment(coords)
    if path is not None:
        paths.append(path)
    return paths


def fill_zigzag(
    region,
    spacing: float,
    angle: float = 45.0,
    connector: str = "band",
    max_connector_mm: float | None = None,
    inset_mm: float | None = None,
    **options,
) -> list[LineString]:
    """Serpentine hatch over ``region``, paths in draw order.

    ``connector``:
      ``band``      — straight hop between facing ends (default; short, clean)
      ``boundary``  — follow the outline (Cura-style; longer, fewer lifts)
      ``none``      — order only, no joins
    """
    geo = as_region(region)
    if geo.is_empty or spacing <= 0:
        return []

    amount = default_inset(spacing) if inset_mm is None else inset_mm
    target = inset(geo, amount)
    if target.is_empty:
        return []

    limit = (
        max_connector_mm
        if max_connector_mm is not None
        else MAX_CONNECTOR_SPACINGS * spacing
    )

    # Join in a frame where the sweep is horizontal, then rotate back.
    rotated = shapely.affinity.rotate(target, -angle, origin=(0, 0))
    paths: list[LineString] = []

    for polygon in ring_polygons(rotated):
        fragments = sweep_lines(polygon, spacing, 0.0)
        if not fragments:
            continue
        for band in _bands(fragments, spacing):
            ordered = sorted(
                band, key=lambda i: (_y(fragments[i]), _x_span(fragments[i])[0])
            )
            paths.extend(_walk(ordered, fragments, polygon, connector, limit))

    if angle:
        paths = [
            shapely.affinity.rotate(path, angle, origin=(0, 0)) for path in paths
        ]
    return paths
