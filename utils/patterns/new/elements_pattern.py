import shapely
import shapely.affinity
import shapely.geometry
import math
from typing import Callable, List, Tuple, Union, Optional
from enum import Enum
from poisson_disc import Bridson_sampling
import numpy as np

class ElementAlign(Enum):
    CENTER = "center"
    LEFT = "left"
    RIGHT = "right"
    TOP = "top"
    BOTTOM = "bottom"
    TOPLEFT = "topleft"
    TOPRIGHT = "topright"
    BOTTOMLEFT = "bottomleft"
    BOTTOMRIGHT = "bottomright"

class GridType(Enum):
    RECTANGULAR = "rectangular"
    TRIANGULAR = "triangular"
    POISSON = "poisson"

PolygonLike = Union[
    shapely.geometry.Polygon,
    shapely.geometry.MultiPolygon,
    List[shapely.geometry.Polygon],
]

def frange(start, stop, step):
    """Generate a range of floats from start to stop (inclusive) with step size."""
    vals = []
    v = start
    while v <= stop + 1e-9:  # small epsilon for floating point precision
        vals.append(v)
        v += step
    return vals

def generate_grid_points(
    polygon: PolygonLike,
    grid_type: GridType = GridType.RECTANGULAR,
    spacing: float = 1.0,
    origin: Tuple[float, float] = None,
    rotation: float = 0.0,
    offset: Tuple[float, float] = (0, 0),  # grid_offset
    buffer: float = 0.0,
) -> List[Tuple[float, float]]:
    """
    Generate grid points of the specified type within the bounding box of the polygon.
    Only points inside the polygon(s) are returned.
    
    Args:
        buffer: Extra space around the polygon to include (for partial visibility)
    """
    # Normalize input
    if isinstance(polygon, shapely.geometry.Polygon):
        polygons = [polygon]
    elif isinstance(polygon, shapely.geometry.MultiPolygon):
        polygons = list(polygon.geoms)
    else:
        polygons = polygon

    # Get bounding box
    minx, miny, maxx, maxy = shapely.geometry.MultiPolygon(polygons).bounds
    
    # Add buffer
    minx -= buffer
    miny -= buffer
    maxx += buffer
    maxy += buffer

    # Always use bbox center as rotation origin
    rot_origin = ((minx + maxx) / 2, (miny + maxy) / 2)

    # If origin is not specified, use rotation origin for grid
    if origin is None:
        origin = rot_origin

    # Rotate the polygon by -rotation to get the bbox for grid generation
    if rotation != 0.0:
        rotated_polys = [shapely.affinity.rotate(poly, -rotation, origin=rot_origin) for poly in polygons]
        bbox_poly = shapely.geometry.MultiPolygon(rotated_polys)
        minx, miny, maxx, maxy = bbox_poly.bounds
    
    # this adds a safety margin for offste movements
    if(offset[0]> spacing or offset[1]> spacing):
        raise ValueError(f"Offest can't be bigger than the spacing itself: {spacing}") 

    minx -= spacing
    miny -= spacing
    maxx += spacing
    maxy += spacing

    if(grid_type == GridType.POISSON):
        if(offset[0]> 0 or offset[1]> 0 or rotation > 0):
            raise ValueError(f"Poissos does not accept offset or rotations, Rotation: {rotation}, Offet: {offset}") 
    # (buffer already applied above)

    # Create grid points in the (possibly rotated) bbox
    points = []
    if grid_type == GridType.RECTANGULAR:
        x = minx
        while x <= maxx + 1e-9:
            y = miny
            while y <= maxy + 1e-9:
                points.append((x, y))
                y += spacing
            x += spacing
    elif grid_type == GridType.TRIANGULAR:
        x = minx
        while x <= maxx + 1e-9:
            y = miny
            row = 0
            while y <= maxy + 1e-9:
                x_offset = (spacing / 2) if (row % 2) else 0
                points.append((x + x_offset, y))
                y += spacing * math.sin(math.pi / 3)
                row += 1
            x += spacing
    elif grid_type == GridType.POISSON:
        minx, miny, maxx, maxy = shapely.geometry.MultiPolygon(polygons).bounds
        width = maxx - minx
        height = maxy - miny
        # Generate Poisson samples
        samples = Bridson_sampling(dims=np.array([width, height]), radius=spacing, k=30)
        # Shift samples to the correct bbox and filter to inside the polygon
        points = []
        all_poly = shapely.geometry.MultiPolygon(polygons)
        for sx, sy in samples:
            pt = (sx + minx, sy + miny)
            if all_poly.intersects(shapely.geometry.Point(pt)):
                points.append(pt)
    else:
        raise ValueError(f"Unknown grid_type: {grid_type}")

    # Rotate grid points forward by +rotation around the bbox center
    if rotation != 0.0:
        rot_rad = math.radians(rotation)
        cos_r, sin_r = math.cos(rot_rad), math.sin(rot_rad)
        def rotate_point(pt):
            x, y = pt
            x0, y0 = x - rot_origin[0], y - rot_origin[1]
            xr = x0 * cos_r - y0 * sin_r + rot_origin[0]
            yr = x0 * sin_r + y0 * cos_r + rot_origin[1]
            return (xr, yr)
        points = [rotate_point(pt) for pt in points]

    # Apply grid_offset (after rotation)
    if offset != (0, 0):
        dx, dy = offset
        points = [(x + dx, y + dy) for (x, y) in points]

    # Filter points inside polygon (unless buffer > 0)
    if buffer == 0.0:
        all_poly = shapely.geometry.MultiPolygon(polygons)
        inside_points = [pt for pt in points if all_poly.intersects(shapely.geometry.Point(pt))]
        return points
    else:
        return points

def get_alignment_offset(
    align: ElementAlign,
    element_size: Tuple[float, float],
) -> Tuple[float, float]:
    """
    Compute offset for alignment. element_size = (width, height)
    For CENTER alignment, return (0, 0) - no offset needed.
    For other alignments, return the offset needed to move from center to the desired alignment.
    """
    w, h = element_size
    if align == ElementAlign.CENTER:
        return (-w / 2, -h / 2)
    elif align == ElementAlign.LEFT:
        return (-w, -h / 2)  # Move left from center
    elif align == ElementAlign.RIGHT:
        return (0, -h / 2)   # Move right from center
    elif align == ElementAlign.TOP:
        return (-w / 2, -h)   # Move up from center
    elif align == ElementAlign.BOTTOM:
        return (-w / 2, 0)  # Move down from center
    elif align == ElementAlign.TOPLEFT:
        return (-w, -h)   # Move left and up from center
    elif align == ElementAlign.TOPRIGHT:
        return (0, -h)    # Move right and up from center
    elif align == ElementAlign.BOTTOMLEFT:
        return (-w, 0)  # Move left and down from center
    elif align == ElementAlign.BOTTOMRIGHT:
        return (0, 0)   # Move right and down from center
    else:
        return (0, 0)

def default_geometry_fn(
    point: Tuple[float, float],
    scale: float = 1.0,
    rotation: float = 0.0,
    align: ElementAlign = ElementAlign.CENTER,
    offset: Tuple[float, float] = (0, 0)
) -> shapely.geometry.LineString:
    """
    Default geometry: a short horizontal line centered (or aligned) at the point.
    """
    x, y = point
    dx = 0.5 * scale
    line = shapely.geometry.LineString([(x - dx, y), (x + dx, y)])
    
    # Calculate the actual bounding box of the line for proper alignment
    minx, miny, maxx, maxy = line.bounds
    element_width = maxx - minx
    element_height = maxy - miny
    
    # Apply alignment offset based on actual geometry size
    align_offset = get_alignment_offset(align, (element_width, element_height))
    if align_offset != (0, 0):
        line = shapely.affinity.translate(line, xoff=align_offset[0], yoff=align_offset[1])
    
    # Element rotation
    if rotation != 0.0:
        line = shapely.affinity.rotate(line, rotation, origin=(x, y))
    
    # Element offset
    if offset != (0, 0):
        line = shapely.affinity.translate(line, xoff=offset[0], yoff=offset[1])
    
    return line

def elements_pattern(
    polygon: PolygonLike,
    grid_type: GridType = GridType.RECTANGULAR,
    spacing: float = 1.0,
    origin: Tuple[float, float] = None,
    rotation: float = 0.0,
    grid_offset: Tuple[float, float] = (0, 0),
    geometry: Union[shapely.geometry.base.BaseGeometry, Callable] = default_geometry_fn,
    element_rotation: Union[float, List[float]] = 0.0,
    element_scale: Union[float, List[float]] = 1.0,
    element_align: Union[ElementAlign, List[ElementAlign]] = ElementAlign.CENTER,
    element_offset: Union[Tuple[float, float], List[Tuple[float, float]]] = (0, 0),
    element_sequence: Optional[List[Union[shapely.geometry.base.BaseGeometry, Callable]]] = None,
    buffer: float = 0.0,
    filter_points: bool = True,
    clip_elements: bool = True,
) -> List[shapely.geometry.base.BaseGeometry]:
    """
    Fill a polygon (or collection) with a grid pattern and place a geometry at each point.
    
    Grid parameters:
        grid_type: One of GridType enum values (GridType.RECTANGULAR, GridType.TRIANGULAR, GridType.HEXAGONAL).
        spacing: Distance between grid points.
        origin: (x, y) tuple for grid origin. If None, uses bbox center.
        rotation: Grid rotation in degrees.
        grid_offset: (x, y) offset for the grid as a whole.
        buffer: Extra space around polygon to include (for partial visibility).
    Element parameters:
        geometry: Either a Shapely geometry (to be cloned) or a function(context_dict) -> geometry.
        element_rotation: float or list, per-element rotation (deg).
        element_scale: float or list, per-element scale.
        element_align: ElementAlign or list, alignment (ElementAlign.CENTER, ElementAlign.LEFT, etc.).
        element_offset: tuple or list, per-element offset (dx, dy).
        element_sequence: list of geometries or functions to cycle through.
        filter_points: If True (default), only use grid points inside the polygon. If False, use all grid points.
        clip_elements: If True (default), clip each cloned geometry to the polygon. If False, do not clip.
    Returns:
        List of shapely geometries (e.g., lines) at each grid point inside the polygon.
    """
    points = generate_grid_points(
        polygon, grid_type=grid_type, spacing=spacing, origin=origin, rotation=rotation, 
        offset=grid_offset, buffer=buffer
    )
    # Optionally filter points inside polygon
    if filter_points:
        if isinstance(polygon, shapely.geometry.Polygon):
            all_poly = polygon
        elif isinstance(polygon, shapely.geometry.MultiPolygon):
            all_poly = polygon
        else:
            all_poly = shapely.geometry.MultiPolygon(polygon)
        points = [pt for pt in points if all_poly.intersects(shapely.geometry.Point(pt))]
    n = len(points)
    def get_param(param, idx, default=None):
        if isinstance(param, list):
            return param[idx % len(param)]
        return param if param is not None else default

    # Helper: wrap a geometry as a function that clones and transforms it
    def make_geometry_cloner(base_geom):
        def cloner(context):
            pt = context['point']
            scale = context.get('scale', 1.0)
            rotation = context.get('rotation', 0.0)
            align = context.get('align', ElementAlign.CENTER)
            offset = context.get('offset', (0, 0))
            # Scale the geometry first
            geom = shapely.affinity.scale(base_geom, xfact=scale, yfact=scale, origin=(0, 0))
            # Calculate the actual bounding box of the scaled geometry BEFORE any translation
            minx, miny, maxx, maxy = geom.bounds
            element_width = maxx - minx
            element_height = maxy - miny
            # Calculate alignment offset based on actual geometry size
            align_offset = get_alignment_offset(align, (element_width, element_height))
            # Move to the grid point with alignment offset
            geom = shapely.affinity.translate(geom, xoff=pt[0] + align_offset[0], yoff=pt[1] + align_offset[1])
            # Apply rotation
            if rotation != 0.0:
                geom = shapely.affinity.rotate(geom, rotation, origin=pt)
            # Apply element offset
            if offset != (0, 0):
                geom = shapely.affinity.translate(geom, xoff=offset[0], yoff=offset[1])
            return geom
        return cloner

    # Prepare the geometry function or cloner
    if isinstance(geometry, shapely.geometry.base.BaseGeometry):
        geometry_fn = make_geometry_cloner(geometry)
    else:
        geometry_fn = geometry

    # Prepare element_sequence if present
    sequence_fns = None
    if element_sequence:
        sequence_fns = []
        for g in element_sequence:
            if isinstance(g, shapely.geometry.base.BaseGeometry):
                sequence_fns.append(make_geometry_cloner(g))
            else:
                sequence_fns.append(g)

    # Prepare polygon for clipping if needed
    if isinstance(polygon, shapely.geometry.Polygon):
        clip_poly = polygon
    elif isinstance(polygon, shapely.geometry.MultiPolygon):
        clip_poly = polygon
    else:
        clip_poly = shapely.geometry.MultiPolygon(polygon)

    geoms = []
    for i, pt in enumerate(points):
        fn = geometry_fn
        if sequence_fns:
            fn = sequence_fns[i % len(sequence_fns)]
        context = {
            'point': pt,
            'index': i,
            'total': n,
            'scale': get_param(element_scale, i, 1.0),
            'rotation': get_param(element_rotation, i, 0.0),
            'align': get_param(element_align, i, ElementAlign.CENTER),
            'offset': get_param(element_offset, i, (0, 0)),
            'grid_point': pt,
        }
        geom = fn(context)
        # Optionally clip each element to the polygon
        if clip_elements:
            try:
                geom = geom.intersection(clip_poly)
                if geom.is_empty:
                    continue
            except:
                continue
        geoms.append(geom)
    return geoms

# Example usage:
# from shapely.geometry import box, LineString
# poly = box(0, 0, 10, 5)
#
# # 1. Using a geometry (cloned at each grid point):
# triangle_geom = LineString([
#     (0, 0.5),
#     (-0.5, -0.5),
#     (0.5, -0.5),
#     (0, 0.5)
# ])
# triangles = elements_pattern(
#     poly,
#     grid_type=GridType.RECTANGULAR,
#     spacing=1.5,
#     geometry=triangle_geom,
#     element_scale=1.0,
#     element_rotation=30,
#     element_align=ElementAlign.CENTER
# )
#
# # 2. Using a function (can use context):
# def alternating_fn(context):
#     pt = context['point']
#     idx = context['index']
#     if idx % 2 == 0:
#         return LineString([
#             (pt[0], pt[1] + 0.5),
#             (pt[0] - 0.5, pt[1] - 0.5),
#             (pt[0] + 0.5, pt[1] - 0.5),
#             (pt[0], pt[1] + 0.5)
#         ])
#     else:
#         return LineString([
#             (pt[0] - 0.5, pt[1] + 0.5),
#             (pt[0] + 0.5, pt[1] + 0.5),
#             (pt[0], pt[1] - 0.5),
#             (pt[0] - 0.5, pt[1] + 0.5)
#         ])
# shapes = elements_pattern(
#     poly,
#     grid_type=GridType.RECTANGULAR,
#     spacing=1.5,
#     geometry=alternating_fn,
#     element_scale=1.0,
#     element_rotation=0.0,
#     element_align=ElementAlign.CENTER
# )
