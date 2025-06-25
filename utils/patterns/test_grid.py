from shapely.geometry import Polygon

def test_grid(params, grid_x=5, grid_y=5, element_width=None, element_height=None, element_size=None, padding=0, area_padding=0):
    """
    Create a test grid of rectangles dividing a given width and height.
    
    Modes:
    1. If element_width and element_height (or element_size) are provided, each rectangle is centered in its own grid cell (quadrant), with the given padding between cells.
    2. If element_width and element_height (or element_size) are None, they are computed to fill the grid, given the padding between rectangles.

    Args:
        params: dict with 'width_mm' and 'height_mm' (total area to divide)
        grid_x: number of columns
        grid_y: number of rows
        element_width: width of each rectangle (optional)
        element_height: height of each rectangle (optional)
        element_size: if provided, sets both width and height of each rectangle (overrides element_width/element_height)
        padding: space between rectangles (default 0)
        area_padding: overall padding for the grid area. Can be:
            - single value (applied to all sides)
            - tuple/list of 4 (top, right, bottom, left)
            - dict with keys 'top', 'right', 'bottom', 'left'
    Returns:
        dict with:
            'all_elements': list of shapely Polygons (all rectangles)
            'by_grid': dict mapping 'x{col}_y{row}' (1-based) to each rectangle
    """
    width = params['width_mm']
    height = params['height_mm']

    # Parse area_padding
    if isinstance(area_padding, (int, float)):
        pad_top = pad_right = pad_bottom = pad_left = area_padding
    elif isinstance(area_padding, (tuple, list)) and len(area_padding) == 4:
        pad_top, pad_right, pad_bottom, pad_left = area_padding
    elif isinstance(area_padding, dict):
        pad_top = area_padding.get('top', 0)
        pad_right = area_padding.get('right', 0)
        pad_bottom = area_padding.get('bottom', 0)
        pad_left = area_padding.get('left', 0)
    else:
        raise ValueError("area_padding must be a number, a 4-tuple/list, or a dict with keys 'top', 'right', 'bottom', 'left'")

    # Shrink available area by padding
    avail_width = width - pad_left - pad_right
    avail_height = height - pad_top - pad_bottom
    origin_x = pad_left
    origin_y = pad_top

    # If element_size is provided, use it for both width and height
    if element_size is not None:
        element_width = element_size
        element_height = element_size

    if element_width is None or element_height is None:
        # Compute rectangle size to fill the grid with given padding
        element_width = (avail_width - (grid_x - 1) * padding) / grid_x
        element_height = (avail_height - (grid_y - 1) * padding) / grid_y
        start_x = origin_x
        start_y = origin_y
        cell_width = element_width
        cell_height = element_height
    else:
        # Compute cell size (area each rectangle should be centered in)
        cell_width = (avail_width - (grid_x - 1) * padding) / grid_x
        cell_height = (avail_height - (grid_y - 1) * padding) / grid_y
        start_x = origin_x
        start_y = origin_y

    polygons = []
    by_grid = {}
    for row in range(grid_y):
        for col in range(grid_x):
            # Top-left corner of the grid cell
            cell_x = start_x + col * (cell_width + padding)
            cell_y = start_y + row * (cell_height + padding)
            # Center rectangle in its cell
            center_x = cell_x + cell_width / 2
            center_y = cell_y + cell_height / 2
            rect_x = center_x - element_width / 2
            rect_y = center_y - element_height / 2
            rect = Polygon([
                (rect_x, rect_y),
                (rect_x + element_width, rect_y),
                (rect_x + element_width, rect_y + element_height),
                (rect_x, rect_y + element_height),
                (rect_x, rect_y)
            ])
            polygons.append(rect)
            key = f"x{col+1}_y{row+1}"
            by_grid[key] = rect

    return {
        "all_elements": polygons,
        "by_grid": by_grid,
    } 