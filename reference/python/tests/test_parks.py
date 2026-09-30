"""Park theme: per-kind stipple density and a single dashed outer ring."""

from __future__ import annotations

import geopandas as gpd
import shapely

from postcards.utils.filters.parks import (
    DOT_SPACING_MM,
    OUTLINE_DASH_MM,
    filter_parks,
)
from postcards.utils.patterns.dash import dash_geometry, dash_linestring


PARAMS = {"width_mm": 152.4, "height_mm": 101.6}


def test_dash_linestring_alternates_on_and_off():
    line = shapely.LineString([(0, 0), (10, 0)])
    dashes = dash_linestring(line, dash=1.0, gap=1.0)
    assert len(dashes) == 5
    assert all(abs(d.length - 1.0) < 1e-6 for d in dashes)
    # Gaps: each dash starts 2mm after the previous.
    starts = [d.coords[0][0] for d in dashes]
    assert starts == [0.0, 2.0, 4.0, 6.0, 8.0]


def test_dash_geometry_outers_only_via_linestring():
    poly = shapely.box(0, 0, 4, 4)
    dashes = dash_geometry(shapely.LineString(poly.exterior.coords), dash=1.0, gap=1.0)
    assert dashes
    assert all(d.length <= 1.0 + 1e-6 for d in dashes)


def _park_gdf() -> gpd.GeoDataFrame:
    """Two adjacent greens of different kinds sharing an edge."""
    park = shapely.box(0, 0, 10, 10)
    garden = shapely.box(10, 0, 14, 10)  # shares the x=10 edge
    grass = shapely.box(0, 10, 10, 14)
    return gpd.GeoDataFrame(
        {
            "leisure": ["park", "garden", None],
            "landuse": [None, None, "grass"],
            "natural": [None, None, None],
            "geometry": [park, garden, grass],
        },
        crs="EPSG:3857",
    )


def test_filter_parks_uses_kind_spacings_and_one_dashed_outline():
    parts = filter_parks(_park_gdf(), PARAMS)
    assert not parts.filling.empty
    assert not parts.outlines.empty
    assert not parts.mask.empty

    # Mask is the union — one blob, no shared internal edges drawn.
    union = parts.mask_union()
    assert union.area == shapely.box(0, 0, 14, 14).difference(
        shapely.box(10, 10, 14, 14)
    ).area

    # Outline dashes are short; none should span a long solid fence.
    assert all(g.length <= OUTLINE_DASH_MM + 1e-6 for g in parts.outlines.geometry)

    # Shared edge at x=10 between park and garden must not appear as a stroke.
    # Exclude the ring corners so a jog at (10,10) does not false-positive.
    shared_mid = shapely.LineString([(10, 0.5), (10, 9.5)]).buffer(0.15)
    crossing = parts.outlines[parts.outlines.intersects(shared_mid)]
    assert crossing.empty, "internal park/garden fence should be dissolved"

    # Filling is denser overall than a uniform grass-only grid would be —
    # garden cells contribute more marks in their patch.
    garden_box = shapely.box(10, 0, 14, 10)
    grass_box = shapely.box(0, 10, 10, 14)
    garden_marks = parts.filling[parts.filling.intersects(garden_box.buffer(-0.2))]
    grass_marks = parts.filling[parts.filling.intersects(grass_box.buffer(-0.2))]
    garden_density = len(garden_marks) / garden_box.area
    grass_density = len(grass_marks) / grass_box.area
    assert garden_density > grass_density
    assert DOT_SPACING_MM["garden"] < DOT_SPACING_MM["park"] < DOT_SPACING_MM["wood"] < DOT_SPACING_MM["grass"]


def test_filter_parks_fills_osm_holes():
    """OSM interior rings must not leave blank white patches in the stipple."""
    outer = shapely.Polygon(
        [(0, 0), (20, 0), (20, 20), (0, 20)],
        holes=[[(7, 7), (13, 7), (13, 13), (7, 13)]],
    )
    gdf = gpd.GeoDataFrame(
        {
            "leisure": ["park"],
            "landuse": [None],
            "natural": [None],
            "geometry": [outer],
        },
        crs="EPSG:3857",
    )
    parts = filter_parks(gdf, PARAMS)
    hole = shapely.box(8, 8, 12, 12)
    assert not parts.filling[parts.filling.intersects(hole)].empty


def test_filter_parks_fills_union_ring_gaps():
    """Gaps that appear only after dissolving neighbours must still be stippled."""
    # Two C-shapes whose union encloses a hole neither polygon owns as an interior.
    left = shapely.Polygon([(0, 0), (6, 0), (6, 2), (2, 2), (2, 6), (6, 6), (6, 8), (0, 8)])
    right = shapely.Polygon([(4, 0), (10, 0), (10, 8), (4, 8), (4, 6), (8, 6), (8, 2), (4, 2)])
    gdf = gpd.GeoDataFrame(
        {
            "leisure": [None, None],
            "landuse": [None, None],
            "natural": ["wood", "wood"],
            "geometry": [left, right],
        },
        crs="EPSG:3857",
    )
    parts = filter_parks(gdf, PARAMS)
    centre = shapely.box(3.5, 3.5, 6.5, 6.5)
    assert not parts.filling[parts.filling.intersects(centre)].empty


def test_filter_parks_kinds_can_use_different_algorithms(tmp_path, base_params):
    """A kind table can swap the fill algorithm, not only spacing."""
    cfg = tmp_path / "parks.toml"
    cfg.write_text(
        """
[fill.parks]
algorithm = "dots"
mark = "0.2mm"
spacing = "0.5mm"

[fill.parks.kinds.garden]
algorithm = "dots"
spacing = "0.3mm"

[fill.parks.kinds.grass]
algorithm = "rectilinear"
spacing = "1.0mm"
angle = 0

[stroke.parks]
style = "solid"
"""
    )
    params = {**base_params, "config": cfg}
    parts = filter_parks(_park_gdf(), params)
    grass_box = shapely.box(0, 10, 10, 14)
    grass_strokes = parts.filling[parts.filling.intersects(grass_box.buffer(-0.3))]
    # Rectilinear hatch produces long strokes; dots are short marks.
    assert any(g.length > 0.5 for g in grass_strokes.geometry)


def test_filter_parks_ignores_unrelated_features():
    gdf = gpd.GeoDataFrame(
        {
            "leisure": [None, "playground"],
            "landuse": ["residential", None],
            "natural": [None, None],
            "geometry": [shapely.box(0, 0, 1, 1), shapely.box(2, 2, 3, 3)],
        },
        crs="EPSG:3857",
    )
    assert filter_parks(gdf, PARAMS).is_empty
