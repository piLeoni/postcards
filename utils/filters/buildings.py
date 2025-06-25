import shapely
import geopandas as gpd
from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground, gdf_to_all_linestrings, fully_flatten_gdf
from utils.patterns.lines import lines_pattern

def filter_buildings(gdf, params):
    
    if 'building' not in gdf.columns:
        print("No 'water' column found in gdf")
        empty = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
        return {
            "geometry": lambda: {"outlines": empty,
                                 "details": empty,
                                 "filling": empty,
                                 "mask": empty},
            "raw": gdf,
            "projected": gdf
        }
    gdf = gdf[gdf['building'].notna()] 
    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)

    
    def geometry():
        
        outlines = gdf.copy().dissolve(by=None, aggfunc='first')
        outlines_mask =outlines.copy()
        outlines_mask = outlines_mask.buffer(-0.1)
        details = shapely.union_all(gdf_to_all_linestrings(gdf).geometry)
        details = gpd.GeoDataFrame([details], columns=['geometry'], crs=gdf.crs).clip(outlines_mask)        
        filling = gpd.GeoDataFrame(geometry=lines_pattern(params, 0.5, 45), crs=gdf.crs).clip(outlines_mask)
        return {"outlines": gdf_polygons_to_lines(outlines), "details": details, "filling": filling, "mask": outlines}

    
    return {
        "geometry": geometry,
        "raw": gdf,
        "projected": gdf
        } 

