"""Shapes that break fills.

A fill that works on a square and fails on an L is not a fill, so these are
deliberately awkward: concave, holed, thin, and with a spike to catch the
unwritten-wedge class of bug. They are plain shapely polygons in millimetres and
carry no CRS, which keeps them usable from tests and from ``postcards fills``
without any projection.
"""

from __future__ import annotations

from shapely.geometry import Polygon, box

# Convex control case: anything that cannot do this is not worth measuring.
SQUARE = box(0.0, 0.0, 20.0, 20.0)

# Concave: two arms meeting at a corner. Splits a naive sweep into bands.
L_SHAPE = Polygon([(0, 0), (20, 0), (20, 6), (6, 6), (6, 20), (0, 20)])

# A courtyard: the case where a traversal spanning the hole would have to cross
# empty space, so it must break the path instead.
RING = box(0.0, 0.0, 20.0, 20.0).difference(box(6.0, 6.0, 14.0, 14.0))

# Narrow relative to the spacing: the concentric rings die after two or three.
CORRIDOR = Polygon([(0, 0), (40, 0), (40, 2), (0, 2)])

# Mostly convex with a deep notch, so it is not a degenerate special case.
U_SHAPE = Polygon(
    [(0, 0), (20, 0), (20, 20), (14, 20), (14, 6), (6, 6), (6, 20), (0, 20)]
)

# Spikes in every direction: the worst case for a rotated hatch, and the shape
# the original pattern bug showed up on.
STAR = Polygon(
    [
        (20, 0), (24, 14), (38, 14), (27, 23), (31, 37),
        (20, 28), (9, 37), (13, 23), (2, 14), (16, 14),
    ]
)

# Two separate buildings in one call: the fill must not join them.
TWO_BOXES = Polygon(
    [(0, 0), (10, 0), (10, 10), (0, 10)]
).union(Polygon([(20, 0), (30, 0), (30, 10), (20, 10)]))

FIXTURES: dict[str, Polygon] = {
    "square": SQUARE,
    "L": L_SHAPE,
    "ring": RING,
    "corridor": CORRIDOR,
    "U": U_SHAPE,
    "star": STAR,
    "two_boxes": TWO_BOXES,
}
