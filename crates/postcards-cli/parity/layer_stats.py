"""Each Python theme before composition: mask area and part lengths.

    .venv/bin/python crates/postcards-cli/parity/layer_stats.py <lat> <lng>

Same numbers as ``cargo run --release --example layer_stats``. Water is run
without ocean tiles, like the Rust example.
"""

from __future__ import annotations

import sys

import osmnx as ox
import shapely

from postcards.make_map import OSM_TAGS
from postcards.utils.filters import water as water_mod
from postcards.utils.filters.buildings import filter_buildings
from postcards.utils.filters.parks import filter_parks
from postcards.utils.filters.roads import filter_roads
from postcards.utils.generate_bounds import generate_rectangle_polygon
from postcards.utils.projection import project

ox.settings.use_cache = True
ox.settings.log_console = False


def _length(gdf) -> float:
    return float(gdf.geometry.length.sum()) if not gdf.empty else 0.0


def main(lat: float, lng: float, config: str = "configs/fluidnc.toml") -> None:
    params = {
        "center_coords": [lng, lat],
        "width_mm": 152.4,
        "height_mm": 101.6,
        "scale": "1:10000",
        "bearing": 0,
        "projection": "utm",
        "config": config,
    }
    params["polygon"] = generate_rectangle_polygon(params)
    gdf = project(ox.features_from_polygon(params["polygon"], tags=OSM_TAGS), params)
    gdf = gdf[gdf["natural"] != "coastline"] if "natural" in gdf.columns else gdf
    themes = (
        ("parks", filter_parks),
        ("water", water_mod.filter_water),
        ("roads", filter_roads),
        ("buildings", filter_buildings),
    )
    for name, fn in themes:
        p = fn(gdf.copy(), params)
        mask = shapely.union_all(list(p.mask.geometry)).area if not p.mask.empty else 0.0
        print(
            f"{name:10} mask {mask:10.3f}  outlines {_length(p.outlines):9.2f}  "
            f"details {_length(p.details):9.2f}  filling {_length(p.filling):9.2f}"
        )


if __name__ == "__main__":
    main(float(sys.argv[1]), float(sys.argv[2]))
