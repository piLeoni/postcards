#!/usr/bin/env python3
"""Build a postcard map SVG from an address or lat/lng.

Fetches OpenStreetMap features for the card rectangle, projects them to mm on
the page, renders each theme (buildings, roads, parks, water) and writes a
multi-layer SVG. Layers are named so downstream steps can treat them
individually — see docs/pipeline.md.

Usage:
    python make_map.py --address "1730 Highland Pl, Berkeley, CA 94709" --output map.svg
    python make_map.py --lat 37.87 --lng -122.25 --output map.svg
    python make_map.py --config configs/fluidnc.toml --address "..." --output map.svg
"""

from __future__ import annotations

import geopandas as gpd
import osmnx as ox

from utils.cli_parser import parse_args
from utils.composition import compose_layers
from utils.filter_registry import build_layers, layer_names
from utils.projection import project
from utils.svg_tools import SVG_composer
from utils.timer import Timer

ox.settings.timeout = 300  # seconds
ox.settings.use_cache = True
ox.settings.log_console = True
ox.settings.max_query_area_size = 1000 * 1000 * 1000

OSM_TAGS = {
    "building": True,
    "highway": True,
    "railway": True,
    "natural": True,
    "water": True,
    "landuse": True,
    "amenity": True,
    "leisure": True,
    "waterway": True,
}


def fetch_features(params: dict) -> gpd.GeoDataFrame:
    """Fetch OSM features inside the query polygon, or an empty frame."""
    try:
        gdf = ox.features_from_polygon(params["polygon"], tags=OSM_TAGS)
        return gdf
    except ox._errors.InsufficientResponseError:
        print("No data found in this region or request timed out")
        return gpd.GeoDataFrame(
            data=[],
            columns=["geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )


def project_geojson_to_svg(params: dict) -> None:
    """Project OSM features onto a drawn SVG page."""
    timer = Timer()

    gdf = fetch_features(params)
    timer.log("Fetching data")

    gdf = project(gdf, params)
    timer.log("Projecting data")

    parts = build_layers(gdf, params)
    for name, part in parts.items():
        timer.log(f"Generating {name}")

    composer = SVG_composer(params)
    for layer_name, geoms in compose_layers(parts).items():
        composer.add_gdf_to_layer(geoms, layer_name)
    timer.log("Composing layers")

    composer.save_svg(params["output"])
    timer.log("Saving svg")


def main() -> None:
    project_geojson_to_svg(parse_args())
    print(f"layers: {', '.join(layer_names())}")


if __name__ == "__main__":
    main()
