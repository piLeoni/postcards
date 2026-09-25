"""Registry mapping theme names to their filter functions.

``make_map.py`` asks this module for every theme's :class:`LayerParts` instead
of importing and calling four filters by hand. Adding a theme means writing a
filter with the same ``(gdf, params) -> LayerParts`` signature and listing it in
:data:`FILTERS`; nothing else in the pipeline changes.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Callable

import geopandas as gpd

from utils.filters.buildings import filter_buildings
from utils.filters.parks import filter_parks
from utils.filters.roads import filter_roads
from utils.filters.water import filter_water
from utils.layers import LayerParts

# Order here is the order themes are *computed*; draw order lives in
# utils/composition.STACK_ORDER.
FILTERS: "OrderedDict[str, Callable[[gpd.GeoDataFrame, dict], LayerParts]]" = OrderedDict(
    [
        ("roads", filter_roads),
        ("buildings", filter_buildings),
        ("parks", filter_parks),
        ("water", filter_water),
    ]
)


def layer_names() -> list[str]:
    """Theme names known to the pipeline, bottom-most first."""
    return list(FILTERS)


def build_layers(gdf: gpd.GeoDataFrame, params: dict) -> dict[str, LayerParts]:
    """Run every registered filter and return ``{theme: LayerParts}``."""
    return {name: fn(gdf, params) for name, fn in FILTERS.items()}
