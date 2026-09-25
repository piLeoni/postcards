"""Layer stacking order and occlusion rules.

Map themes overlap: a road crosses a building footprint, a park sits under a
river. Rather than clipping every theme against every other theme, composition
walks the layers **bottom-up** and, for each one, subtracts the union of the
higher layers' masks from it. A theme therefore only ever gets clipped by
things drawn on top of it, and each rule is stated once.

Inside a single layer the same idea applies to its own parts: a theme's
``filling`` is produced already inset by the fill algorithm (or by the legacy
hatch clip), so composition does not clip it again — only occludes it against
layers drawn above.
"""

from __future__ import annotations

import geopandas as gpd
import shapely

# Bottom-most first. Each name maps to the SVG group id written by the composer
# and to the theme key returned by the filters.
STACK_ORDER = ("roads", "buildings", "parks", "water")

# Parts written for every theme, in draw order within the theme.
PART_ORDER = ("outlines", "details", "filling")


def _drop_empty(gdf: gpd.GeoDataFrame, crs) -> gpd.GeoDataFrame:
    """Keep only rows with a real, non-empty geometry."""
    if gdf.empty:
        return gdf
    keep = gdf.geometry.notna() & ~gdf.geometry.is_empty
    return gpd.GeoDataFrame(gdf[keep], crs=crs)


def _subtract(gdf: gpd.GeoDataFrame, cutters: list[shapely.geometry.base.BaseGeometry], crs):
    """Remove ``cutters`` from every geometry in ``gdf``."""
    if gdf.empty or not cutters:
        return gdf
    cutter = shapely.union_all(cutters)
    if cutter.is_empty:
        return gdf
    out = gdf.copy()
    out["geometry"] = out.geometry.apply(
        lambda g: g.difference(cutter) if g is not None and not g.is_empty else g
    )
    return _drop_empty(out, crs)


def compose_layers(parts: dict) -> dict[str, gpd.GeoDataFrame]:
    """Turn per-theme :class:`LayerParts` into ordered, non-overlapping layers.

    Args:
        parts: ``{theme_name: LayerParts}`` for every theme that produced data.

    Returns:
        ``{svg_layer_name: GeoDataFrame}`` in draw order, each already clipped
        against everything drawn above it.
    """
    crs = next(
        (parts[name].crs for name in STACK_ORDER if name in parts and parts[name].crs),
        None,
    )

    # Masks of layers above each position, accumulated as we walk down.
    drawn_above: list[shapely.geometry.base.BaseGeometry] = []
    result: dict[str, gpd.GeoDataFrame] = {}

    for theme in reversed(STACK_ORDER):
        layer = parts.get(theme)
        if layer is None or layer.is_empty:
            continue

        own_mask = layer.mask_union()

        # Filling algorithms (and the legacy hatch) already inset themselves so
        # strokes clear the outline. Re-clipping with buffer(-0.1) here used to
        # shatter zigzag connectors that sat near mitred corners — the hatch
        # looked like plain rectilinear on some buildings and serpentine on
        # others. Trust the fill; only occlude against layers drawn above.
        filling = layer.filling

        for suffix in PART_ORDER:
            geoms = filling if suffix == "filling" else getattr(layer, suffix)
            if geoms.empty:
                continue
            kept = _subtract(geoms, drawn_above, crs)
            if not kept.empty:
                result[f"{theme}_{suffix}"] = kept

        if not own_mask.is_empty:
            drawn_above.append(own_mask)

    # Draw order: bottom-most layer first. STACK_ORDER is bottom-up, so build the
    # output in that same order rather than the reversed walk order.
    ordered: dict[str, gpd.GeoDataFrame] = {}
    for theme in STACK_ORDER:
        for suffix in PART_ORDER:
            key = f"{theme}_{suffix}"
            if key in result:
                ordered[key] = result[key]
    return ordered
