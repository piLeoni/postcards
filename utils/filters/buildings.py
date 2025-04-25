import shapely
import geopandas as gpd
from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground, gdf_to_all_linestrings, fully_flatten_gdf
from utils.patterns.lines import lines_pattern
from utils.gdf_projector import gdf_projector

def filter_buildings(gdf, params):
    
    if 'building' in gdf.columns:
        gdf = gdf[gdf['building'].notna()]

    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)

    projected_gdf = gdf_projector(gdf, params)
    
    def geometry():
        outlines = projected_gdf.copy().dissolve(by=None, aggfunc='first')
        outlines_mask = gdf_polygons_to_lines(outlines).buffer(0.1)
        
        details = shapely.union_all(gdf_to_all_linestrings(projected_gdf).geometry)
        details = gpd.GeoDataFrame([details], columns=['geometry'], crs=projected_gdf.crs).difference(outlines_mask)
        details = gpd.GeoDataFrame(geometry=details, crs=projected_gdf.crs)
        
        filling = gpd.GeoDataFrame(geometry=lines_pattern(params, 0.5, 45)).clip(outlines)
        return {"outlines": gdf_polygons_to_lines(outlines), "details": details, "filling": filling, "mask": outlines}

    

    return {
        "geometry": geometry,
        "raw": gdf,
        "projected": projected_gdf
        } 

