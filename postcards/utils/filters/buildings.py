"""Buildings: outlines, inner detail lines, and an area fill.

The fill is an interchangeable algorithm selected per theme from the config —
see docs/fills.md. When the profile has no ``[fill.buildings]`` section this
falls back to the historical behaviour: a 45° hatch generated on the whole card
and clipped to the footprint.
"""

from __future__ import annotations

import geopandas as gpd
import shapely

from postcards.utils.fills import get_fill
from postcards.utils.gdf_ops import (
    gdf_polygons_to_lines,
    gdf_remove_below_ground,
    gdf_remove_points,
    gdf_to_all_linestrings,
)
from postcards.utils.layers import LayerParts, as_gdf, empty_gdf
from postcards.utils.patterns.lines import lines_pattern

# The inset the historical hatch used, independent of the fill spacing. Kept so
# existing profiles render identically; the new fills inset themselves.
LEGACY_INSET_MM = 0.1


def _fill_settings(params: dict) -> dict:
    """``[fill.buildings]`` from the profile, if the run has a config."""
    config = params.get("config")
    if not config:
        return {}
    from postcards.utils.plot_config import fill_section, load_plot_config

    try:
        return fill_section(load_plot_config(config), "buildings")
    except FileNotFoundError:
        return {}


def _fill_geometry(building_geoms, crs, params: dict) -> gpd.GeoDataFrame:
    """Hatch each building footprint with the configured fill algorithm.

    Footprints are filled one at a time (not after dissolve): merging adjacent
    buildings into one outline creates courtyard-like notches that shatter the
    zigzag bands even when each building alone would serpentine cleanly.
    """
    settings = _fill_settings(params)
    geoms = [g for g in building_geoms if g is not None and not g.is_empty]
    if not geoms:
        return empty_gdf(crs)

    if not settings:
        # No configuration: keep the original card-wide hatch.
        outlines = as_gdf(geoms, crs)
        inner = outlines.buffer(-LEGACY_INSET_MM)
        filling = as_gdf(
            lines_pattern(params, 0.5, 45, bounds=outlines.total_bounds), crs
        )
        return filling.clip(inner)

    algorithm = settings.get("algorithm", "rectilinear")
    spacing = float(settings.get("spacing", 0.5))
    angle = float(settings.get("angle", 45))
    inset_mm = settings.get("inset")

    options = {}
    if angle is not None:
        options["angle"] = angle
    if inset_mm is not None:
        options["inset_mm"] = inset_mm
    options.update(_algorithm_options(params, algorithm))

    filler = get_fill(algorithm)
    lines = []
    for geom in geoms:
        lines.extend(filler(geom, spacing, **options))
    return as_gdf(lines, crs)


def _algorithm_options(params: dict, algorithm: str) -> dict:
    """Per-algorithm options from ``[fill.buildings.<algorithm>]``."""
    config = params.get("config")
    if not config:
        return {}
    from postcards.utils.plot_config import fill_options, load_plot_config

    try:
        cfg = load_plot_config(config)
    except FileNotFoundError:
        return {}
    options = fill_options(cfg, "buildings", algorithm)
    # A theme-level key like `connector` sits next to `algorithm` when the user
    # only wants one algorithm; accept it from either place.
    theme = (cfg.get("fill") or {}).get("buildings") or {}
    for key, value in theme.items():
        if key in ("algorithm", "spacing", "angle", "inset"):
            continue
        options.setdefault(key, value)
    return options


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

    return LayerParts(
        outlines=gdf_polygons_to_lines(outlines),
        details=details,
        filling=_fill_geometry(gdf.geometry, gdf.crs, params),
        mask=as_gdf(outlines, gdf.crs),
    )
