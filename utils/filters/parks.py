"""Parks: outlines plus a dotted fill."""

from __future__ import annotations

import geopandas as gpd

from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_below_ground, gdf_remove_points
from utils.layers import LayerParts, as_gdf
from utils.patterns.dots import dots_pattern

PARK_FILTER = (
    ("landuse", "grass"),
    ("leisure", "park"),
    ("leisure", "garden"),
    ("natural", "wood"),
)


def filter_parks(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts:
    for col, _ in PARK_FILTER:
        if col not in gdf.columns:
            gdf[col] = None

    mask_any = None
    for col, value in PARK_FILTER:
        match = gdf[col] == value
        mask_any = match if mask_any is None else (mask_any | match)
    gdf = gdf[mask_any.fillna(False)]

    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)
    if gdf.empty:
        return LayerParts()

    outlines = gdf.dissolve(by=None, aggfunc="first")
    filling = as_gdf(dots_pattern(params, 0.5, 45, bounds=gdf.total_bounds), gdf.crs)
    filling = filling.clip(outlines)

    return LayerParts(
        outlines=gdf_polygons_to_lines(outlines),
        filling=filling,
        mask=as_gdf(outlines, gdf.crs),
    )
