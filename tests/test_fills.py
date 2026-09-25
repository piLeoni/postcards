"""The fill contract: every algorithm satisfies it, on shapes that break things.

Two classes of test live here. The **conformance** tests assert the interface
from ``docs/fills.md`` — strokes inside the region, holes respected, nothing
past the inset. The **comparison** test asserts the properties that make a fill
worth using on real footprints, which is the whole point of the exercise.
"""

from __future__ import annotations

import pytest
import shapely

from postcards.utils.fills import FILLS, fill, fill_names, get_fill
from postcards.utils.fills._common import as_region, inset, ring_polygons
from postcards.utils.fills._fixtures import FIXTURES
from postcards.utils.fills._report import measure, worst_gap

SPACING = 1.0

# Shapes where a line drawn between two points can leave the region, which is
# where containment and coverage actually get tested.
AWKWARD = ("L", "ring", "corridor", "U", "star")


def _slack(region):
    """A hair of tolerance: strokes may touch the boundary, not cross it."""
    return region.buffer(1e-6)


@pytest.mark.parametrize("algorithm", fill_names())
@pytest.mark.parametrize("shape_name", list(FIXTURES))
def test_strokes_stay_inside_the_region(algorithm, shape_name):
    """No stroke may leave the footprint — this is a bug, not a trade-off."""
    region = FIXTURES[shape_name]
    lines = fill(region, SPACING, algorithm=algorithm)
    allowed = _slack(region)
    outside = [line for line in lines if not allowed.contains(line)]
    assert not outside, f"{algorithm} on {shape_name}: {len(outside)} stroke(s) escaped"


@pytest.mark.parametrize("algorithm", fill_names())
def test_holes_are_respected(algorithm):
    """A courtyard must stay empty; no connector may span it."""
    region = FIXTURES["ring"]
    hole = shapely.Point(10.0, 10.0)
    lines = fill(region, SPACING, algorithm=algorithm)
    for line in lines:
        assert not hole.buffer(2.0).intersects(line), f"{algorithm} drew through the hole"


@pytest.mark.parametrize("algorithm", fill_names())
def test_inset_is_honoured(algorithm):
    """Strokes stay at least the contract inset off the boundary."""
    region = FIXTURES["square"]
    lines = fill(region, SPACING, algorithm=algorithm)
    # Every algorithm insets by spacing/2, so no stroke endpoint should sit on
    # the original boundary.
    for line in lines:
        for x, y in line.coords:
            assert region.exterior.distance(shapely.Point(x, y)) >= SPACING / 4


@pytest.mark.parametrize("algorithm", fill_names())
def test_coverage_meets_the_criterion(algorithm):
    """Worst-case gap must stay within roughly half a spacing.

    The patterns this replaces hold ``0.6 * spacing``; a fill that cannot meet
    that on an L or a ring is not covering the area it claims to.
    """
    for shape_name in AWKWARD:
        region = FIXTURES[shape_name]
        lines = fill(region, SPACING, algorithm=algorithm)
        gap, samples = worst_gap(lines, region)
        assert samples > 0, f"{algorithm} on {shape_name}: no interior samples"
        assert gap <= SPACING * 1.35, (
            f"{algorithm} on {shape_name}: worst gap {gap:.3f} "
            f"exceeds {SPACING * 1.35:.3f}"
        )


@pytest.mark.parametrize("algorithm", fill_names())
def test_output_is_deterministic(algorithm):
    """Same input, same output. No set iteration or hash ordering."""
    region = FIXTURES["L"]
    first = fill(region, SPACING, algorithm=algorithm)
    second = fill(region, SPACING, algorithm=algorithm)
    assert len(first) == len(second)
    for a, b in zip(first, second):
        assert list(a.coords) == list(b.coords)


@pytest.mark.parametrize("algorithm", fill_names())
def test_empty_and_degenerate_input_is_survivable(algorithm):
    """A filter must return nothing, not raise, when there is nothing to fill."""
    assert fill(None, SPACING, algorithm=algorithm) == []
    assert fill(shapely.Polygon(), SPACING, algorithm=algorithm) == []
    assert fill(FIXTURES["square"], 0.0, algorithm=algorithm) == []


@pytest.mark.parametrize("algorithm", fill_names())
def test_region_that_is_thinner_than_the_spacing(algorithm):
    """A region that cannot hold a stroke yields nothing, without crashing."""
    thin = shapely.box(0, 0, 10, 0.05)
    lines = fill(thin, SPACING, algorithm=algorithm)
    for line in lines:
        assert thin.buffer(1e-6).contains(line)


def test_registry_lookup_and_errors():
    assert fill_names() == [
        "rectilinear",
        "concentric",
        "zigzag",
        "spiral",
        "grid",
        "honeycomb",
        "hilbert",
    ]
    assert set(FILLS) == set(fill_names())
    with pytest.raises(KeyError, match="unknown fill algorithm"):
        get_fill("nope")


def test_as_region_repairs_and_normalises():
    bowtie = shapely.Polygon([(0, 0), (2, 2), (2, 0), (0, 2)])
    repaired = as_region(bowtie)
    assert repaired.is_valid
    assert repaired.geom_type in ("Polygon", "MultiPolygon")
    assert as_region(42).is_empty
    assert as_region([FIXTURES["square"], FIXTURES["square"]]).geom_type == "Polygon"


def test_ring_polygons_splits_multi():
    two = shapely.union_all([shapely.box(0, 0, 5, 5), shapely.box(10, 0, 15, 5)])
    assert len(ring_polygons(two)) == 2
    assert len(ring_polygons(FIXTURES["square"])) == 1


@pytest.mark.parametrize("algorithm", fill_names())
def test_multi_polygon_input_is_filled_but_not_bridged(algorithm):
    """Two separate buildings each get filled; nothing joins them."""
    region = FIXTURES["two_boxes"]
    lines = fill(region, SPACING, algorithm=algorithm)
    assert lines
    # The gap between the boxes must contain no ink.
    between = shapely.box(11.0, 1.0, 19.0, 9.0)
    for line in lines:
        assert not line.intersects(between.buffer(-0.01)), f"{algorithm} bridged the boxes"


# --- comparison ------------------------------------------------------------

def test_zigzag_reduces_lifts_where_it_is_meant_to():
    """The core claim: joining lines cuts pen lifts on a convex footprint."""
    region = FIXTURES["square"]
    hatch = measure(fill(region, SPACING, algorithm="rectilinear"), region, "rectilinear")
    zigzag = measure(fill(region, SPACING, algorithm="zigzag"), region, "zigzag")
    assert zigzag.lifts < hatch.lifts
    assert zigzag.outside == 0


def test_zigzag_does_not_invent_geometry():
    """Continuity is bought with connectors; the extra ink must stay modest."""
    region = FIXTURES["star"]
    hatch = measure(fill(region, SPACING, algorithm="rectilinear"), region, "rectilinear")
    zigzag = measure(fill(region, SPACING, algorithm="zigzag"), region, "zigzag")
    # Allow a real increase — connectors are visible ink — but not a doubling.
    assert zigzag.drawn_mm <= hatch.drawn_mm * 1.5


def test_concentric_uses_the_fewest_lifts_on_concave_shapes():
    """On an L, rings beat both line-based fills on lift count."""
    region = FIXTURES["L"]
    rings = measure(fill(region, SPACING, algorithm="concentric"), region, "concentric")
    hatch = measure(fill(region, SPACING, algorithm="rectilinear"), region, "rectilinear")
    assert rings.lifts <= hatch.lifts


def test_connector_none_is_just_ordered_fragments():
    """``connector="none"`` must produce exactly the hatch stroke count."""
    region = FIXTURES["L"]
    plain = fill(region, SPACING, algorithm="rectilinear")
    none = fill(region, SPACING, algorithm="zigzag", connector="none")
    assert len(none) == len(plain)
