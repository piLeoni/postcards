"""Parallel hatch lines, used to fill building footprints."""

from __future__ import annotations

import numpy as np
import shapely
import shapely.affinity

from utils.patterns._common import Bounds, _sweep_area


def lines_pattern(
    params: dict,
    interval: float = 0.5,
    angle: float = 0,
    bounds: Bounds | None = None,
) -> list[shapely.LineString]:
    """Hatch lines ``interval`` mm apart, alternating direction as they go."""
    x0, y0, w, h = _sweep_area(params, bounds, margin=interval)
    lines = []
    for idx, i in enumerate(np.arange(0, h, interval)):
        line = shapely.LineString([(x0, y0 + i), (x0 + w, y0 + i)])
        if idx % 2 == 0:
            line = shapely.LineString(list(line.coords)[::-1])
        lines.append(line)

    if angle != 0:
        origin = (x0 + w / 2, y0 + h / 2)
        lines = [shapely.affinity.rotate(line, angle, origin=origin) for line in lines]
    return lines
