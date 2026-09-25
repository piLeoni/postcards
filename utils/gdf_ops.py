"""GeoDataFrame helpers: geometry type conversion and OSM attribute cleanup.

Anything here operates on a whole GeoDataFrame and preserves the other columns,
so a filter can convert geometry types without losing the OSM tags it may still
need.
"""

from __future__ import annotations

import geopandas as gpd
import pandas as pd
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
)
from shapely.geometry.base import BaseGeometry


def gdf_polygons_to_lines(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Convert Polygon/MultiPolygon geometries to their boundary lines.

    Each polygon becomes a MultiLineString of its exterior ring plus any holes.
    Other geometry types pass through unchanged.
    """

    def to_lines(geom):
        if isinstance(geom, Polygon):
            rings = [LineString(geom.exterior.coords)]
            rings.extend(LineString(interior.coords) for interior in geom.interiors)
            return MultiLineString(rings) if len(rings) > 1 else rings[0]
        if isinstance(geom, MultiPolygon):
            rings = []
            for poly in geom.geoms:
                rings.append(LineString(poly.exterior.coords))
                rings.extend(LineString(interior.coords) for interior in poly.interiors)
            return MultiLineString(rings)
        return geom

    out = gdf.copy()
    out["geometry"] = out["geometry"].apply(to_lines)
    return out


def gdf_to_all_linestrings(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Explode every geometry into individual LineStrings, one row each.

    MultiLineStrings are split, polygon rings become lines, and Points are
    dropped (there is nothing to draw). Attributes are copied onto each row.
    """
    lines: list[LineString] = []
    attributes: list[dict] = []

    for _, row in gdf.iterrows():
        geom = row["geometry"]
        attrs = row.drop("geometry").to_dict()

        def add(line):
            lines.append(line)
            attributes.append(attrs.copy())

        if isinstance(geom, LineString):
            add(geom)
        elif isinstance(geom, MultiLineString):
            for line in geom.geoms:
                add(line)
        elif isinstance(geom, Polygon):
            add(LineString(geom.exterior.coords))
            for interior in geom.interiors:
                add(LineString(interior.coords))
        elif isinstance(geom, MultiPolygon):
            for poly in geom.geoms:
                add(LineString(poly.exterior.coords))
                for interior in poly.interiors:
                    add(LineString(interior.coords))

    if not lines:
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    return gpd.GeoDataFrame(attributes, geometry=lines, crs=gdf.crs)


def gdf_remove_points(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Drop Point geometries — a point has no stroke to draw."""
    return gdf[gdf.geometry.type != "Point"]


def gdf_remove_below_ground(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Drop features that are underground: tunnels, negative levels, subways.

    OSM marks these with a negative ``layer``/``level`` or an explicit
    ``location=underground``. Drawing them would put ink where nothing is
    visible from above.
    """
    out = gdf.copy()

    for col in out.columns:
        if "layer" in col.lower() or "level" in col.lower():
            try:
                numeric = pd.to_numeric(out[col], errors="coerce")
                out = out[~(numeric < 0)]
            except (ValueError, TypeError):
                pass

    if "location" in out.columns:
        location = out["location"]
        underground = location.astype("string").str.lower() == "underground"
        out = out[~(underground.fillna(False))]

    return out


def flatten_geometry(geom) -> list[BaseGeometry]:
    """Recursively expand a geometry into a flat list of single geometries."""
    if geom is None:
        return []
    if isinstance(geom, GeometryCollection):
        geoms = []
        for part in geom.geoms:
            geoms.extend(flatten_geometry(part))
        return geoms
    if isinstance(geom, BaseGeometry) and geom.geom_type.startswith("Multi"):
        return list(geom.geoms)
    if isinstance(geom, BaseGeometry):
        return [geom]
    return []


def fully_flatten_gdf(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """One row per single geometry, expanding Multi* and GeometryCollections."""
    records = []
    for _, row in gdf.iterrows():
        for geom in flatten_geometry(row.geometry):
            record = row.drop("geometry").to_dict()
            record["geometry"] = geom
            records.append(record)

    if not records:
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    return gpd.GeoDataFrame(records, crs=gdf.crs)
