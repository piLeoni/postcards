"""Water: outlines plus a configurable area fill, optionally extended by ocean tiles.

When OSM exposes a coastline in the query area, the water body continues past
the card edge, so the ocean polygons from ``tiles/ocean_10deg`` are merged in to
give a complete shoreline instead of an open-ended band.

Fill algorithm / spacing come from ``[fill.water]`` (default: waves). Outline
style from ``[stroke.water]`` (default: solid).
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd
import shapely

from postcards.utils.gdf_ops import gdf_polygons_to_lines
from postcards.utils.gdf_ocean import load_ocean_tiles_by_polygon
from postcards.utils.layers import LayerParts, as_gdf
from postcards.utils.projection import project
from postcards.utils.theme_style import fill_geometry, stroke_lines

_DEFAULT_FILL = {"algorithm": "waves", "spacing": 0.75, "angle": 0}
_DEFAULT_STROKE = {"style": "solid"}


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
    region = shapely.union_all(list(mask.geometry))
    filling = as_gdf(
        fill_geometry(region, params, "water", defaults=_DEFAULT_FILL),
        gdf.crs,
    )
    outline_lines = [g for g in gdf_polygons_to_lines(mask).geometry if g is not None]
    outlines = as_gdf(
        stroke_lines(outline_lines, params, "water", defaults=_DEFAULT_STROKE),
        gdf.crs,
    )

    return LayerParts(
        outlines=outlines,
        filling=filling,
        mask=as_gdf(mask, gdf.crs),
    )
