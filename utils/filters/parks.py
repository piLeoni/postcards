
import shapely
import geopandas as gpd
from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground, gdf_to_all_linestrings, fully_flatten_gdf
from utils.patterns.lines import lines_pattern
from utils.gdf_projector import gdf_projector
from utils.patterns.dots import dots_pattern

def filter_parks(gdf, params):
    
    for col in ['landuse', 'leisure', 'natural']:
        if col not in gdf.columns:
            gdf[col] = None

    gdf = gdf[
        (gdf['landuse'] == 'grass') |
        (gdf['leisure'] == 'park') |
        (gdf['leisure'] == 'garden') |
        (gdf['natural'] == 'wood')
    ]

    projected_gdf = gdf_projector(gdf, params)
    # if 'building' in gdf.columns:
    #     gdf = gdf[gdf['building'].notna()] 

    projected_gdf = gdf_remove_points(projected_gdf)
    projected_gdf = gdf_remove_below_ground(projected_gdf)

    
    def geometry():
        outlines = projected_gdf.copy().dissolve(by=None, aggfunc='first')
        print()
        # outlines_mask = gdf_polygons_to_lines(outlines).buffer(0.1)
        
        # details = shapely.union_all(gdf_to_all_linestrings(projected_gdf).geometry)
        # details = gpd.GeoDataFrame([details], columns=['geometry'], crs=projected_gdf.crs).difference(outlines_mask)
        # details = gpd.GeoDataFrame(geometry=details, crs=projected_gdf.crs)
        
        filling = gpd.GeoDataFrame(geometry = dots_pattern(params, 0.75, 45),  crs=projected_gdf.crs).clip(outlines).dissolve(by=None, aggfunc='first')
        

        return {"outlines": gdf_polygons_to_lines(outlines), "details": outlines, "filling": filling, "mask": outlines}

    
    return {
        "geometry": geometry,
        "raw": gdf,
        "projected": projected_gdf
        } 


