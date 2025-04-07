import shapely
import pprint
from utils.ops import  flatten
def clipping_area(params):
    rectangle = shapely.Polygon([(params["buffer"], params["buffer"]),
                                (params["buffer"], params["height_mm"]-params["buffer"]),
                                (params["width_mm"]-params["buffer"], params["height_mm"]-params["buffer"]),
                                (params["width_mm"]-params["buffer"], params["buffer"]),
                                (params["buffer"], params["buffer"])
                                ])      
    return rectangle

def clip_by(to_clip, clipper):
    """
    Clips the given geometry using the provided clipping geometry.

    Args:
        to_clip (shapely.geometry): The geometry to be clipped.
        clipper (shapely.geometry): The geometry used for clipping.

    Returns:
        shapely.geometry: The clipped geometry.
    """
    # print(type(to_clip))
    pprint.pprint(shapely.MultiLineString(to_clip))
    # return to_clip.intersection(clipper)