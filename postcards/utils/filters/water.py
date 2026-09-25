"""Water: outlines plus a wave fill, optionally extended by ocean tiles.

When OSM exposes a coastline in the query area, the water body continues past
the card edge, so the ocean polygons from ``tiles/ocean_10deg`` are merged in to
give a complete shoreline instead of an open-ended band.
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd

from postcards.utils.gdf_ops import gdf_polygons_to_lines
from postcards.utils.gdf_ocean import load_ocean_tiles_by_polygon
from postcards.utils.layers import LayerParts, as_gdf, empty_gdf
from postcards.utils.patterns.waves import waves_pattern
from postcards.utils.projection import project


def filter_water(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts:
    for col in ("water", "natural"):
        if col not in gdf.columns:
            gdf[col] = None

    coastline = gdf[gdf["natural"] == "coastline"]
    water = gdf[gdf["water"].notna() | (gdf["natural"] == "water")]

    if not coastline.empty:
        print("coastline found — loading ocean tiles")
        ocean = load_ocean_tiles_by_polygon(params["polygon"], crs=gdf.crs)
        if not ocean.empty:
            ocean = project(ocean, params)
            water = pd.concat([water, ocean], ignore_index=True)

    if water.empty:
        return LayerParts()

    mask = water.dissolve(by=None, aggfunc="first")
    filling = as_gdf(
        waves_pattern(params, 0.75, 0, bounds=water.total_bounds), gdf.crs
    )
    filling = filling.clip(mask.copy().buffer(-0.1))

    return LayerParts(
        outlines=gdf_polygons_to_lines(mask),
        filling=filling,
        mask=as_gdf(mask, gdf.crs),
    )
