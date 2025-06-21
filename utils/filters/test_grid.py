import geopandas as gpd
import shapely
from shapely.geometry import Polygon
import numpy as np

def filter_test_grid(gdf, params, grid_x=5, grid_y=5, element_width=10, element_height=10, padding=2):
    """
    Create a test grid of rectangles for testing fillings.
    
    Args:
        gdf: GeoDataFrame (ignored for test grid)
        params: Parameters dict (for CRS and bounds)
        grid_x: Number of columns in the grid
        grid_y: Number of rows in the grid  
        element_width: Width of each rectangle in mm
        element_height: Height of each rectangle in mm
        padding: Space between rectangles in mm
    
    Returns:
        Dict with same structure as other filter functions
    """
    polygons = []
    
    # Calculate total grid size
    total_width = grid_x * element_width + (grid_x - 1) * padding
    total_height = grid_y * element_height + (grid_y - 1) * padding
    
    # Center the grid in the available space
    start_x = (params['width_mm'] - total_width) / 2
    start_y = (params['height_mm'] - total_height) / 2
    
    for row in range(grid_y):
        for col in range(grid_x):
            # Calculate position for this rectangle
            x = start_x + col * (element_width + padding)
            y = start_y + row * (element_height + padding)
            
            # Create rectangle polygon
            rect = Polygon([
                (x, y),
                (x + element_width, y),
                (x + element_width, y + element_height),
                (x, y + element_height),
                (x, y)
            ])
            
            polygons.append(rect)
    
    # Create GeoDataFrame
    gdf = gpd.GeoDataFrame(geometry=polygons, crs="EPSG:3857")  # Web Mercator
    
    def geometry():
        # Create outlines (boundaries of rectangles)
        outlines = gdf.copy()
        
        # Create details (inner lines, could be empty for testing)
        details = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
        
        # Create filling (pattern inside rectangles)
        from utils.patterns.lines import lines_pattern
        filling = gpd.GeoDataFrame(geometry=lines_pattern(params, 0.5, 45), crs=gdf.crs)
        # Clip filling to each rectangle
        filling = filling.clip(gdf.unary_union)
        
        # Create mask (same as outlines for this test)
        mask = outlines.copy()
        
        return {
            "outlines": outlines,
            "details": details, 
            "filling": filling,
            "mask": mask
        }
    
    return {
        "geometry": geometry,
        "raw": gdf,
        "projected": gdf
    } 