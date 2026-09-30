"""Projection from geographic coordinates onto the card, in millimetres.

Two modes, chosen by ``[map].projection``:

``utm``
    Project into the local UTM zone. Metres are true metres near the zone
    meridian; distortion grows away from it.
``webmercator``
    Project into Web Mercator, then correct the scale at the card centre by
    measuring real ground distances with a geodesic. This is what keeps the
    drawing aligned with the Web Mercator raster tiles the map is based on.

Both modes end with the same three steps: centre the origin, scale metres to
card mm at the requested ratio, then place the result on the page and apply the
bearing.
"""

from __future__ import annotations

from math import radians

import geopandas as gpd
import shapely
from pyproj import CRS, Geod, Transformer
from shapely.affinity import rotate, scale as shapely_scale

VALID_MODES = ("utm", "webmercator")


def _scale_factor(params: dict) -> int:
    return int(str(params["scale"]).split(":")[1])


def _place_on_page(gdf: gpd.GeoDataFrame, params: dict) -> gpd.GeoDataFrame:
    """Move the centred geometry onto the page and apply the bearing."""
    width, height = params["width_mm"], params["height_mm"]
    gdf = gdf.copy()
    gdf["geometry"] = gdf["geometry"].translate(xoff=width / 2, yoff=height / 2)
    if params.get("bearing", 0):
        gdf["geometry"] = gdf["geometry"].rotate(
            -params["bearing"], origin=(width / 2, height / 2)
        )
    return gdf


def _project_utm(gdf: gpd.GeoDataFrame, params: dict, lon: float, lat: float):
    """Local UTM CRS plus the centre point expressed in it."""
    zone = int((lon + 180) / 6) + 1
    epsg = (32600 if lat >= 0 else 32700) + zone
    utm_crs = CRS.from_epsg(epsg)
    transformer = Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)
    return utm_crs, transformer.transform(lon, lat)


def _project_webmercator(gdf: gpd.GeoDataFrame, params: dict, lon: float, lat: float):
    """Web Mercator CRS plus the metre-per-unit factors at the centre."""
    crs = CRS.from_epsg(3857)
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    cx, cy = transformer.transform(lon, lat)

    geod = Geod(ellps="WGS84")
    lon1, lat1 = transformer.transform(cx, cy, direction="INVERSE")
    lon2, lat2 = transformer.transform(cx + 1, cy, direction="INVERSE")
    lon3, lat3 = transformer.transform(cx, cy + 1, direction="INVERSE")
    x_m = geod.line_length([lon1, lon2], [lat1, lat2]) or 1.0
    y_m = geod.line_length([lon1, lon3], [lat1, lat3]) or 1.0
    return crs, (cx, cy), (x_m, y_m)


def project(gdf: gpd.GeoDataFrame, params: dict) -> gpd.GeoDataFrame:
    """Project ``gdf`` from EPSG:4326 onto the card in mm.

    Args:
        gdf: features in lon/lat.
        params: run params; needs ``center_coords``, ``width_mm``, ``height_mm``,
            ``scale``, ``bearing`` and ``projection``.

    Returns:
        A new GeoDataFrame with geometries in page millimetres, y downwards.
    """
    if gdf.empty:
        return gdf

    mode = str(params.get("projection", "utm")).lower()
    if mode not in VALID_MODES:
        raise ValueError(f"unknown projection {mode!r} (use one of {VALID_MODES})")

    lon, lat = params["center_coords"]
    mm_per_m = 1000 / _scale_factor(params)

    if mode == "utm":
        crs, (cx, cy) = _project_utm(gdf, params, lon, lat)
        gdf = gdf.to_crs(crs)
        gdf = gdf.copy()
        gdf["geometry"] = gdf["geometry"].translate(xoff=-cx, yoff=-cy)
        gdf["geometry"] = gdf["geometry"].apply(
            lambda g: shapely_scale(g, xfact=mm_per_m, yfact=-mm_per_m, origin=(0, 0))
        )
    else:
        crs, (cx, cy), (x_m, y_m) = _project_webmercator(gdf, params, lon, lat)
        gdf = gdf.to_crs(crs)
        gdf = gdf.copy()
        gdf["geometry"] = gdf["geometry"].translate(xoff=-cx, yoff=-cy)
        gdf["geometry"] = gdf["geometry"].apply(
            lambda g: shapely_scale(
                g, xfact=mm_per_m * x_m, yfact=-mm_per_m * y_m, origin=(0, 0)
            )
        )

    return _place_on_page(gdf, params)
