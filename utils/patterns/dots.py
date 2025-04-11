import shapely
import shapely.affinity
import numpy as np
import math

def dots_pattern(params, interval=0.5, angle=0, mark = 0.2):
    """
    Generates a pattern of parallel lines across a rectangle,
    optionally rotated by a specified angle.
    Every even line is inverted (start and end points are swapped).
    """
    diagonal = math.sqrt(params['width_mm']**2 + params['height_mm']**2)
    lines = []
    shiftX = -params['width_mm'] / 2 + diagonal/2
    shiftY = -params['height_mm'] / 2 + diagonal/2
    for idy, y in enumerate(np.arange(0, diagonal, interval)):
        for idx, x in enumerate(np.arange(0, diagonal, interval)):
            if idy % 2 == 0 :
                line = shapely.LineString([
                    (x-mark/2 - shiftX, y - shiftY),
                    (x+mark/2 - shiftX, y - shiftY)
                ])
                lines.append(line)

            if idy % 2 != 0 :
                line = shapely.LineString([
                    (diagonal - (x-mark - shiftX), y - shiftY),
                    (diagonal - (x - shiftX), y - shiftY)
                ])
                lines.append(line)
    if angle != 0:
        lines = [
            shapely.affinity.rotate(line, angle, origin=(params["width_mm"]/2, params["height_mm"]/2))
            for line in lines
        ]
    return lines
