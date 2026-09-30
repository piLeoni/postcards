"""Fill algorithms: interchangeable ways to fill a closed polygon.

Mirrors ``postcards/utils/filters/`` so the two families read the same way. A
fill takes one or more closed polygons (already in page millimetres) plus a
spacing, and returns LineStrings inside the region — see docs/fills.md for the
contract, which every algorithm here satisfies.

Pick one with :func:`get_fill`; list them with :func:`fill_names`.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Callable

from shapely.geometry import LineString

from postcards.utils.fills.concentric import fill_concentric
from postcards.utils.fills.dots import fill_dots, fill_waves
from postcards.utils.fills.grid import fill_grid
from postcards.utils.fills.hilbert import fill_hilbert
from postcards.utils.fills.honeycomb import fill_honeycomb
from postcards.utils.fills.rectilinear import fill_rectilinear
from postcards.utils.fills.spiral import fill_spiral
from postcards.utils.fills.zigzag import fill_zigzag

FillFn = Callable[..., list[LineString]]

# Order here is the order the comparison report prints.
FILLS: "OrderedDict[str, FillFn]" = OrderedDict(
    [
        ("rectilinear", fill_rectilinear),
        ("concentric", fill_concentric),
        ("zigzag", fill_zigzag),
        ("spiral", fill_spiral),
        ("grid", fill_grid),
        ("honeycomb", fill_honeycomb),
        ("hilbert", fill_hilbert),
        ("dots", fill_dots),
        ("waves", fill_waves),
    ]
)

# Algorithms whose output is a genuine traversal, in draw order.
TRAVERSALS = frozenset({"zigzag", "spiral", "hilbert", "grid", "honeycomb"})

# Pattern-style fills: no spacing/2 inset contract (stipple / waves sit under
# their own outline stroke; historical water used a fixed 0.1 mm clearance).
PATTERN_FILLS = frozenset({"dots", "waves"})


def fill_names() -> list[str]:
    """Names of the registered algorithms."""
    return list(FILLS)


def get_fill(name: str) -> FillFn:
    """Look up an algorithm by name, with a clear error for a typo."""
    try:
        return FILLS[name]
    except KeyError:
        known = ", ".join(FILLS)
        raise KeyError(f"unknown fill algorithm {name!r}; known algorithms: {known}") from None


def fill(region, spacing: float, algorithm: str = "rectilinear", **options) -> list[LineString]:
    """Run ``algorithm`` over ``region``, returning LineStrings in page mm."""
    return get_fill(algorithm)(region, spacing, **options)
