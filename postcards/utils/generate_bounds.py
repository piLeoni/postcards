"""Turn card dimensions and scale into a geographic query area.

A card of ``width_mm`` at scale ``1:N`` covers ``width_mm / 1000 * N`` metres of
ground. Because the earth is not flat, the corners are found by walking that
distance from the centre along compass bearings, so a wide card at high latitude
still spans the right number of metres on each edge.
"""

from __future__ import annotations

from geopy.distance import geodesic
from shapely.geometry import Polygon


def _ground_size(params: dict) -> tuple[float, float]:
    """Card size in real-world metres."""
    scale_ratio = int(str(params["scale"]).split(":")[1])
    width_m = params["width_mm"] / 1000.0 * scale_ratio
    height_m = params["height_mm"] / 1000.0 * scale_ratio
    return width_m, height_m


def generate_bounds(params: dict) -> dict[str, float]:
    """Lat/lon bounding box of the card area, ignoring bearing."""
    lon, lat = params["center_coords"]
    width_m, height_m = _ground_size(params)
    center = (lat, lon)

    return {
        "north": geodesic(meters=height_m / 2).destination(center, 0).latitude,
        "south": geodesic(meters=height_m / 2).destination(center, 180).latitude,
        "east": geodesic(meters=width_m / 2).destination(center, 90).longitude,
        "west": geodesic(meters=width_m / 2).destination(center, 270).longitude,
    }


def generate_rectangle_polygon(params: dict) -> Polygon:
    """The query polygon of the card, rotated by ``bearing`` if set.

    Built from the centre rather than from two opposite corners so the sides stay
    the requested ground distance apart even when rotated.
    """
    lon, lat = params["center_coords"]
    width_m, height_m = _ground_size(params)
    bearing = params.get("bearing", 0)
    center = (lat, lon)

    north = geodesic(meters=height_m / 2).destination(center, bearing)
    south = geodesic(meters=height_m / 2).destination(center, (bearing + 180) % 360)
    east_bearing = (bearing + 90) % 360
    west_bearing = (bearing + 270) % 360

    ne = geodesic(meters=width_m / 2).destination(north, east_bearing)
    nw = geodesic(meters=width_m / 2).destination(north, west_bearing)
    se = geodesic(meters=width_m / 2).destination(south, east_bearing)
    sw = geodesic(meters=width_m / 2).destination(south, west_bearing)

    return Polygon(
        [
            (ne.longitude, ne.latitude),
            (nw.longitude, nw.latitude),
            (sw.longitude, sw.latitude),
            (se.longitude, se.latitude),
            (ne.longitude, ne.latitude),
        ]
    )
