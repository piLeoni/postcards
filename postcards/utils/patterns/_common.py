"""Hatch pattern helpers.

All three patterns take an optional ``bounds`` (minx, miny, maxx, maxy). When
given, they sweep only that rectangle plus a margin — which is what the callers
always want, since the result gets clipped to a target polygon anyway. Without
it they fall back to the whole card diagonal, which is only useful for tests and
full-page fills.
"""

from __future__ import annotations

import math

Bounds = tuple[float, float, float, float]


def sweep_area(
    params: dict, bounds: Bounds | None, margin: float, angle: float = 0
) -> tuple[float, float, float, float]:
    """The x/y range a pattern must cover, as ``(x0, y0, width, height)``.

    The band is returned in the pattern's *own* frame, before rotation. If the
    caller is going to rotate the result about the band centre, the band must be
    grown to the rotated bounding box of the target, otherwise the rotation
    swings the corners out of the band and leaves unwritten wedges behind. For a
    ``w × h`` target turned by θ that box is::

        W = w·|cos θ| + h·|sin θ|
        H = w·|sin θ| + h·|cos θ|

    which reduces to ``(w, h)`` when θ is 0.
    """
    if bounds is None:
        width = float(params["width_mm"])
        height = float(params["height_mm"])
        cx, cy = width / 2, height / 2
    else:
        minx, miny, maxx, maxy = (float(v) for v in bounds)
        width = (maxx - minx) + 2 * margin
        height = (maxy - miny) + 2 * margin
        cx, cy = (minx + maxx) / 2, (miny + maxy) / 2

    if angle:
        theta = math.radians(angle)
        cos, sin = abs(math.cos(theta)), abs(math.sin(theta))
        width, height = (
            width * cos + height * sin,
            width * sin + height * cos,
        )

    return (cx - width / 2, cy - height / 2, width, height)


# Kept for the existing call sites and tests that import the private name.
_sweep_area = sweep_area
