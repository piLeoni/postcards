import argparse
from pint import UnitRegistry
from utils.transformer_factory import transformer_factory # ensure that this function is updated to take two parameters
from utils.fetch_osm import fetch_osm

# Set up unit registry
ureg = UnitRegistry()

def parse_dimension(value: str) -> float:
    """Parses a dimension with units and returns value in millimeters."""
    try:
        # Assume mm if no unit is given
        if any(unit in value for unit in ['in', 'cm', 'mm']):
            quantity = ureg(value)
        else:
            quantity = ureg(f"{value} mm")

        return quantity.to("millimeter").magnitude
    except Exception as e:
        raise argparse.ArgumentTypeError(f"Invalid dimension '{value}': {e}")

def parse_args():
    parser = argparse.ArgumentParser(description="Map postcard generator settings")

    parser.add_argument("--lat", type=float, default=40.7860625,
                        help="Latitude of the map center")
    parser.add_argument("--lng", type=float, default=-73.966876,
                        help="Longitude of the map center")
    parser.add_argument("--width", type=parse_dimension, default=parse_dimension("152.4"),
                        help="Width (e.g., 152.4, 6in, 15cm). Defaults to mm if no unit.")
    parser.add_argument("--height", type=parse_dimension, default=parse_dimension("101.6"),
                        help="Height (e.g., 101.6, 4in, 10cm). Defaults to mm if no unit.")
    parser.add_argument("--scale", type=str, default="1:10000",
                        help="Map scale (e.g., 1:10000)")
    parser.add_argument("--projection", type=str, default="utm",
                        help="Projection type (e.g., utm, mercator)")
    parser.add_argument("--output", type=str, default="postcard.svg",
                        help="Output SVG filename")
    parser.add_argument("--padding", type=int, default=3,
                        help="Padding around the map in mm")

    args = parser.parse_args()

    params = {
        "center_coords": [args.lng, args.lat],
        "width_mm": args.width,
        "height_mm": args.height,
        "scale": args.scale,
        "projection": args.projection,
        "output": args.output,
        "padding": args.padding,
    }
    params['geojson_data'] = fetch_osm(params)
    params['trasformer'] = transformer_factory(params)


    return params
