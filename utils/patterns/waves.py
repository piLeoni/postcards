"""Sine-wave hatch, used to fill water."""

from __future__ import annotations

import math

import numpy as np
import shapely
import shapely.affinity

from utils.patterns._common import Bounds, _sweep_area

# Sampling step along X, in mm. Fine enough to read as a smooth wave.
_STEP = 0.1


def waves_pattern(
    params: dict,
    interval: float = 0.5,
    angle: float = 0,
    bounds: Bounds | None = None,
) -> list[shapely.LineString]:
    """Wavy lines ``interval`` mm apart; amplitude scales with the interval."""
    x0, y0, w, h = _sweep_area(params, bounds, margin=interval)

    wavelength = interval / 4
    frequency_scale = math.pi / wavelength / 8

    lines = []
    for y in np.arange(y0, y0 + h, interval):
        coords = [
            (x, y + math.sin(x * frequency_scale) * wavelength)
            for x in np.arange(x0, x0 + w, _STEP)
        ]
        lines.append(shapely.LineString(coords))

    if angle != 0:
        origin = (x0 + w / 2, y0 + h / 2)
        lines = [shapely.affinity.rotate(line, angle, origin=origin) for line in lines]
    return lines
