import shapely
import shapely.affinity
import numpy as np
import math

def lines_pattern(params, interval=0.5, angle=0):
    """
    Generates a pattern of parallel lines across a rectangle,
    optionally rotated by a specified angle.
    Every even line is inverted (start and end points are swapped).
    """
    diagonal = math.sqrt(params['width_mm']**2 + params['height_mm']**2)
    lines = []
    for idx, i in enumerate(np.arange(0, diagonal, interval)):
        line = shapely.LineString([
            (params["width_mm"] / 2 - diagonal/2, params['height_mm'] / 2 - diagonal/2 + i),
            (params["width_mm"] / 2 + diagonal/2, params['height_mm'] / 2 - diagonal/2 + i)
        ])
        if idx % 2 == 0:
            # Reverse the line if index is even
            line = shapely.LineString(list(line.coords)[::-1])
        lines.append(line)

    if angle != 0:
        lines = [
            shapely.affinity.rotate(line, angle, origin=(params["width_mm"]/2, params["height_mm"]/2))
            for line in lines
        ]
    return lines
