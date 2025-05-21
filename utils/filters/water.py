import pandas as pd
import geopandas as gpd
from utils.gdf_ops import gdf_polygons_to_lines, gdf_to_all_linestrings
from utils.patterns.waves import waves_pattern
from utils.gdf_projector import gdf_projector_webmercator
from utils.gdf_ocean import load_ocean_tiles_by_polygon
def filter_water(gdf, params):
    
        
    for col in ['water', 'natural']:
        if col not in gdf.columns:
            gdf[col] = None

    coastline = gdf[gdf['natural'] == 'coastline']

    water = gdf[(gdf['water'].notna()) | (gdf['natural'] == 'water')]

    if not coastline.empty:
        print("coastaline found")
        ocean = load_ocean_tiles_by_polygon(params["polygon"])
        ocean = gdf_projector_webmercator(ocean, params)
        water = pd.concat([water, ocean], ignore_index=True)
    mask = water.copy().dissolve(by=None, aggfunc='first')
    filling = gpd.GeoDataFrame(geometry=waves_pattern(params, 0.75, 0), crs=gdf.crs).dissolve(by=None, aggfunc='first').clip(mask.copy().buffer(-0.1))
    # outlines = gpd.GeoDataFrame(geometry=[shapely.union_all(list(mask.geometry) + list(coastline.geometry))], crs=gdf.crs)

    return {
        "geometry": lambda: {
            "outlines": gdf_polygons_to_lines(mask),
            "filling": filling,
            "mask": mask
        }
    }

