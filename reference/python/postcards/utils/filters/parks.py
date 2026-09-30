"""Parks / gardens / grass / woods: configurable fills + one soft outer outline.

OSM labels different green kinds, but dissolving them all into one solid-edged
blob made the card shout. Instead:

- **Fill** each kind with its own ``[fill.parks.kinds.<name>]`` settings
  (algorithm, spacing, angle, …) — garden can be dots while wood is waves.
- **Outline** only the union of all kinds, styled via ``[stroke.parks]``.
- OSM park polygons often carry interior rings (lakes, courtyards, buildings).
  Filling uses the exterior only; composition punches real buildings / water /
  roads out afterwards.
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd
import shapely
from shapely.geometry import LineString

from postcards.utils.gdf_ops import gdf_remove_below_ground, gdf_remove_points
from postcards.utils.layers import LayerParts, as_gdf, empty_gdf
from postcards.utils.theme_style import (
    fill_geometry,
    stroke_lines,
    theme_fill_kinds,
    theme_fill_settings,
)

# (column, value, kind). First match wins when a feature carries several tags.
PARK_KINDS: tuple[tuple[str, str, str], ...] = (
    ("leisure", "garden", "garden"),
    ("leisure", "park", "park"),
    ("natural", "wood", "wood"),
    ("landuse", "forest", "wood"),
    ("leisure", "nature_reserve", "wood"),
    ("landuse", "grass", "grass"),
    ("natural", "grassland", "grass"),
    ("landuse", "meadow", "grass"),
)

# Defaults when the profile omits [fill.parks] / [stroke.parks].
# Kind order = claim priority when OSM tags overlap.
_DEFAULT_KINDS: dict[str, dict] = {
    "garden": {"spacing": 0.25},
    "park": {"spacing": 0.45},
    "wood": {"spacing": 0.70},
    "grass": {"spacing": 0.85},
}
_DEFAULT_FILL = {
    "algorithm": "dots",
    "spacing": 0.50,
    "angle": 45,
    "mark": 0.2,
}
_DEFAULT_STROKE = {
    "style": "dash",
    "dash": 0.45,
    "gap": 0.40,
}

# Re-exported for tests.
DOT_SPACING_MM = {k: float(v["spacing"]) for k, v in _DEFAULT_KINDS.items()}
OUTLINE_DASH_MM = _DEFAULT_STROKE["dash"]


def _ensure_columns(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    out = gdf
    for col, _, _ in PARK_KINDS:
        if col not in out.columns:
            out = out.copy()
            out[col] = None
    return out


def _assign_kind(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Attach a ``kind`` column; drop rows that match none of the park tags."""
    gdf = _ensure_columns(gdf)
    kind = pd.Series(pd.NA, index=gdf.index, dtype="string")
    for col, value, name in PARK_KINDS:
        hit = kind.isna() & (gdf[col] == value)
        kind = kind.mask(hit, name)
    out = gdf.copy()
    out["kind"] = kind
    return out[out["kind"].notna()].copy()


def _filled_region(geom: shapely.geometry.base.BaseGeometry):
    """Drop interior rings so fill covers the whole footprint.

    Real occlusions (buildings, water, roads) are subtracted later in
    composition; OSM holes alone would leave unexplained white patches.
    """
    if geom is None or geom.is_empty:
        return geom
    if geom.geom_type == "Polygon":
        return shapely.Polygon(geom.exterior)
    if geom.geom_type == "MultiPolygon":
        return shapely.MultiPolygon([shapely.Polygon(p.exterior) for p in geom.geoms])
    if geom.geom_type == "GeometryCollection":
        parts = [_filled_region(g) for g in geom.geoms]
        parts = [p for p in parts if p is not None and not p.is_empty]
        if not parts:
            return shapely.Polygon()
        return shapely.union_all(parts)
    return geom


def filter_parks(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts:
    gdf = _assign_kind(gdf)
    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)
    if gdf.empty:
        return LayerParts()

    crs = gdf.crs
    theme_defaults = theme_fill_settings(params, "parks", _DEFAULT_FILL)
    kind_settings = theme_fill_kinds(params, "parks", _DEFAULT_KINDS)

    union = shapely.union_all(list(gdf.geometry))
    union_ext = _filled_region(union)

    fills: list[gpd.GeoDataFrame] = []
    # Higher-priority kinds claim area first (dict order: garden → park → wood → grass).
    claimed: shapely.geometry.base.BaseGeometry = shapely.Polygon()
    for kind, settings in kind_settings.items():
        subset = gdf[gdf["kind"] == kind]
        if subset.empty:
            continue
        region_geom = _filled_region(shapely.union_all(list(subset.geometry)))
        region_geom = region_geom.intersection(union_ext)
        if not claimed.is_empty:
            region_geom = region_geom.difference(claimed)
        if region_geom is None or region_geom.is_empty:
            continue
        fills.append(_fill_region(region_geom, params, crs, theme_defaults, settings))
        claimed = region_geom if claimed.is_empty else shapely.union_all([claimed, region_geom])

    leftover = union_ext if claimed.is_empty else union_ext.difference(claimed)
    if leftover is not None and not leftover.is_empty:
        leftover_kind = str(theme_defaults.get("leftover", "wood"))
        leftover_settings = kind_settings.get(
            leftover_kind, {**theme_defaults, "spacing": theme_defaults.get("spacing", 0.5)}
        )
        fills.append(_fill_region(leftover, params, crs, theme_defaults, leftover_settings))

    if fills:
        filling = gpd.GeoDataFrame(
            pd.concat(fills, ignore_index=True), geometry="geometry", crs=crs
        )
        filling = as_gdf(filling, crs)
    else:
        filling = empty_gdf(crs)

    mask = as_gdf(union, crs)
    outlines = as_gdf(
        stroke_lines(_outer_rings(union), params, "parks", defaults=_DEFAULT_STROKE),
        crs,
    )

    return LayerParts(outlines=outlines, filling=filling, mask=mask)


def _fill_region(
    region_geom: shapely.geometry.base.BaseGeometry,
    params: dict,
    crs,
    theme_defaults: dict,
    kind_settings: dict,
) -> gpd.GeoDataFrame:
    lines = fill_geometry(
        region_geom,
        params,
        "parks",
        defaults=theme_defaults,
        overrides=kind_settings,
    )
    return as_gdf(lines, crs)


def _outer_rings(geom: shapely.geometry.base.BaseGeometry) -> list[LineString]:
    """Exterior rings only (Polygon / MultiPolygon / GeometryCollection)."""
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [LineString(geom.exterior.coords)]
    if geom.geom_type == "MultiPolygon":
        return [LineString(p.exterior.coords) for p in geom.geoms]
    if geom.geom_type == "GeometryCollection":
        out: list[LineString] = []
        for g in geom.geoms:
            out.extend(_outer_rings(g))
        return out
    return []
