import argparse
from pathlib import Path

from pint import UnitRegistry
import osmnx as ox
from utils.generate_bounds import generate_rectangle_polygon, generate_bounds
from utils.plot_config import DEFAULT_CONFIG, load_plot_config, map_section

ureg = UnitRegistry()


def parse_dimension(value: str) -> float:
    """Parses a dimension with units and returns value in millimeters."""
    try:
        if any(unit in str(value) for unit in ["in", "cm", "mm"]):
            quantity = ureg(str(value))
        else:
            quantity = ureg(f"{value} mm")
        return quantity.to("millimeter").magnitude
    except Exception as e:
        raise argparse.ArgumentTypeError(f"Invalid dimension '{value}': {e}")


def parse_args(argv=None):
    # Pre-parse --config so map defaults come from the profile TOML.
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    pre_args, _ = pre.parse_known_args(argv)
    m = map_section(load_plot_config(pre_args.config))

    parser = argparse.ArgumentParser(description="Map postcard generator settings")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"project profile TOML (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument("--lat", type=float, default=m.get("lat"), help="Latitude of the map center")
    parser.add_argument("--lng", type=float, default=m.get("lng"), help="Longitude of the map center")
    parser.add_argument(
        "--width",
        type=parse_dimension,
        default=parse_dimension(str(m.get("width", "6in"))),
        help="Width (e.g. 6in, 152.4). From [map] unless overridden.",
    )
    parser.add_argument(
        "--height",
        type=parse_dimension,
        default=parse_dimension(str(m.get("height", "4in"))),
        help="Height (e.g. 4in, 101.6). From [map] unless overridden.",
    )
    parser.add_argument(
        "--scale",
        type=str,
        default=str(m.get("scale", "1:10000")),
        help="Map scale (e.g. 1:10000)",
    )
    parser.add_argument(
        "--bearing",
        type=float,
        default=float(m.get("bearing", 0)),
        help="Rotation degrees",
    )
    parser.add_argument(
        "--projection",
        type=str,
        default=str(m.get("projection", "utm")),
        help="utm | mercator",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(m.get("output", "postcard.svg")),
        help="Output SVG filename",
    )
    parser.add_argument(
        "--padding",
        type=int,
        default=int(m.get("padding_mm", 3)),
        help="Padding around the map in mm ([map].padding_mm)",
    )
    parser.add_argument(
        "--address",
        type=str,
        default=m.get("address"),
        help="Street address (CLI overrides [map].address)",
    )

    args = parser.parse_args(argv)

    has_address = bool(args.address)
    has_coords = args.lat is not None and args.lng is not None

    if has_address and has_coords:
        # Address wins when both are present (config may list both as docs).
        print("Using --address (ignoring lat/lng for geocoding)")
    elif not has_address and not has_coords:
        raise ValueError(
            "You must specify either an address or both lat and lng (CLI or [map] in config)."
        )

    if has_address:
        print("Fetching coordinates for address:", args.address)
        center_coords = ox.geocoder.geocode(args.address)[::-1]
    else:
        center_coords = [args.lng, args.lat]

    params = {
        "center_coords": center_coords,
        "width_mm": args.width,
        "height_mm": args.height,
        "scale": args.scale,
        "bearing": args.bearing,
        "projection": args.projection,
        "output": args.output,
        "padding": args.padding,
        "address": args.address,
        "config": args.config,
    }
    params["polygon"] = generate_rectangle_polygon(params)
    params["bounds"] = generate_bounds(params)
    return params
