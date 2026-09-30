"""Command line interface for the map builder.

Defaults come from the ``[map]`` section of the plot config, so a profile can
pin a default address, card size and scale; any flag on the command line wins.

The result is a plain ``params`` dict that the rest of the pipeline reads. It is
built by :func:`parse_args` and consumed by ``make_map.py``.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import osmnx as ox
from pint import UnitRegistry

from postcards.utils.generate_bounds import generate_bounds, generate_rectangle_polygon
from postcards.utils.plot_config import DEFAULT_CONFIG, load_plot_config, map_section

ureg = UnitRegistry()
logger = logging.getLogger(__name__)


def configure_logging(verbose: bool = False) -> None:
    """Send pipeline stage logs to stderr at a sensible level."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(message)s",
    )


def parse_dimension(value: str | float) -> float:
    """Parse a dimension with optional units and return it in millimetres."""
    try:
        text = str(value)
        quantity = ureg(text) if any(u in text for u in ("in", "cm", "mm")) else ureg(f"{text} mm")
        return quantity.to("millimeter").magnitude
    except Exception as exc:  # noqa: BLE001 - argparse wants a clear message
        raise argparse.ArgumentTypeError(f"Invalid dimension '{value}': {exc}") from exc


def build_parser(config: Path, defaults: dict) -> argparse.ArgumentParser:
    """The full parser, with defaults already resolved from the config."""
    parser = argparse.ArgumentParser(description="Map postcard generator settings")
    parser.add_argument(
        "--config",
        type=Path,
        default=config,
        help=f"project profile TOML (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument("--lat", type=float, default=defaults.get("lat"), help="Latitude of the map center")
    parser.add_argument("--lng", type=float, default=defaults.get("lng"), help="Longitude of the map center")
    parser.add_argument(
        "--width",
        type=parse_dimension,
        default=parse_dimension(defaults.get("width", "6in")),
        help="Width (e.g. 6in, 152.4). From [map] unless overridden.",
    )
    parser.add_argument(
        "--height",
        type=parse_dimension,
        default=parse_dimension(defaults.get("height", "4in")),
        help="Height (e.g. 4in, 101.6). From [map] unless overridden.",
    )
    parser.add_argument(
        "--scale",
        type=str,
        default=str(defaults.get("scale", "1:10000")),
        help="Map scale (e.g. 1:10000)",
    )
    parser.add_argument(
        "--bearing",
        type=float,
        default=float(defaults.get("bearing", 0)),
        help="Rotation degrees",
    )
    parser.add_argument(
        "--projection",
        type=str,
        choices=("utm", "webmercator"),
        default=str(defaults.get("projection", "utm")),
        help="utm | webmercator",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(defaults.get("output", "postcard.svg")),
        help="Output SVG filename",
    )
    parser.add_argument(
        "--padding",
        type=int,
        default=int(defaults.get("padding_mm", 3)),
        help="Padding around the map in mm ([map].padding_mm)",
    )
    parser.add_argument(
        "--address",
        type=str,
        default=defaults.get("address"),
        help="Street address (CLI overrides [map].address)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug-level logging")
    return parser


def resolve_center(args: argparse.Namespace) -> list[float]:
    """Return ``[lon, lat]``, geocoding the address if one was given.

    Note that ``osmnx.geocode`` returns ``(lat, lon)``, the reverse of what the
    rest of the pipeline expects, so the tuple is flipped here rather than at
    every call site.
    """
    has_address = bool(args.address)
    has_coords = args.lat is not None and args.lng is not None

    if has_address and has_coords:
        logger.info("Using --address (ignoring lat/lng for geocoding)")
    elif not has_address and not has_coords:
        raise ValueError(
            "You must specify either an address or both lat and lng (CLI or [map] in config)."
        )

    if has_address:
        logger.info("Fetching coordinates for address: %s", args.address)
        lat, lon = ox.geocode(args.address)
        return [lon, lat]
    return [args.lng, args.lat]


def parse_args(argv=None) -> dict:
    """Parse CLI arguments into the pipeline's ``params`` dict."""
    # Pre-parse --config so [map] can supply the other defaults.
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    pre_args, _ = pre.parse_known_args(argv)
    config_path = pre_args.config
    defaults = map_section(load_plot_config(config_path))

    parser = build_parser(config_path, defaults)
    args = parser.parse_args(argv)
    configure_logging(args.verbose)

    params = {
        "center_coords": resolve_center(args),
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
