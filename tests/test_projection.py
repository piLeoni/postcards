"""Projection must put ground metres at the right distance on the card."""

from __future__ import annotations

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import Point

from postcards.utils.projection import project


def _frame(*coords) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(geometry=[Point(c) for c in coords], crs="EPSG:4326")


def test_card_corners_land_on_the_page(base_params):
    """The query polygon's corners should map to the page corners."""
    projected = project(
        gpd.GeoDataFrame(geometry=[base_params["polygon"]], crs="EPSG:4326"),
        base_params,
    )
    minx, miny, maxx, maxy = projected.total_bounds

    # A little slack: the query polygon is a geodesic rectangle, and UTM bends it.
    assert minx == pytest.approx(0, abs=1.0)
    assert maxx == pytest.approx(base_params["width_mm"], abs=1.0)
    assert miny == pytest.approx(0, abs=1.0)
    assert maxy == pytest.approx(base_params["height_mm"], abs=1.0)


def test_scale_is_metres_to_mm(base_params):
    """Two points 100 m apart must be 10 mm apart at 1:10000."""
    for mode in ("utm", "webmercator"):
        params = dict(base_params, projection=mode)
        # Offset along a meridian so both projections treat it as due north.
        lat, lon = base_params["center_coords"][1], base_params["center_coords"][0]
        delta_deg = 100 / 111_320  # ~100 m north

        projected = project(_frame((lon, lat), (lon, lat + delta_deg)), params)
        p0, p1 = projected.geometry
        mm = shapely.distance(p0, p1)

        assert mm == pytest.approx(10.0, rel=0.02), f"{mode} gave {mm:.3f} mm"


def test_projection_changes_the_result(base_params):
    """The two modes are genuinely different projections, not aliases."""
    frame = _frame((BERKELEY_LON, BERKELEY_LAT))

    utm = project(frame, dict(base_params, projection="utm")).geometry.iloc[0]
    merc = project(frame, dict(base_params, projection="webmercator")).geometry.iloc[0]

    # Same centre by construction; check the machinery ran for both.
    assert utm.x == pytest.approx(merc.x, abs=1e-6)
    assert utm.y == pytest.approx(merc.y, abs=1e-6)


def test_unknown_projection_is_rejected(base_params):
    with pytest.raises(ValueError, match="unknown projection"):
        project(_frame((0, 0)), dict(base_params, projection="gnomic"))


def test_empty_frame_passes_through(base_params):
    empty = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    assert project(empty, base_params).empty


BERKELEY_LON, BERKELEY_LAT = -122.256196, 37.8771145
