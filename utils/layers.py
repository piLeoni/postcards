"""The single contract every theme filter must satisfy.

A filter takes a projected GeoDataFrame plus the run params and returns a
:class:`LayerParts`. No lambdas, no extra keys, no optional dict shapes — the
four geometries are always present (possibly empty) so callers never need
``if <key> in ...`` guards.

Field meanings:

``outlines``
    The strokes that draw the theme's boundary/edges.
``details``
    Secondary strokes inside the theme (kerbs, steps, inner edges).
``filling``
    A hatch pattern used to fill the theme's area with a texture.
``mask``
    The solid area covered by the theme, as polygons. Used for stacking
    (who occludes whom), not for drawing.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import geopandas as gpd
import shapely


def empty_gdf(crs=None) -> gpd.GeoDataFrame:
    """An empty GeoDataFrame usable as a neutral element for any field."""
    return gpd.GeoDataFrame(geometry=[], crs=crs)


def as_gdf(geoms, crs=None) -> gpd.GeoDataFrame:
    """Coerce a geometry / GeoSeries / GeoDataFrame / list into a GeoDataFrame.

    Rows whose geometry is missing or empty are dropped, so every ``LayerParts``
    field really only contains drawable geometry.
    """
    if isinstance(geoms, gpd.GeoDataFrame):
        out = geoms
        if crs is not None and out.crs is None:
            out = out.set_crs(crs)
    elif isinstance(geoms, gpd.GeoSeries):
        out = gpd.GeoDataFrame(geometry=geoms, crs=geoms.crs or crs)
    elif geoms is None:
        return empty_gdf(crs)
    elif isinstance(geoms, shapely.geometry.base.BaseGeometry):
        out = gpd.GeoDataFrame(geometry=[geoms], crs=crs)
    else:
        out = gpd.GeoDataFrame(geometry=list(geoms), crs=crs)

    if out.empty:
        return out
    keep = out.geometry.notna() & ~out.geometry.is_empty
    return gpd.GeoDataFrame(out[keep], crs=out.crs)


@dataclass
class LayerParts:
    """Drawable pieces of one map theme, ready for SVG composition."""

    outlines: gpd.GeoDataFrame = field(default_factory=empty_gdf)
    details: gpd.GeoDataFrame = field(default_factory=empty_gdf)
    filling: gpd.GeoDataFrame = field(default_factory=empty_gdf)
    mask: gpd.GeoDataFrame = field(default_factory=empty_gdf)

    def __post_init__(self) -> None:
        crs = next(
            (p.crs for p in (self.outlines, self.details, self.filling, self.mask) if p.crs),
            None,
        )
        self.outlines = as_gdf(self.outlines, crs)
        self.details = as_gdf(self.details, crs)
        self.filling = as_gdf(self.filling, crs)
        self.mask = as_gdf(self.mask, crs)

    @property
    def crs(self):
        """The CRS shared by the parts, or None if there is nothing to report."""
        for part in (self.outlines, self.details, self.filling, self.mask):
            if part.crs is not None:
                return part.crs
        return None

    @property
    def is_empty(self) -> bool:
        return all(
            p.empty for p in (self.outlines, self.details, self.filling, self.mask)
        )

    def mask_union(self) -> shapely.geometry.base.BaseGeometry:
        """The mask as one geometry; empty Polygon when there is no mask."""
        if self.mask.empty:
            return shapely.geometry.Polygon()
        return shapely.union_all(self.mask.geometry)
