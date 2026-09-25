"""Measure a fill: pen lifts, drawn length, coverage, containment.

This is the artefact docs/fills.md calls for. An algorithm earns its place by
these four numbers on real footprints, not by how interesting it was to write.

The metrics are deliberately the ones a pen can tell apart:

``lifts``
    number of separate polylines. Every one is a pen-down, a travel move and a
    pen-up.
``drawn_mm``
    total ink. A fill that halves the lifts by adding connector strokes is not
    obviously a win, so this is always reported next to ``lifts``.
``coverage_mm``
    worst-case distance from an interior sample point to the nearest stroke.
    Catches the unwritten-wedge bug that the pattern tests guard against.
``outside``
    strokes not contained in the region. Any value above zero is a bug, not a
    trade-off.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union

# Slack for containment: strokes are allowed to touch the boundary exactly, and
# floating point makes "exactly" a moving target.
CONTAINMENT_SLACK_MM = 1e-6

# Sample the region on a grid of roughly this many points per side, so shapes of
# very different sizes stay comparable.
SAMPLES_PER_SIDE = 40


@dataclass(frozen=True)
class FillMetrics:
    """What one fill costs and what it covers."""

    algorithm: str
    lifts: int
    drawn_mm: float
    coverage_mm: float
    outside: int
    sample_count: int

    def as_row(self) -> dict[str, str]:
        return {
            "algorithm": self.algorithm,
            "lifts": str(self.lifts),
            "drawn_mm": f"{self.drawn_mm:.1f}",
            "coverage_mm": f"{self.coverage_mm:.3f}",
            "outside": str(self.outside),
        }


def worst_gap(lines: list[LineString], region) -> tuple[float, int]:
    """Largest distance from an interior sample point to the nearest stroke.

    Points are sampled on a grid over the region's bounding box and kept only
    when strictly inside the region, so holes and concavities are respected —
    otherwise a courtyard would look like a coverage hole.
    """
    if region.is_empty or not lines:
        return float("inf"), 0

    union = unary_union(lines)
    minx, miny, maxx, maxy = region.bounds
    if maxx <= minx or maxy <= miny:
        return float("inf"), 0

    xs = np.linspace(minx, maxx, SAMPLES_PER_SIDE)
    ys = np.linspace(miny, maxy, SAMPLES_PER_SIDE)
    worst = 0.0
    count = 0

    # The region's own boundary, so sample points sitting exactly on it can be
    # skipped: they are legitimately far from an inset stroke and would
    # otherwise dominate the metric. Works for MultiPolygons too.
    boundary = region.boundary

    for x in xs:
        for y in ys:
            point = shapely.Point(x, y)
            if not region.contains(point):
                continue
            if boundary.distance(point) < 1e-9:
                continue
            count += 1
            worst = max(worst, point.distance(union))

    return worst, count


def count_outside(lines: list[LineString], region) -> int:
    """How many strokes are not contained in ``region`` (minus slack)."""
    buffer = region.buffer(CONTAINMENT_SLACK_MM)
    return sum(1 for line in lines if not buffer.contains(line))


def measure(lines: list[LineString], region, algorithm: str = "") -> FillMetrics:
    """Bundle the four metrics for one algorithm's output."""
    gap, samples = worst_gap(lines, region)
    return FillMetrics(
        algorithm=algorithm,
        lifts=len(lines),
        drawn_mm=sum(line.length for line in lines),
        coverage_mm=gap,
        outside=count_outside(lines, region),
        sample_count=samples,
    )


def format_report(rows: list[FillMetrics]) -> str:
    """A fixed-width table, since this gets read in a terminal a lot."""
    if not rows:
        return "(no results)"
    headers = ("algorithm", "lifts", "drawn_mm", "coverage_mm", "outside")
    width = max(len(r.algorithm) for r in rows + [rows[0]]) if rows else 0
    widths = [max(width, len(headers[0])), 7, 10, 12, 8]

    def line(values: tuple[str, ...]) -> str:
        return "  ".join(v.rjust(w) for v, w in zip(values, widths))

    out = [line(headers), line(tuple("-" * w for w in widths))]
    for row in rows:
        cells = row.as_row()
        out.append(
            line(
                (
                    cells["algorithm"],
                    cells["lifts"],
                    cells["drawn_mm"],
                    cells["coverage_mm"],
                    cells["outside"],
                )
            )
        )
    return "\n".join(out)
