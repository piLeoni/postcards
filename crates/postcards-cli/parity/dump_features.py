"""osmnx's features for a card, one line each: ``element id geom_type area``.

    .venv/bin/python crates/postcards-cli/parity/dump_features.py <lat> <lng>

Reads the shared ``./cache`` (no network if the card was fetched before);
diff against ``cargo run --release --example dump_features``.
"""

from __future__ import annotations

import sys

import osmnx as ox

from postcards.make_map import OSM_TAGS
from postcards.utils.generate_bounds import generate_rectangle_polygon

ox.settings.use_cache = True
ox.settings.log_console = False


def main(lat: float, lng: float) -> None:
    params = {"center_coords": [lng, lat], "width_mm": 152.4, "height_mm": 101.6, "scale": "1:10000", "bearing": 0}
    polygon = generate_rectangle_polygon(params)
    gdf = ox.features_from_polygon(polygon, tags=OSM_TAGS)
    for (element, osm_id), geom in gdf.geometry.items():
        print(f"{element} {osm_id} {geom.geom_type} {geom.area:.12f}")


if __name__ == "__main__":
    main(float(sys.argv[1]), float(sys.argv[2]))
