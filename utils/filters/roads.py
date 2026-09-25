"""Roads: outlines, kerb/level detail lines, and nothing to fill.

Roads are modelled as the area the carriageway actually covers. Each way is
buffered by half its real width, so the drawn edges land where the street is.
Widths come from OSM in priority order: the ``width`` tag, then ``lanes``, then
a per-highway-type average.

Roads carrying a positive ``layer`` tag (bridges, overpasses) are handled
separately: each layer is subtracted from the ones below it so a bridge reads as
crossing over the street underneath, and the resulting seams become the
``details`` strokes.
"""

from __future__ import annotations

import re
from collections import defaultdict

import geopandas as gpd
import pandas as pd
import shapely
from geopy.geocoders import Nominatim

from utils.gdf_ops import (
    gdf_polygons_to_lines,
    gdf_remove_below_ground,
    gdf_remove_points,
    gdf_to_all_linestrings,
)
from utils.layers import LayerParts, as_gdf
from utils.ops import geometry_to_linestrings

# Typical carriageway width in metres, by OSM highway value. Used only when the
# way carries neither a width nor a lane count.
WIDTH_BY_TYPE = {
    "motorway": 15,
    "motorway_link": 7,
    "trunk": 10,
    "trunk_link": 6,
    "primary": 7,
    "primary_link": 6,
    "secondary": 6,
    "secondary_link": 5,
    "tertiary": 5,
    "tertiary_link": 5,
    "residential": 4,
    "living_street": 3,
    "service": 3,
    "pedestrian": 3,
    "footway": 1,
    "cycleway": 1.5,
    "bridleway": 2,
    "path": 1,
    "steps": 1,
    "unclassified": 4,
    "construction": 5,
    "elevator": 1.5,
}

# Countries whose OSM data is in feet rather than metres.
IMPERIAL_COUNTRIES = {"United States", "Canada", "Liberia", "Myanmar"}

DEFAULT_WIDTH_M = 6.0
LANE_WIDTH_M = 3.0
# Roads are widened slightly so neighbouring ways visibly touch on the card.
BUFFER_FUDGE = 1.25


def _country_at(lon: float, lat: float) -> str | None:
    geolocator = Nominatim(user_agent="postcards")
    location = geolocator.reverse((lat, lon), exactly_one=True)
    if location and "country" in location.raw.get("address", {}):
        return location.raw["address"]["country"]
    return None


def _local_units_factor(params: dict) -> float:
    """Metres per local ``width`` unit (1.0 unless the address is imperial)."""
    try:
        country = _country_at(*params["center_coords"])
    except Exception:
        return 1.0
    return 0.3048 if country in IMPERIAL_COUNTRIES else 1.0


def _parse_width(value) -> float | None:
    """Parse an OSM width: number, ``a;b``, or feet-inches like ``8'3"``."""
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None

    value = value.strip()

    if ";" in value:
        parsed = [_parse_width(part) for part in value.split(";")]
        parsed = [p for p in parsed if p is not None]
        return max(parsed) if parsed else None

    match = re.match(r"(\d+)'\s*(\d+)?", value)
    if match:
        feet = int(match.group(1))
        inches = int(match.group(2)) if match.group(2) else 0
        return feet + inches / 12

    try:
        return float(value)
    except ValueError:
        return None


def _road_width_m(row, local_factor: float) -> float:
    width = row.get("width", None)
    if pd.notna(width):
        parsed = _parse_width(width)
        if parsed is not None:
            return parsed * local_factor

    lanes = row.get("lanes", None)
    if pd.notna(lanes):
        try:
            return float(str(lanes).split(";")[0]) * LANE_WIDTH_M
        except (ValueError, TypeError):
            pass

    highway = row.get("highway", None)
    if highway in WIDTH_BY_TYPE:
        return float(WIDTH_BY_TYPE[highway])

    return DEFAULT_WIDTH_M * local_factor


def _road_layer(row) -> int:
    layer = row.get("layer", 0)
    if pd.isna(layer):
        return 0
    if isinstance(layer, str):
        try:
            return int(layer)
        except ValueError:
            return 0
    try:
        return int(layer)
    except (TypeError, ValueError):
        return 0


def _merge_polygons(geoms: list) -> shapely.geometry.base.BaseGeometry:
    merged = shapely.union_all(geoms)
    if isinstance(merged, shapely.geometry.GeometryCollection):
        merged = shapely.union_all(list(merged.geoms))
    if isinstance(merged, (shapely.geometry.Polygon, shapely.geometry.MultiPolygon)):
        return merged
    if isinstance(merged, shapely.geometry.base.BaseGeometry) and merged.is_empty:
        return shapely.geometry.Polygon()
    return shapely.geometry.MultiPolygon(
        [g for g in getattr(merged, "geoms", []) if not g.is_empty]
    )


def filter_roads(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts:
    if "highway" not in gdf.columns:
        print("No 'highway' column found in gdf")
        return LayerParts()

    gdf = gdf[gdf["highway"].notna()]
    if "footway" in gdf.columns:
        gdf = gdf[~gdf["footway"].isin(["crossing", "sidewalk"])]

    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)
    if gdf.empty:
        return LayerParts()

    local_factor = _local_units_factor(params)
    # Card mm per ground metre, so a 6 m street has a real-world-consistent width.
    scale_ratio = 1 / (int(params["scale"].split(":")[1]) / 1000) * BUFFER_FUDGE

    buffered: list = []
    by_layer: dict[int, list] = defaultdict(list)
    endpoints_by_layer: dict[int, list] = defaultdict(list)

    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom.geom_type in ("LineString", "MultiLineString"):
            width = _road_width_m(row, local_factor) * scale_ratio
            layer = _road_layer(row)
            parts = geom.geoms if geom.geom_type == "MultiLineString" else [geom]
            for part in parts:
                piece = part.buffer(width)
                buffered.append(piece)
                if layer >= 1:
                    by_layer[layer].append(piece)
                    endpoints_by_layer[layer].append(
                        shapely.Point(part.coords[0]).buffer(width)
                    )
                    endpoints_by_layer[layer].append(
                        shapely.Point(part.coords[-1]).buffer(width)
                    )
        elif geom.geom_type in ("Polygon", "MultiPolygon"):
            # Pedestrian squares etc. are already areas.
            buffered.append(geom)

    if not buffered:
        return LayerParts()

    mask = as_gdf(_merge_polygons(buffered), gdf.crs)
    outlines = mask.copy().dissolve(by=None, aggfunc="first")

    # Walk the bridge layers from lowest to highest and cut each by the ones above.
    layer_ids = sorted(k for k in by_layer if k >= 1)
    merged_layers = [_merge_polygons(by_layer[k]) for k in layer_ids]
    merged_endpoints = [_merge_polygons(endpoints_by_layer[k]) for k in layer_ids]
    for i in range(len(merged_layers)):
        for n in range(i + 1, len(merged_layers)):
            merged_layers[i] = merged_layers[i].difference(merged_layers[n])

    details: list = []
    for i, layer_geom in enumerate(merged_layers):
        seams = shapely.union_all(geometry_to_linestrings(layer_geom))
        caps = merged_endpoints[i].buffer(0.005)
        seams = seams.difference(caps)
        details.extend(geometry_to_linestrings(seams))

    details_gdf = as_gdf(details, gdf.crs)
    if not details_gdf.empty:
        details_gdf = gdf_to_all_linestrings(details_gdf).dissolve(
            by=None, aggfunc="first"
        )

    return LayerParts(
        outlines=gdf_polygons_to_lines(outlines),
        details=details_gdf,
        mask=mask,
    )
