# import shapely
# import geopandas as gpd
# import pandas as pd
# from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground, gdf_to_all_linestrings, fully_flatten_gdf
# from utils.patterns.lines import lines_pattern
# from utils.gdf_projector import gdf_projector
# from utils.patterns.waves import waves_pattern

# def filter_water(gdf, params):
    
#     # if ('water' not in gdf.columns and 'natural' not in gdf.columns):
#     #     print("No 'water' or 'natural' column found in gdf")
#     #     # sea_gdf = gpd.read_file("water-polygons-split-4326/water_polygons.shp")
#     #     # sea_gdf = sea_gdf.to_crs(gdf.crs)        # sea_gdf = gpd.read_file("water-polygons-split-4326/water_polygons.shp")
#     #     # sea_gdf = sea_gdf.to_crs(gdf.crs)


#         # return {
#         #     "geometry": lambda: {"outlines": gpd.GeoDataFrame(geometry=[], crs=gdf.crs),
#         #                          "details": gpd.GeoDataFrame(geometry=[], crs=gdf.crs),
#         #                          "filling": gpd.GeoDataFrame(geometry=[], crs=gdf.crs),
#         #                          "mask": gpd.GeoDataFrame(geometry=[], crs=gdf.crs)},
#         #     "raw": gdf,
#         #     "projected": gdf
#         # }

#     # if 'water'  in gdf.columns:
#     #     water_gdf = gdf[gdf['water'].notna()]
#     #     projected_water_gdf = gdf_projector(water_gdf, params)
#     #     projected_water_gdf = gdf_remove_points(projected_water_gdf)
#     #     print("projected_water_gdf", projected_water_gdf)

#     # else:
#     #     projected_water_gdf = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
#     #     print("NO projected_water_gdf", projected_water_gdf)

#     # if 'natural' in gdf.columns:
#     #     coastline_gdf = gdf[gdf['natural'] == 'coastline']
#     #     projected_coastline_gdf = gdf_projector(coastline_gdf, params)
#     #     projected_coastline_gdf = gdf_remove_points(projected_coastline_gdf)
#     #     print("projected_coastline_gdf", projected_coastline_gdf)
#     # else:
#     #     projected_coastline_gdf = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
#     #     print("NO projected_coastline_gdf", projected_coastline_gdf)


#     outlines= gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
#     details= gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
#     filling= gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
#     mask= gpd.GeoDataFrame(geometry=[], crs=gdf.crs)

    
#     def geometry():
        
#         global mask
#         global outlines 
#         global details
#         global filling 

#         print()
#         if 'water'  in gdf.columns:
#             water_gdf = gdf[gdf['water'].notna()]
#             projected_water_gdf = gdf_projector(water_gdf, params)
#             projected_water_gdf = gdf_remove_points(projected_water_gdf)
#             mask = projected_water_gdf.copy()
#             outlines = projected_water_gdf.copy()
            
#         if 'natural' in gdf.columns:
#             coastline_gdf = gdf[gdf['natural'] == 'coastline']
#             projected_coastline_gdf = gdf_projector(coastline_gdf, params)
#             projected_coastline_gdf = gdf_remove_points(projected_coastline_gdf)
#             details = projected_coastline_gdf.copy()
#             print("projected_coastline_gdf", projected_coastline_gdf)
        
#         if len(mask.geometry) > 0:
#             filling = gpd.GeoDataFrame(geometry = waves_pattern(params, 0.75, 0),  crs=mask.crs).clip(mask).dissolve(by=None, aggfunc='first')
        
#         # print("projected_coastline_gdf", projected_coastline_gdf)

#         # outlines = gpd.GeoDataFrame(geometry=projected_coastline_gdf.geometry, crs=projected_coastline_gdf.crs)
#         # outlines = outlines.copy().dissolve(by=None, aggfunc='first')
        

#         # outlines = pd.concat([projected_water_gdf, coastline_gdf], ignore_index=True).copy().dissolve(by=None, aggfunc='first')
        

#         # outlines = projected_water_gdf.copy().dissolve(by=None, aggfunc='first')
        
#         # filling = gpd.GeoDataFrame(geometry = waves_pattern(params, 0.75, 0),  crs=projected_water_gdf.crs).clip(outlines).dissolve(by=None, aggfunc='first')
        

#         return {"outlines": gdf_polygons_to_lines(outlines), "details": details, "filling": filling, "mask": mask}

    
#     return {
#         "geometry": geometry
#         } 


import shapely
import geopandas as gpd
import pandas as pd
from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground, gdf_to_all_linestrings, fully_flatten_gdf
from utils.patterns.lines import lines_pattern
from utils.gdf_projector import gdf_projector
from utils.patterns.waves import waves_pattern

def filter_water(gdf, params):
    outlines = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    details = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    filling = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    mask = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)

    if 'water' in gdf.columns:
        water_gdf = gdf[gdf['water'].notna()]
        projected_water_gdf = gdf_projector(water_gdf, params)
        projected_water_gdf = gdf_remove_points(projected_water_gdf)
        mask = projected_water_gdf.copy()
        outlines = projected_water_gdf.copy()

    if 'natural' in gdf.columns:
        coastline_gdf = gdf[gdf['natural'] == 'coastline']
        projected_coastline_gdf = gdf_projector(coastline_gdf, params)  # Project the coastline data
        projected_coastline_gdf = gdf_remove_points(projected_coastline_gdf)
        details = projected_coastline_gdf.copy()

    if not mask.empty:
        filling = gpd.GeoDataFrame(
            geometry=waves_pattern(params, 0.75, 0),
            crs=mask.crs
        ).clip(mask).dissolve(by=None, aggfunc='first')

    return {
        "geometry": lambda: {
            "outlines": gdf_polygons_to_lines(outlines),
            "details": details,
            "filling": filling,
            "mask": mask
        }
    }

