import shapely
import shapely.affinity
import numpy as np
import math

def waves_pattern(params, interval=0.5, angle=0):
    """
    Generates a pattern of sine-wavy lines across a rectangle,
    optionally rotated by a specified angle.
    Amplitude is proportional to the interval.
    Every even line is inverted (start and end points are swapped).
    """
    width = params['width_mm']
    height = params['height_mm']
    diagonal = math.sqrt(width**2 + height**2)

    lines = []
    wavelength = interval / 4  # You can tweak this
    frequency_scale = math.pi / wavelength  / 8

    
    for iy, y in enumerate(np.arange(0, diagonal, interval)):
        coords = []
        for ix, x in enumerate(np.arange(0, diagonal, 0.1)):
            coords.append([x, y + np.sin(x*frequency_scale)*wavelength])
        line = shapely.LineString(coords)
        lines.append(line)

    lines = [
        shapely.affinity.translate(line, xoff = -(diagonal / 2 - width / 2), yoff = -(diagonal / 2 - height / 2))
        for line in lines
    ] 

    if angle != 0:
        lines = [
            shapely.affinity.rotate(line, angle, origin=(width/2, height/2))
            for line in lines
        ]
    return lines
