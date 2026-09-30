"""Fill patterns must actually cover the area they are asked to fill.

The bug these guard against: the patterns used to sweep a ``w x h`` band and
then rotate it about its own centre. Rotating a band does not grow it, so the
corners of the target swung outside the band and were left unwritten — up to
17mm of missing hatch on a long, thin footprint. Coverage is measured as the
distance from sample points to the nearest mark, which is what the pen sees;
the area of the mathematical union cannot detect this, since lines have none.
"""

from __future__ import annotations

import numpy as np
import pytest
import shapely
from shapely.ops import unary_union

from postcards.utils.patterns.dots import dots_pattern
from postcards.utils.patterns.lines import lines_pattern
from postcards.utils.patterns.waves import waves_pattern

PARAMS = {"width_mm": 152.4, "height_mm": 101.6}

# Long and thin is the case that failed worst; square is the simple one.
BOXES = [(0.0, 0.0, 20.0, 20.0), (0.0, 0.0, 50.0, 7.0), (0.0, 0.0, 30.0, 4.0)]


def _worst_gap(lines, bounds) -> float:
    """Largest distance from an interior sample point to the nearest line."""
    union = unary_union(lines)
    minx, miny, maxx, maxy = bounds
    box = shapely.box(*bounds)
    xs = np.linspace(minx + 0.25, maxx - 0.25, 40)
    ys = np.linspace(miny + 0.25, maxy - 0.25, 40)
    gaps = [
        shapely.Point(x, y).distance(union)
        for x in xs
        for y in ys
        if box.contains(shapely.Point(x, y))
    ]
    return max(gaps)


@pytest.mark.parametrize("bounds", BOXES)
@pytest.mark.parametrize("angle", [0, 45, 90])
def test_lines_pattern_covers_rotated_bounds(bounds, angle):
    """Hatch spacing holds across the whole footprint, rotated or not."""
    interval = 0.5
    lines = lines_pattern(PARAMS, interval, angle, bounds=bounds)
    # A perfect grid leaves at most half a spacing to the nearest line. Allow a
    # little slack for the discrete sampling.
    assert _worst_gap(lines, bounds) <= interval * 0.6


@pytest.mark.parametrize("bounds", BOXES)
def test_dots_pattern_covers_rotated_bounds(bounds):
    interval = 0.5
    marks = dots_pattern(PARAMS, interval, 45, bounds=bounds)
    # Marks are points on the lattice, so the worst case is half a cell diagonal.
    assert _worst_gap(marks, bounds) <= interval * 0.75


@pytest.mark.parametrize("bounds", BOXES)
def test_waves_pattern_covers_rotated_bounds(bounds):
    interval = 0.5
    waves = waves_pattern(PARAMS, interval, 45, bounds=bounds)
    # The wave oscillates about its baseline, so allow the amplitude on top.
    assert _worst_gap(waves, bounds) <= interval


@pytest.mark.parametrize("bounds", BOXES)
def test_patterns_are_not_wildly_oversized(bounds):
    """Coverage is bought by growing the band; it must stay proportionate.

    The band is grown to the rotated bounding box of the target, so once it is
    rotated back its extent is that box's diagonal — not unbounded growth.
    """
    minx, miny, maxx, maxy = bounds
    lines = lines_pattern(PARAMS, 0.5, 45, bounds=bounds)
    extent = unary_union(lines).bounds
    span_x = extent[2] - extent[0]
    span_y = extent[3] - extent[1]
    w, h = maxx - minx, maxy - miny
    grown_x = w * 2**-0.5 + h * 2**-0.5
    grown_y = w * 2**-0.5 + h * 2**-0.5
    # After rotation the band spans the diagonal of its grown self, plus slack.
    limit = (grown_x**2 + grown_y**2) ** 0.5 * 1.05
    assert span_x <= limit, f"x span {span_x:.2f} exceeds {limit:.2f}"
    assert span_y <= limit, f"y span {span_y:.2f} exceeds {limit:.2f}"
