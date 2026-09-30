"""The layer contract: every filter returns complete LayerParts."""

from __future__ import annotations

import warnings

import geopandas as gpd
import pytest
from shapely.geometry import LineString, Polygon

from postcards.utils.filter_registry import FILTERS, build_layers, layer_names
from postcards.utils.layers import LayerParts, as_gdf


def _street_frame() -> gpd.GeoDataFrame:
    """A tiny synthetic map frame with one of each theme."""
    return gpd.GeoDataFrame(
        {
            "highway": ["residential", None, None, None],
            "building": [None, "yes", None, None],
            "leisure": [None, None, "park", None],
            "water": [None, None, None, "lake"],
            "width": ["8", None, None, None],
            "geometry": [
                LineString([(10, 10), (60, 10)]),
                Polygon([(20, 20), (30, 20), (30, 30), (20, 30), (20, 20)]),
                Polygon([(40, 20), (55, 20), (55, 35), (40, 35), (40, 20)]),
                Polygon([(10, 40), (30, 40), (30, 50), (10, 50), (10, 40)]),
            ],
        },
        crs="EPSG:3857",
    )


def test_registry_exposes_every_theme():
    assert layer_names() == ["roads", "buildings", "parks", "water"]
    assert set(FILTERS) == set(layer_names())


def test_every_filter_returns_complete_parts(base_params):
    parts = build_layers(_street_frame(), base_params)

    assert set(parts) == set(layer_names())
    for name, result in parts.items():
        assert isinstance(result, LayerParts), name
        for field in ("outlines", "details", "filling", "mask"):
            value = getattr(result, field)
            assert isinstance(value, gpd.GeoDataFrame), f"{name}.{field}"
            # The contract is "always present", not "maybe present".
            assert value.crs is not None or value.empty, f"{name}.{field} lost its CRS"


def test_filters_survive_a_frame_missing_their_columns(base_params):
    """A frame without any OSM tags must yield empty parts, not a crash."""
    empty = gpd.GeoDataFrame(geometry=[], crs="EPSG:3857")
    parts = build_layers(empty, base_params)

    for name, result in parts.items():
        assert result.is_empty, name


def test_layer_parts_has_no_lambdas():
    """Regression guard: the old API wrapped geometries in `lambda: {...}`."""
    parts = LayerParts(outlines=as_gdf([LineString([(0, 0), (1, 1)])]))
    assert isinstance(parts.outlines, gpd.GeoDataFrame)
    assert not callable(parts.outlines)


def test_crs_is_reported_from_any_populated_field():
    parts = LayerParts(
        outlines=gpd.GeoDataFrame(geometry=[], crs=None),
        mask=as_gdf([Polygon([(0, 0), (1, 0), (1, 1), (0, 0)])], "EPSG:3857"),
    )
    assert parts.crs is not None
    assert parts.crs.to_epsg() == 3857


def test_as_gdf_drops_empty_geometries():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        frame = as_gdf([LineString([(0, 0), (1, 1)]), Polygon(), None])
    assert len(frame) == 1
    assert not frame.geometry.is_empty.any()
