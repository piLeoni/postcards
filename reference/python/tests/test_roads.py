"""Road width parsing, layer inference, half-width buffering, bridge seams."""

from __future__ import annotations

import geopandas as gpd
import pytest
from shapely.geometry import LineString, Point

from postcards.utils.filters.roads import (
    _parse_width_m,
    _road_layer,
    _road_width_m,
    _width_lanes_m,
    filter_roads,
)


@pytest.mark.parametrize(
    "raw, expected",
    [
        (6, 6.0),
        ("6", 6.0),
        ("2 m", 2.0),
        ("12 ft", 12 * 0.3048),
        ("16'3\"", (16 + 3 / 12) * 0.3048),
        ("16'", 16 * 0.3048),
        ("4;6", 6.0),
        ("nope", None),
    ],
)
def test_parse_width_honours_units_default_metres(raw, expected):
    got = _parse_width_m(raw)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)


def test_width_lanes_sums_pipe_separated_values():
    assert _width_lanes_m("3.5|3.5|3.5") == pytest.approx(10.5)
    assert _width_lanes_m("3;3;3") == pytest.approx(9.0)


def test_width_lanes_preferred_over_lane_count():
    row = {
        "width": None,
        "width:lanes": "3|3|3",
        "lanes": "2",
        "highway": "primary",
    }
    assert _road_width_m(row) == pytest.approx(9.0)


def test_absurd_width_is_clamped_for_residential():
    row = {"width": "200", "lanes": None, "highway": "residential"}
    assert _road_width_m(row) == 15.0  # MAX_WIDTH_BY_TYPE["residential"]


def test_bare_number_is_metres_even_without_country_lookup():
    row = {"width": "10", "lanes": None, "highway": "residential"}
    assert _road_width_m(row) == 10.0


def test_lanes_fallback_and_highway_default():
    assert _road_width_m({"width": None, "lanes": "3", "highway": "primary"}) == 9.0
    assert _road_width_m({"width": None, "lanes": None, "highway": "primary"}) == 7.0


@pytest.mark.parametrize(
    "tags, expected",
    [
        ({}, 0),
        ({"layer": "2"}, 2),
        ({"layer": "-1"}, -1),
        ({"bridge": "yes"}, 1),
        ({"bridge": "yes", "layer": "3"}, 3),
        ({"bridge": "yes", "layer": "0"}, 1),  # mapper error: still a bridge
        ({"tunnel": "yes"}, -1),
        ({"tunnel": "building_passage"}, 0),
        ({"tunnel": "building_passage", "layer": "2"}, 2),
    ],
)
def test_road_layer_from_bridge_tunnel_and_layer(tags, expected):
    assert _road_layer(tags) == expected


def test_filter_roads_buffers_half_width_and_hides_tunnels(base_params):
    params = dict(base_params)
    params["scale"] = "1:1000"
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["residential", "primary", "service"],
            "width": ["10", None, None],
            "lanes": [None, None, None],
            "layer": [None, None, None],
            "bridge": [None, "yes", None],
            "tunnel": [None, None, "yes"],
            "geometry": [
                LineString([(20, 50), (80, 50)]),
                LineString([(50, 20), (50, 80)]),
                LineString([(10, 10), (20, 20)]),
            ],
        },
        crs="EPSG:3857",
    )
    parts = filter_roads(gdf, params)
    assert not parts.outlines.empty
    minx, _, _, _ = parts.mask.total_bounds
    assert minx > 15
    assert not parts.details.empty

    alone = gpd.GeoDataFrame(
        {
            "highway": ["residential"],
            "width": ["10"],
            "geometry": [LineString([(0, 50), (100, 50)])],
        },
        crs="EPSG:3857",
    )
    alone_parts = filter_roads(alone, params)
    _, miny, _, maxy = alone_parts.mask.total_bounds
    assert (maxy - miny) == pytest.approx(12.5, abs=0.2)


def test_bridge_over_ground_road_produces_crossing_seams(base_params):
    """A layer-1 bridge across a ground road must yield detail strokes."""
    params = dict(base_params)
    params["scale"] = "1:1000"
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["residential", "primary"],
            "width": ["8", "10"],
            "layer": [0, 1],
            "bridge": [None, "yes"],
            "geometry": [
                LineString([(0, 50), (100, 50)]),
                LineString([(50, 0), (50, 100)]),
            ],
        },
        crs="EPSG:3857",
    )
    parts = filter_roads(gdf, params)
    assert not parts.details.empty
    # Details should reach near the crossing, not only the map edge.
    detail_union = parts.details.union_all()
    assert Point(50, 50).distance(detail_union) < 8.0


def test_ground_overlap_without_bridge_has_no_bridge_seams(base_params):
    """Same-layer overlaps fuse; bridge seams stay empty (centre-lines may exist)."""
    params = dict(base_params)
    params["scale"] = "1:1000"
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["residential", "residential"],
            "width": ["4", "4"],
            "layer": [0, 0],
            "bridge": [None, None],
            "geometry": [
                LineString([(0, 50), (100, 50)]),
                LineString([(40, 50), (60, 50)]),
            ],
        },
        crs="EPSG:3857",
    )
    parts = filter_roads(gdf, params)
    # Narrow residential: no centre-line, no bridge → no details.
    assert parts.details.empty
    assert not parts.outlines.empty


def test_split_ways_at_a_bend_do_not_leave_outer_wedges(base_params):
    """Flat caps on per-way buffers leave wedges; merged centre-lines must not."""
    import math

    params = dict(base_params)
    params["scale"] = "1:1000"
    pts = [
        (50 + 40 * math.cos(t), 50 + 40 * math.sin(t))
        for t in [i * math.pi / 16 for i in range(9)]
    ]
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["residential"] * (len(pts) - 1),
            "width": ["10"] * (len(pts) - 1),
            "layer": [0] * (len(pts) - 1),
            "geometry": [
                LineString([pts[i], pts[i + 1]]) for i in range(len(pts) - 1)
            ],
        },
        crs="EPSG:3857",
    )
    parts = filter_roads(gdf, params)
    one_piece = LineString(pts).buffer(
        10 / 2 * 1.25, cap_style="flat", join_style="round"
    )
    assert parts.mask.union_all().area == pytest.approx(one_piece.area, rel=0.05)


def test_wide_road_gets_dashed_centerline(base_params):
    """Carriageways wider than the threshold carry a dashed centre-line."""
    params = dict(base_params)
    params["scale"] = "1:1000"
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["motorway"],
            "width": ["15"],
            "layer": [0],
            "geometry": [LineString([(0, 50), (100, 50)])],
        },
        crs="EPSG:3857",
    )
    parts = filter_roads(gdf, params)
    assert not parts.details.empty
    mid = Point(50, 50)
    assert mid.distance(parts.details.union_all()) < 1.0


def test_centerline_stops_under_a_bridge(base_params):
    """An overpass must interrupt the centre-line of the road underneath."""
    params = dict(base_params)
    params["scale"] = "1:1000"
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["primary", "primary"],
            "width": ["12", "5"],
            "layer": [0, 1],
            "bridge": [None, "yes"],
            "geometry": [
                LineString([(0, 50), (100, 50)]),
                LineString([(50, 0), (50, 100)]),
            ],
        },
        crs="EPSG:3857",
    )
    parts = filter_roads(gdf, params)
    details = parts.details.union_all()
    # Crossing centre is under the bridge deck — no centre-line ink there.
    assert Point(50, 50).distance(details) > 3.0
    # Away from the bridge, the ground centre-line is still drawn.
    assert Point(20, 50).distance(details) < 1.0


def test_width_change_at_a_bend_does_not_leave_a_wedge(base_params):
    """Two ways meeting at an angle with different widths must not leave a gap."""
    params = dict(base_params)
    params["scale"] = "1:1000"
    gdf = gpd.GeoDataFrame(
        {
            "highway": ["primary", "primary"],
            "width": ["10", "16"],
            "layer": [0, 0],
            "geometry": [
                LineString([(0, 50), (50, 50)]),
                LineString([(50, 50), (50, 100)]),
            ],
        },
        crs="EPSG:3857",
    )
    mask = filter_roads(gdf, params).mask.union_all()
    outer_corner = Point(50 + 8, 50 + 8)
    assert mask.contains(outer_corner)
