"""Hatch pattern helpers.

All three patterns take an optional ``bounds`` (minx, miny, maxx, maxy). When
given, they sweep only that rectangle plus a margin — which is what the callers
always want, since the result gets clipped to a target polygon anyway. Without
it they fall back to the whole card diagonal, which is only useful for tests and
full-page fills.
"""

from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.affinity

Bounds = tuple[float, float, float, float]


def _sweep_area(params: dict, bounds: Bounds | None, margin: float) -> tuple[float, float, float, float]:
    """The x/y range a pattern must cover, as (x0, y0, width, height)."""
    if bounds is None:
        return (0.0, 0.0, float(params["width_mm"]), float(params["height_mm"]))
    minx, miny, maxx, maxy = (float(v) for v in bounds)
    return (minx - margin, miny - margin, (maxx - minx) + 2 * margin, (maxy - miny) + 2 * margin)
