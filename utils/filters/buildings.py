"""Buildings: outlines, inner detail lines, and a diagonal hatch fill."""

from __future__ import annotations

import geopandas as gpd
import shapely

from utils.gdf_ops import (
    gdf_polygons_to_lines,
    gdf_remove_below_ground,
    gdf_remove_points,
    gdf_to_all_linestrings,
)
from utils.layers import LayerParts, as_gdf, empty_gdf
from utils.patterns.lines import lines_pattern


def filter_buildings(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts:
    if "building" not in gdf.columns:
        print("No 'building' column found in gdf")
        return LayerParts()

    gdf = gdf[gdf["building"].notna()]
    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)
    if gdf.empty:
        return LayerParts()

    outlines = gdf.dissolve(by=None, aggfunc="first")
    inner = outlines.buffer(-0.1)

    details = as_gdf(shapely.union_all(gdf_to_all_linestrings(gdf).geometry), gdf.crs)
    details = details.clip(inner)

    filling = as_gdf(lines_pattern(params, 0.5, 45, bounds=gdf.total_bounds), gdf.crs)
    filling = filling.clip(inner)

    return LayerParts(
        outlines=gdf_polygons_to_lines(outlines),
        details=details,
        filling=filling,
        mask=as_gdf(outlines, gdf.crs),
    )
