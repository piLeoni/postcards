import geopandas as gpd
from shapely.geometry import box
import os
import pandas as pd
import numpy as np

def load_ocean_tiles_by_polygon(selector_polygon, crs=None, tile_dir="tiles/ocean_10deg", tile_suffix=".gpkg", clip=True):
    """
    Loads and merges 10x10 degree ocean tiles intersecting a polygon.

    Parameters:
        selector_polygon (shapely.geometry.Polygon): Input polygon in EPSG:4326.
        crs: CRS of the map frame being built. Tiles are read in EPSG:4326 and
            reprojected to it so the ocean joins the water layer seamlessly.
        tile_dir (str): Folder with ocean tiles named like ocean_<lat>_<lon>.gpkg.
        tile_suffix (str): File extension, e.g., '.gpkg'.
        clip (bool): Whether to clip merged result to the selector polygon.

    Returns:
        GeoDataFrame: Merged ocean geometry, in ``crs``.
    """

    if not selector_polygon.is_valid:
        selector_polygon = selector_polygon.buffer(0)

    # Get bounding box
    minx, miny, maxx, maxy = selector_polygon.bounds

    # Round to nearest 10 degrees
    lons = np.arange(int(np.floor(minx / 10.0)) * 10, int(np.ceil(maxx / 10.0)) * 10, 10)
    lats = np.arange(int(np.floor(miny / 10.0)) * 10, int(np.ceil(maxy / 10.0)) * 10, 10)

    tiles = []
    for lat in lats:
        for lon in lons:
            tile_geom = box(lon, lat, lon + 10, lat + 10)
            if selector_polygon.intersects(tile_geom):
                tile_path = os.path.join(tile_dir, f"ocean_{lat}_{lon}{tile_suffix}")
                if os.path.exists(tile_path):
                    try:
                        tiles.append(gpd.read_file(tile_path))
                    except Exception as e:
                        print(f"Failed to read {tile_path}: {e}")

    if not tiles:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    merged = gpd.GeoDataFrame(pd.concat(tiles, ignore_index=True), crs="EPSG:4326")

    if clip:
        merged = merged.clip(selector_polygon)

    if crs is not None and merged.crs is not None and not merged.crs.equals(crs):
        merged = merged.to_crs(crs)

    return merged
