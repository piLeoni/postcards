"""Roads: outlines, bridge seams, and a carriageway mask.

Roads are modelled as the area the carriageway covers. Each way is buffered by
**half** its ground width (Shapely's buffer is a radius), so a ``width=6`` street
is six metres across on the ground and the drawn edges land on the kerbs.

Widths come from OSM in priority order:

1. ``width`` (metres by default; explicit units / feet-inches honoured)
2. ``width:lanes`` summed across lanes
3. ``lanes`` × a lane width
4. a per-``highway`` average

Absurd tags are soft-clamped per highway class. Hierarchy else reads through
those widths — cutting lower classes out of the mask is a no-op once the pieces
are re-unioned, and drawing the cut edges as details turns an interchange into
a tiled wireframe.

Vertical structure:

- underground / negative ``layer`` / ``location=underground`` are dropped
- ``bridge=*`` lifts to at least layer 1 (even when ``layer=0`` was tagged)
- ``tunnel=yes`` (not ``building_passage``) is treated as underground
- positive layers are stacked: higher cuts lower; *internal* seams (edges that
  are not the outer mask outline) become ``details``
"""

from __future__ import annotations

import re
from collections import defaultdict

import geopandas as gpd
import pandas as pd
import shapely
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon
from shapely.ops import linemerge, substring

from postcards.utils.gdf_ops import (
    gdf_polygons_to_lines,
    gdf_remove_below_ground,
    gdf_remove_points,
    gdf_to_all_linestrings,
)
from postcards.utils.geometry import geometry_to_linestrings
from postcards.utils.layers import LayerParts, as_gdf

# Typical carriageway width in metres when OSM carries no better signal.
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

# Soft upper bounds — bad tags like ``width=200`` on a residential happen.
MAX_WIDTH_BY_TYPE = {
    "motorway": 50,
    "motorway_link": 25,
    "trunk": 40,
    "trunk_link": 20,
    "primary": 30,
    "primary_link": 18,
    "secondary": 24,
    "secondary_link": 15,
    "tertiary": 20,
    "tertiary_link": 12,
    "residential": 15,
    "living_street": 12,
    "service": 12,
    "pedestrian": 20,
    "footway": 6,
    "cycleway": 6,
    "path": 6,
    "unclassified": 15,
}
DEFAULT_MAX_WIDTH_M = 40.0

DEFAULT_WIDTH_M = 6.0
LANE_WIDTH_M = 3.0
BUFFER_FUDGE = 1.25
# After buffering, close gaps smaller than this on the ground. Flat caps at
# way joints / width changes leave triangular wedges; ~1.5 m fills them
# without gluing dual carriageways that sit a few metres apart.
JOINT_CLOSE_M = 2.5
# Snap endpoints to this grid (mm on card) when detecting shared nodes.
NODE_SNAP_MM = 0.05
# Dashed centre-line on wide carriageways (reads as a lane divider).
CENTERLINE_MIN_WIDTH_M = 6.0
CENTERLINE_DASH_MM = 0.3
CENTERLINE_GAP_MM = 0.35

_UNIT_TO_METRES = {
    "m": 1.0,
    "metre": 1.0,
    "metres": 1.0,
    "meter": 1.0,
    "meters": 1.0,
    "km": 1000.0,
    "ft": 0.3048,
    "feet": 0.3048,
    "foot": 0.3048,
    "'": 0.3048,
    "in": 0.0254,
    "inch": 0.0254,
    "inches": 0.0254,
}


def _parse_width_m(value) -> float | None:
    """Parse an OSM ``width`` value into metres.

    Per https://wiki.openstreetmap.org/wiki/Key:width the default unit is the
    metre. Feet-inches and explicit suffixes are converted; a bare number is
    always metres.
    """
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None

    value = value.strip()
    if not value:
        return None

    if ";" in value and "|" not in value:
        parsed = [_parse_width_m(part) for part in value.split(";")]
        parsed = [p for p in parsed if p is not None]
        return max(parsed) if parsed else None

    match = re.match(r"""^(\d+)\s*'\s*(?:(\d+)\s*")?$""", value)
    if match:
        feet = int(match.group(1))
        inches = int(match.group(2)) if match.group(2) else 0
        return (feet + inches / 12) * 0.3048

    match = re.match(r"""^([\d.]+)\s*([A-Za-z'"]+)?$""", value)
    if not match:
        return None
    number = float(match.group(1))
    unit = (match.group(2) or "m").lower().strip()
    factor = _UNIT_TO_METRES.get(unit)
    if factor is None:
        return None
    return number * factor


def _width_lanes_m(value) -> float | None:
    """Sum ``width:lanes=3.5|3.5|3.5`` (or semicolon) into a total width."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    if not text:
        return None
    parts = re.split(r"[|;]", text)
    widths = [_parse_width_m(part) for part in parts]
    widths = [w for w in widths if w is not None and w > 0]
    return sum(widths) if widths else None


def _clamp_width(width_m: float, highway) -> float:
    cap = MAX_WIDTH_BY_TYPE.get(highway, DEFAULT_MAX_WIDTH_M)
    return min(max(width_m, 0.5), cap)


def _road_width_m(row) -> float:
    """Carriageway width in metres for one OSM way."""
    highway = row.get("highway", None)

    width = row.get("width", None)
    if pd.notna(width):
        parsed = _parse_width_m(width)
        if parsed is not None and parsed > 0:
            return _clamp_width(parsed, highway)

    for key in ("width:lanes", "width:lanes:forward", "width:lanes:backward"):
        present = key in row.index if hasattr(row, "index") else key in row
        if not present:
            continue
        summed = _width_lanes_m(row.get(key))
        if summed is not None and summed > 0:
            return _clamp_width(summed, highway)

    lanes = row.get("lanes", None)
    if pd.notna(lanes):
        try:
            raw = str(lanes).replace("|", ";").split(";")[0]
            return _clamp_width(float(raw) * LANE_WIDTH_M, highway)
        except (ValueError, TypeError):
            pass

    if highway in WIDTH_BY_TYPE:
        return float(WIDTH_BY_TYPE[highway])
    return DEFAULT_WIDTH_M


def _tag_truthy(value) -> bool:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return False
    text = str(value).strip().lower()
    return text not in ("", "no", "false", "0")


def _road_layer(row) -> int:
    """Relative stacking index for one way.

    ``layer`` is the primary signal. ``bridge=*`` lifts to at least 1 even when
    ``layer=0`` was tagged (common mapper error). ``tunnel=yes`` (not
    ``building_passage``) pushes underground. ``level`` is deliberately
    ignored — indoor semantics, noisy in cities.
    """
    explicit = None
    layer = row.get("layer", None)
    if pd.notna(layer) and str(layer).strip() != "":
        try:
            explicit = int(float(str(layer).split(";")[0]))
        except (TypeError, ValueError):
            explicit = None

    tunnel = row.get("tunnel", None)
    if pd.notna(tunnel):
        text = str(tunnel).strip().lower()
        if text not in ("", "no", "false", "0", "building_passage"):
            if explicit is not None and explicit < 0:
                return explicit
            return -1

    bridge = _tag_truthy(row.get("bridge", None))
    if explicit is not None:
        if bridge and explicit == 0:
            return 1
        return explicit
    if bridge:
        return 1
    return 0


def _merge_polygons(geoms: list) -> shapely.geometry.base.BaseGeometry:
    if not geoms:
        return Polygon()
    merged = shapely.union_all(geoms)
    if isinstance(merged, shapely.GeometryCollection):
        polys = [
            g
            for g in merged.geoms
            if isinstance(g, (Polygon, MultiPolygon))
        ]
        merged = shapely.union_all(polys) if polys else Polygon()
    if isinstance(merged, (Polygon, MultiPolygon)):
        return merged
    return Polygon()


def _internal_seams(
    piece: shapely.geometry.base.BaseGeometry,
    outer: shapely.geometry.base.BaseGeometry,
) -> list[LineString]:
    """Boundary of ``piece`` that is not the outer mask outline."""
    if piece is None or piece.is_empty:
        return []
    boundary = piece.boundary
    if boundary is None or boundary.is_empty:
        return []
    if outer is not None and not outer.is_empty:
        # A hair of buffer so shared outer edges disappear cleanly.
        boundary = boundary.difference(outer.buffer(0.02))
    return [
        line
        for line in geometry_to_linestrings(boundary)
        if line.length > 0.05
    ]


def _dashed_centerline(
    line: LineString, dash_mm: float, gap_mm: float
) -> list[LineString]:
    """Break ``line`` into dash/gap strokes for a lane-divider look."""
    if line is None or line.is_empty or line.length < dash_mm * 0.5:
        return []
    out: list[LineString] = []
    t = 0.0
    period = dash_mm + gap_mm
    while t < line.length - 1e-9:
        a = t
        b = min(t + dash_mm, line.length)
        if b - a > 0.05:
            piece = substring(line, a, b)
            if piece is not None and not piece.is_empty and piece.length > 0.05:
                out.append(piece)
        t += period
    return out


def filter_roads(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts:
    if "highway" not in gdf.columns:
        print("No 'highway' column found in gdf")
        return LayerParts()

    gdf = gdf[gdf["highway"].notna()].copy()
    if "footway" in gdf.columns:
        gdf = gdf[~gdf["footway"].isin(["crossing", "sidewalk"])]

    gdf = gdf_remove_points(gdf)
    # Resolve stacking for every row (bridge lifts layer=0; tunnels go negative).
    gdf["layer"] = gdf.apply(_road_layer, axis=1)
    gdf = gdf[gdf["layer"] >= 0]
    gdf = gdf_remove_below_ground(gdf)
    if gdf.empty:
        return LayerParts()

    scale_ratio = 1 / (int(params["scale"].split(":")[1]) / 1000) * BUFFER_FUDGE

    gdf = gdf.copy()
    gdf["_width_m"] = gdf.apply(_road_width_m, axis=1)
    gdf["_radius_mm"] = (gdf["_width_m"] / 2.0) * scale_ratio

    by_layer: dict[int, list] = defaultdict(list)
    endpoints_by_layer: dict[int, list] = defaultdict(list)
    buffered: list = []
    details: list = []
    # Continuous centre-lines keyed by stacking layer; dashed after higher
    # decks have cut them so an overpass interrupts the ink underneath.
    centerlines_by_layer: dict[int, list[LineString]] = defaultdict(list)
    # OSM splits long roads into many short ways. Buffering each with flat caps
    # leaves triangular wedges on the outside of every bend. Merge connected
    # centre-lines that share layer + radius first; round joins then fill the
    # turn, while true dead-ends keep a flat butt.
    lines_by_key: dict[tuple[int, float], list[LineString]] = defaultdict(list)
    # Shared nodes across *different* radii (lane-count change, link→motorway)
    # still need a filler: a disk of the larger radius at the joint.
    node_radii: dict[tuple[int, float, float], list[float]] = defaultdict(list)

    def _node_key(layer: int, coord) -> tuple[int, float, float]:
        x = round(coord[0] / NODE_SNAP_MM) * NODE_SNAP_MM
        y = round(coord[1] / NODE_SNAP_MM) * NODE_SNAP_MM
        return (layer, x, y)

    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        if geom.geom_type in ("LineString", "MultiLineString"):
            radius_mm = float(row["_radius_mm"])
            layer = int(row["layer"])
            parts = geom.geoms if geom.geom_type == "MultiLineString" else [geom]
            for part in parts:
                if part.is_empty or part.length == 0:
                    continue
                lines_by_key[(layer, round(radius_mm, 4))].append(part)
                node_radii[_node_key(layer, part.coords[0])].append(radius_mm)
                node_radii[_node_key(layer, part.coords[-1])].append(radius_mm)
        elif geom.geom_type in ("Polygon", "MultiPolygon"):
            buffered.append(geom)

    for (layer, radius_mm), lines in lines_by_key.items():
        merged = linemerge(lines)
        pieces = (
            list(merged.geoms)
            if isinstance(merged, MultiLineString)
            else [merged]
        )
        # radius_mm = (width_m / 2) * scale_ratio
        width_m = (2.0 * radius_mm) / scale_ratio if scale_ratio else 0.0
        for part in pieces:
            if part is None or part.is_empty or part.length == 0:
                continue
            piece = part.buffer(radius_mm, cap_style="flat", join_style="round")
            buffered.append(piece)
            if width_m >= CENTERLINE_MIN_WIDTH_M:
                centerlines_by_layer[layer].append(part)
            if layer >= 1:
                by_layer[layer].append(piece)
                endpoints_by_layer[layer].append(
                    Point(part.coords[0]).buffer(radius_mm)
                )
                endpoints_by_layer[layer].append(
                    Point(part.coords[-1]).buffer(radius_mm)
                )

    for (layer, x, y), radii in node_radii.items():
        if len(radii) < 2:
            continue
        disk = Point(x, y).buffer(max(radii))
        buffered.append(disk)
        if layer >= 1:
            by_layer[layer].append(disk)

    if not buffered:
        return LayerParts()

    mask_geom = _merge_polygons(buffered)
    if mask_geom.is_empty:
        return LayerParts()

    # Swallow residual flat-cap wedges (and hairline slivers at width changes).
    close_mm = JOINT_CLOSE_M * scale_ratio
    if close_mm > 0:
        mask_geom = mask_geom.buffer(close_mm).buffer(-close_mm)
        if mask_geom.is_empty:
            return LayerParts()
        for layer in list(by_layer):
            merged = _merge_polygons(by_layer[layer])
            if merged.is_empty:
                by_layer[layer] = []
            else:
                by_layer[layer] = [merged.buffer(close_mm).buffer(-close_mm)]

    mask = as_gdf(mask_geom, gdf.crs)
    outlines = mask.copy().dissolve(by=None, aggfunc="first")
    outer = mask_geom.boundary

    # Higher decks erase centre-lines underneath, then dash what remains.
    elevated_ids = sorted(by_layer)
    elevated_union = _merge_polygons(
        [g for k in elevated_ids for g in by_layer[k]]
    )
    above = Polygon()
    higher_deck: dict[int, shapely.geometry.base.BaseGeometry] = {}
    for layer in reversed(elevated_ids):
        higher_deck[layer] = above
        deck = _merge_polygons(by_layer[layer])
        if not deck.is_empty:
            above = _merge_polygons([above, deck])

    for layer, lines in centerlines_by_layer.items():
        if layer <= 0:
            cutter = elevated_union
        else:
            cutter = higher_deck.get(layer, Polygon())
        for line in lines:
            remnant = (
                line.difference(cutter)
                if cutter is not None and not cutter.is_empty
                else line
            )
            for piece in geometry_to_linestrings(remnant):
                details.extend(
                    _dashed_centerline(
                        piece, CENTERLINE_DASH_MM, CENTERLINE_GAP_MM
                    )
                )

    # Bridge seams: positive layers cut by everything above them; only edges
    # that are *not* the outer silhouette become detail strokes. Emitting the
    # full deck boundary redraws every elevated way on top of the outline and
    # turns a stack interchange into a wireframe.
    layer_ids = sorted(k for k in by_layer if k >= 1)
    merged_layers = [_merge_polygons(by_layer[k]) for k in layer_ids]
    merged_endpoints = [_merge_polygons(endpoints_by_layer[k]) for k in layer_ids]
    for i in range(len(merged_layers)):
        for n in range(i + 1, len(merged_layers)):
            merged_layers[i] = merged_layers[i].difference(merged_layers[n])
    for i, layer_geom in enumerate(merged_layers):
        if layer_geom.is_empty:
            continue
        seams = _internal_seams(layer_geom, outer)
        if merged_endpoints[i] and not merged_endpoints[i].is_empty:
            cap = merged_endpoints[i].buffer(0.005)
            cleaned: list[LineString] = []
            for line in seams:
                remnant = line.difference(cap)
                cleaned.extend(
                    s for s in geometry_to_linestrings(remnant) if s.length > 0.05
                )
            seams = cleaned
        details.extend(seams)

    details_gdf = as_gdf(details, gdf.crs)
    if not details_gdf.empty:
        # Keep dashes as separate strokes — dissolve would fuse colinear
        # centre-line segments across the gaps and erase the lane divider.
        details_gdf = gdf_to_all_linestrings(details_gdf)

    return LayerParts(
        outlines=gdf_polygons_to_lines(outlines),
        details=details_gdf,
        mask=mask,
    )
