
import geopandas as gpd
from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground
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

    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)

    
    def geometry():
        outlines = gdf.copy().dissolve(by=None, aggfunc='first')        
        filling = gpd.GeoDataFrame(geometry = dots_pattern(params, 0.5, 45),  crs=gdf.crs).clip(outlines).dissolve(by=None, aggfunc='first')
        return {"outlines": gdf_polygons_to_lines(outlines), "details": outlines, "filling": filling, "mask": outlines}

    
    return {
        "geometry": geometry,
        "raw": gdf,
        "projected": gdf
        } 


