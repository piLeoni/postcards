import argparse
from pint import UnitRegistry
from utils.transformer_factory import transformer_factory # ensure that this function is updated to take two parameters
from utils.fetch_osm import fetch_osm
import osmnx as ox

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

    parser.add_argument("--lat", type=float, help="Latitude of the map center")
    parser.add_argument("--lng", type=float, help="Longitude of the map center")
    parser.add_argument("--width", type=parse_dimension, default=parse_dimension("152.4"),
                        help="Width (e.g., 152.4, 6in, 15cm). Defaults to mm if no unit.")
    parser.add_argument("--height", type=parse_dimension, default=parse_dimension("101.6"),
                        help="Height (e.g., 101.6, 4in, 10cm). Defaults to mm if no unit.")
    parser.add_argument("--scale", type=str, default="1:10000",
                        help="Map scale (e.g., 1:10000)")
    parser.add_argument("--bearing", type=float, default=0,
                        help="Map rotation, in degrees (e.g., 45 for NE)")
    parser.add_argument("--projection", type=str, default="utm",
                        help="Projection type (e.g., utm, mercator)")
    parser.add_argument("--output", type=str, default="postcard.svg",
                        help="Output SVG filename")
    parser.add_argument("--padding", type=int, default=3,
                        help="Padding around the map in mm")
    parser.add_argument("--address", type=str, 
                        help="Street address, es: 500 Folsom Street, SF")

    args = parser.parse_args()
    
    
    if args.address and (args.lat or args.lng):
        raise ValueError("Cannot specify both address and coordinates.")

    if not args.address and (args.lat is None or args.lng is None):
        raise ValueError("You must specify either an address or both lat and lng.")
    
    center_coords = [0, 0]

    if args.address:
        center_coords =  ox.geocoder.geocode(args.address)[::-1]
    
    if (args.lat and args.lng):
        center_coords =  [args.lng, args.lat]


    params = {
        "center_coords": center_coords,
        "width_mm": args.width,
        "height_mm": args.height,
        "scale": args.scale,
        "bearing": args.bearing,
        "projection": args.projection,
        "output": args.output,
        "padding": args.padding,
        "address": args.address
    }
    # params['geojson_data'] = fetch_osm(params)
    params['trasformer'] = transformer_factory(params)


    return params
