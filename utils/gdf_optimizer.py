"""Path ordering for pen plotting.

Three strategies, from cheapest to best:

:func:`tsp_order`
    Treats each geometry's start point as a node and solves a TSP. Fast and
    good for many small marks (dots, dashes).
:func:`merge_consecutive_paths_by_distance`
    Joins runs of consecutive paths whose endpoints are already close. Cheap,
    but only merges what is already adjacent in the current order.
:func:`merge_paths_by_distance`
    Greedy endpoint merge over the whole set, regardless of current order.

The production pipeline normally lets ``vpype linesort`` do this instead; these
exist for previews and for cases where vpype is not in the loop.
"""

from __future__ import annotations

import warnings

import geopandas as gpd
import numpy as np
import shapely
from scipy.spatial import distance_matrix
from shapely.geometry import LineString, Point

import fast_tsp

# Distances are scaled to integers before handing them to fast_tsp, which wants
# integer costs. 1000 keeps sub-millimetre differences meaningful.
_TSP_SCALE = 1000


def extract_geometries(item) -> list:
    """Pull a flat list of Shapely geometries out of almost anything.

    Accepts a GeoDataFrame, GeoSeries, list/nested list of geometries, a GeoJSON
    Feature or FeatureCollection, or a bare geometry.
    """
    if hasattr(item, "geometry") and hasattr(item.geometry, "__iter__"):
        return list(item.geometry)
    if hasattr(item, "geom_type") and not hasattr(item, "__iter__"):
        return [item]
    if isinstance(item, list):
        geoms = []
        for sub in item:
            geoms.extend(extract_geometries(sub))
        return geoms
    if isinstance(item, dict) and item.get("type") == "FeatureCollection":
        from shapely.geometry import shape

        return [shape(f["geometry"]) for f in item["features"]]
    if isinstance(item, dict) and item.get("type") == "Feature":
        from shapely.geometry import shape

        return [shape(item["geometry"])]
    if hasattr(item, "geom_type"):
        return [item]
    return []


def endpoints(geom) -> tuple:
    """Start and end points of a geometry. Polygons are closed, so both match."""
    if isinstance(geom, LineString):
        if len(geom.coords) < 2:
            warnings.warn("LineString with fewer than 2 coords treated as a point")
            return geom.coords[0], geom.coords[0]
        return geom.coords[0], geom.coords[-1]
    if isinstance(geom, shapely.Polygon):
        if geom.exterior is None or len(geom.exterior.coords) == 0:
            warnings.warn("Polygon with no exterior, skipping")
            return None, None
        return geom.exterior.coords[0], geom.exterior.coords[0]
    warnings.warn(f"Unsupported geometry type: {type(geom)}, skipping")
    return None, None


def reverse_geom(geom):
    """Reverse a LineString; anything else is returned unchanged."""
    if isinstance(geom, LineString) and len(geom.coords) >= 2:
        return LineString(list(geom.coords)[::-1])
    return geom


def _distance_sq(p1, p2) -> float:
    """Squared distance, since only comparisons matter — no sqrt needed."""
    if p1 is None or p2 is None:
        return float("inf")
    dx, dy = p1[0] - p2[0], p1[1] - p2[1]
    return dx * dx + dy * dy


def gdf_optimize_paths(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Reorder paths by nearest neighbour, reversing lines when that is closer.

    Polygons keep their orientation because their start and end coincide.
    """
    if not isinstance(gdf, gpd.GeoDataFrame) or gdf.empty:
        return gpd.GeoDataFrame(geometry=[], crs=getattr(gdf, "crs", None))

    geometries, starts, ends, types, extra = [], [], [], [], []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        start, end = endpoints(geom)
        if start is None:
            continue
        geometries.append(geom)
        starts.append(start)
        ends.append(end)
        types.append(type(geom))
        extra.append(row.drop("geometry").to_dict())

    if not geometries:
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    if len(geometries) == 1:
        extra[0]["geometry"] = geometries[0]
        return gpd.GeoDataFrame([extra[0]], crs=gdf.crs)

    unvisited = np.ones(len(geometries), dtype=bool)
    order: list[tuple[int, bool]] = [(0, False)]
    unvisited[0] = False
    position = ends[0]

    while unvisited.any():
        best_dist = float("inf")
        best_idx, best_reverse = -1, False
        for idx in np.where(unvisited)[0]:
            to_start = _distance_sq(position, starts[idx])
            if to_start < best_dist:
                best_dist, best_idx, best_reverse = to_start, idx, False
            # Only lines can be drawn backwards and still end somewhere useful.
            if types[idx] is LineString:
                to_end = _distance_sq(position, ends[idx])
                if to_end < best_dist:
                    best_dist, best_idx, best_reverse = to_end, idx, True

        order.append((best_idx, best_reverse))
        unvisited[best_idx] = False
        position = starts[best_idx] if best_reverse else ends[best_idx]

    rows = []
    for idx, reversed_flag in order:
        data = extra[idx].copy()
        data["geometry"] = reverse_geom(geometries[idx]) if reversed_flag else geometries[idx]
        rows.append(data)
    return gpd.GeoDataFrame(rows, crs=gdf.crs)


def merge_consecutive_paths_by_distance(
    gdf: gpd.GeoDataFrame, distance_threshold: float
) -> gpd.GeoDataFrame:
    """Join runs of adjacent paths whose gap is within ``distance_threshold``."""
    output: list = []
    partial: list[LineString] = []

    def flush():
        nonlocal partial
        if partial:
            output.append(LineString([pt for line in partial for pt in line.coords]))
            partial = []

    for i in range(len(gdf)):
        geom = gdf.iloc[i].geometry
        if isinstance(geom, LineString):
            if partial and _distance_sq(geom.coords[0], partial[-1].coords[-1]) > distance_threshold:
                flush()
            partial.append(geom)
        else:
            flush()
            output.append(geom)

    flush()
    return gpd.GeoDataFrame(geometry=output, crs=gdf.crs)


def merge_paths_by_distance(
    gdf: gpd.GeoDataFrame, tolerance: float
) -> gpd.GeoDataFrame:
    """Greedily merge LineStrings whose endpoints are within ``tolerance``."""
    gdf = gdf.copy()
    ends = []
    for geom in gdf.geometry:
        if isinstance(geom, LineString):
            coords = list(geom.coords)
            ends.append((Point(coords[0]), Point(coords[-1])))
        else:
            ends.append((None, None))

    merged: list = []
    used: set[int] = set()

    for idx, (start, end) in enumerate(ends):
        if idx in used or start is None:
            continue
        current = gdf.geometry.iloc[idx]
        changed = True
        while changed:
            changed = False
            for j, other in enumerate(ends):
                if j in used or j == idx or other[0] is None:
                    continue
                candidates = [
                    (start.distance(other[0]), "start", "start"),
                    (start.distance(other[1]), "start", "end"),
                    (end.distance(other[0]), "end", "start"),
                    (end.distance(other[1]), "end", "end"),
                ]
                min_dist, this_side, other_side = min(candidates, key=lambda c: c[0])
                if min_dist > tolerance:
                    continue

                other_coords = list(gdf.geometry.iloc[j].coords)
                if other_side == "end":
                    other_coords = other_coords[::-1]

                coords = list(current.coords)
                new_coords = other_coords + coords if this_side == "start" else coords + other_coords
                current = LineString(new_coords)
                start = Point(current.coords[0])
                end = Point(current.coords[-1])
                used.add(j)
                changed = True
                break
        merged.append(current)
        used.add(idx)

    return gpd.GeoDataFrame(geometry=merged, crs=gdf.crs)


def _start_points(geometries) -> list[tuple[float, float]]:
    """One representative point per geometry, for TSP node construction."""
    coords = []
    for geom in geometries:
        if geom.geom_type == "Point":
            coords.append((geom.x, geom.y))
        elif geom.geom_type == "LineString":
            coords.append((geom.coords[0][0], geom.coords[0][1]))
        elif geom.geom_type == "Polygon":
            coords.append((geom.exterior.coords[0][0], geom.exterior.coords[0][1]))
        else:
            point = geom.representative_point()
            coords.append((point.x, point.y))
    return coords


def solve_tsp_cartesian_indices(points) -> list[int]:
    """Nearest-tour order over ``points`` via fast_tsp."""
    points = np.array(points)
    scaled = (distance_matrix(points, points) * _TSP_SCALE).astype(int)
    return list(fast_tsp.find_tour(scaled.tolist()))


def tsp_order(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Reorder geometries by solving a TSP over their start points."""
    if len(gdf) < 3:
        return gdf
    coords = _start_points(list(gdf.geometry))
    indices = solve_tsp_cartesian_indices(coords)
    return gdf.iloc[indices].reset_index(drop=True)
