"""Short-dash pattern: a grid of small marks, used to fill parks."""

from __future__ import annotations

import numpy as np
import shapely

from postcards.utils.patterns._common import Bounds, sweep_area


def dots_pattern(
    params: dict,
    interval: float = 0.5,
    angle: float = 0,
    mark: float = 0.05,
    bounds: Bounds | None = None,
) -> list[shapely.LineString]:
    """Marks on a square grid of ``interval`` mm, each ``mark`` mm long."""
    x0, y0, w, h = sweep_area(params, bounds, margin=interval, angle=angle)
    lines = []
    for y in np.arange(y0, y0 + h, interval):
        for x in np.arange(x0, x0 + w, interval):
            lines.append(
                shapely.LineString([(x - mark / 2, y), (x + mark / 2, y)])
            )

    if angle != 0:
        origin = (x0 + w / 2, y0 + h / 2)
        lines = [shapely.affinity.rotate(line, angle, origin=origin) for line in lines]
    return lines
