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

Default connector is ``band``: a straight hop when it stays inside the inset
region; when a notch or irregular outline would push that hop outside, fall
back to walking the inset perimeter between the two ends. ``boundary`` prefers
the perimeter path; ``none`` only orders, no join.

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
# x-extent (in spacings). Below that we still allow a join when the shorter
# fragment is mostly covered — otherwise diamond tips at 45° (tiny chords near
# a corner) become singleton bands and the serpentine never even tries.
MIN_OVERLAP_SPACINGS = 0.5


def _x_linked(
    lo_a: float, hi_a: float, lo_b: float, hi_b: float, spacing: float
) -> bool:
    """Whether two scan-line x-spans belong in the same vertical band.

    - Positive overlap: same column (soft threshold so diamond tip chords join).
    - Small gap (≤ one spacing): diagonal / thin footprint staircase where
      consecutive chords step sideways without overlapping — still one band.
    - Larger gap: courtyard or separate walls; keep bands apart.
    """
    overlap = min(hi_a, hi_b) - max(lo_a, lo_b)
    if overlap > 0:
        shorter = min(hi_a - lo_a, hi_b - lo_b)
        need = min(MIN_OVERLAP_SPACINGS * spacing, max(0.5 * shorter, 1e-9))
        return overlap >= need
    gap = -overlap
    return gap <= spacing

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

    scans = sorted(by_scan)
    for prev, curr in zip(scans, scans[1:]):
        if curr - prev > spacing * 1.5:
            continue
        for a in by_scan[prev]:
            lo_a, hi_a = spans[a]
            for b in by_scan[curr]:
                lo_b, hi_b = spans[b]
                if _x_linked(lo_a, hi_a, lo_b, hi_b, spacing):
                    union(a, b)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    # Within a union-find group, grow one column per vertical stack. The old
    # walk sorted every fragment by (y, x) and compared each to the previous
    # in that list — so a left+right pair on the same scan line broke the run
    # (no x-overlap across the courtyard), and the next left then compared
    # against the right and started yet another run. Result: a ring became
    # hundreds of singleton "bands" and the hatch looked like plain
    # rectilinear. Only extend a column from its tip on the previous scan.
    runs: list[list[int]] = []
    for members in groups.values():
        ordered = sorted(members, key=lambda i: (_y(fragments[i]), spans[i][0]))
        columns: list[list[int]] = []
        for i in ordered:
            placed = False
            yi = _y(fragments[i])
            lo_i, hi_i = spans[i]
            for col in columns:
                last = col[-1]
                y_last = _y(fragments[last])
                if yi <= y_last + 1e-9:
                    continue  # same scan (or above) — open a new column
                if yi - y_last > spacing * 1.5:
                    continue
                lo_a, hi_a = spans[last]
                if _x_linked(lo_a, hi_a, lo_i, hi_i, spacing):
                    col.append(i)
                    placed = True
                    break
            if not placed:
                columns.append([i])
        runs.extend(columns)

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


def _shorter_arc(ring, da: float, db: float):
    """Shorter walk along a closed ring between distances ``da`` and ``db``."""
    from shapely.ops import substring

    if ring is None or ring.length <= 0:
        return None
    forward = substring(ring, da, db, normalized=False)
    backward = substring(ring, db, da, normalized=False)
    arcs = [c for c in (forward, backward) if c is not None and not c.is_empty and c.length > 0]
    if not arcs:
        return None
    return min(arcs, key=lambda c: c.length)


def _boundary_rings(region, pull: float):
    """Rings to route connectors on, pulled inward from the fill boundary.

    ``region`` is already the inset hatch area. Pulling a hair further keeps the
    connector clearly inside (and off the building outline) without the fragile
    centroid nudge the old path used.
    """
    route = region
    if pull > 0:
        shrunk = region.buffer(-pull, join_style="mitre", mitre_limit=5.0)
        if not shrunk.is_empty and shrunk.area > 0:
            route = shrunk
    if route.geom_type == "Polygon":
        polys = [route]
    elif route.geom_type == "MultiPolygon":
        polys = list(route.geoms)
    else:
        return []
    rings = []
    for poly in polys:
        if poly.exterior is not None and poly.exterior.length > 0:
            rings.append(poly.exterior)
        rings.extend(r for r in poly.interiors if r is not None and r.length > 0)
    return rings


def _boundary_connector(
    region, a: POINT, b: POINT, limit: float, snap: float = 2.0
) -> list[POINT] | None:
    """Shorter inward-offset boundary arc between two points, or None.

    Tries every ring of a slightly shrunk copy of ``region`` (exterior and
    holes) so connectors along a courtyard wall use the hole ring instead of
    walking the long way around the outer perimeter. Refuses arcs longer than
    ``limit`` or whose projections land far from the endpoints (wrong ring).
    """
    pull = min(0.08, max(limit * 0.01, 0.02))
    best: tuple[float, object, object, object] | None = None  # len, arc, pa, pb

    for ring in _boundary_rings(region, pull):
        da = float(ring.project(Point(a)))
        db = float(ring.project(Point(b)))
        pa = ring.interpolate(da)
        pb = ring.interpolate(db)
        if Point(a).distance(pa) > snap or Point(b).distance(pb) > snap:
            continue
        arc = _shorter_arc(ring, da, db)
        if arc is None or arc.length > limit or arc.length < MIN_SEGMENT_MM:
            continue
        if best is None or arc.length < best[0]:
            best = (arc.length, arc, pa, pb)

    if best is None:
        return None

    _, arc, pa, pb = best
    # a → (onto ring) → along arc → (off ring) → b. Skip micro-segments.
    coords: list[POINT] = [a]
    arc_coords = [(float(x), float(y)) for x, y in arc.coords]
    if Point(a).distance(pa) > MIN_SEGMENT_MM:
        coords.append((float(pa.x), float(pa.y)))
    # Arc already runs pa → pb; drop its endpoints to avoid duplicates.
    if len(arc_coords) > 2:
        coords.extend(arc_coords[1:-1])
    if Point(b).distance(pb) > MIN_SEGMENT_MM:
        coords.append((float(pb.x), float(pb.y)))
    coords.append(b)

    # Deduplicate consecutive points.
    cleaned: list[POINT] = [coords[0]]
    for p in coords[1:]:
        if math.hypot(p[0] - cleaned[-1][0], p[1] - cleaned[-1][1]) > MIN_SEGMENT_MM:
            cleaned.append(p)
    if len(cleaned) < 2:
        return None

    route = LineString(cleaned)
    if not region.buffer(1e-6).covers(route):
        return None
    # Return intermediate vertices only — caller stitches a … mid … b.
    return cleaned[1:-1]


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
    # Boundary arcs may be longer than a straight hop; give them more leash.
    boundary_limit = limit * 2.0

    for step, i in enumerate(ordered):
        start, end = _facing(fragments[i], step % 2 == 1)

        if not coords:
            coords = [start, end]
            previous = fragments[i]
            continue

        prev_end = coords[-1]
        mid: list[POINT] | None = None

        prefer_boundary = connector in ("boundary", "outline")
        # ``band`` (default): straight hop first; fall back to the inset
        # perimeter when the hop would leave the region — the irregular-outline
        # case where "straight or nothing" used to shatter the serpentine.
        if prefer_boundary:
            mid = _boundary_connector(region, prev_end, start, boundary_limit)
            if mid is not None and previous is not None:
                hop = LineString([prev_end, *mid, start])
                if previous.crosses(hop):
                    mid = None
            if mid is None and _connector_ok(prev_end, start, region, previous, limit):
                mid = []
        else:
            if _connector_ok(prev_end, start, region, previous, limit):
                mid = []
            else:
                mid = _boundary_connector(region, prev_end, start, boundary_limit)
                if mid is not None and previous is not None:
                    hop = LineString([prev_end, *mid, start])
                    if previous.crosses(hop):
                        mid = None

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
      ``band``      — straight hop when it stays inside; otherwise follow the
                      inset perimeter (default)
      ``boundary``  — prefer the perimeter path; straight hop as fallback
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
