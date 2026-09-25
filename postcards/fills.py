"""``postcards fills``: render each fill algorithm on a shape, and measure it.

Two jobs in one command, because they are always done together:

- write one SVG per algorithm so the fills can be compared by eye
- print the metrics table from ``_report`` so they can be compared by number

The shapes come from :mod:`postcards.utils.fills._fixtures` — the L, the ring,
the corridor and so on that actually break things. A real building footprint
can be pulled out of an existing ``map.svg`` with ``--from-svg``.
"""

from __future__ import annotations

import argparse
import xml.etree.ElementTree as ET
from pathlib import Path

import shapely

from postcards.utils.fills import FILLS, fill
from postcards.utils.fills._fixtures import FIXTURES
from postcards.utils.fills._report import format_report, measure

SVG_NS = "http://www.w3.org/2000/svg"


def _load_from_svg(path: Path) -> shapely.Geometry:
    """Union every polygon in the ``buildings_outlines`` group of a map.svg.

    A quick way to measure against a footprint that actually exists, without
    running the whole pipeline again. The composer nests each geometry as a
    ``<polyline>`` inside a ``<g>``, and writes rings as paths, so both element
    types are read.
    """
    tree = ET.parse(path)
    polygons: list[shapely.Geometry] = []

    for group in tree.iter():
        if not group.tag.endswith("g") or "buildings" not in (group.attrib.get("id") or ""):
            continue
        if "outline" not in (group.attrib.get("id") or ""):
            continue
        for element in group.iter():
            tag = element.tag.split("}")[-1]
            if tag == "polyline" and element.attrib.get("points"):
                polygons.extend(_rings_from_points(element.attrib["points"]))
            elif tag == "path" and element.attrib.get("d"):
                polygons.extend(_rings_from_path(element.attrib["d"]))
            elif tag == "polygon" and element.attrib.get("points"):
                polygons.extend(_rings_from_points(element.attrib["points"]))

    if not polygons:
        raise SystemExit(f"no buildings geometry found in {path}")

    # Projected OSM rings occasionally self-intersect, and `union_all` refuses
    # to work on invalid input. Repairing them here is the same thing
    # `as_region` does for the fills themselves.
    return shapely.union_all([p if p.is_valid else p.buffer(0) for p in polygons])


def _rings_from_points(points: str) -> list[shapely.Geometry]:
    """A closed ring from an SVG ``points`` attribute."""
    pairs = points.replace(",", " ").split()
    coords = [
        (float(pairs[i]), float(pairs[i + 1])) for i in range(0, len(pairs) - 1, 2)
    ]
    if len(coords) < 3:
        return []
    return [shapely.Polygon(coords)]


def _rings_from_path(d: str) -> list[shapely.Geometry]:
    """Rings from an SVG path ``d``, for the M/L/Z subset the composer writes.

    Each ``M ... Z`` run is one ring and must become its own Polygon, because a
    hole is a separate run. Merging them into a single coordinate list would
    produce a self-intersecting mess, so the runs are split on the ``M``
    commands before the numbers are read.
    """
    rings: list[shapely.Geometry] = []
    current: list[tuple[float, float]] = []

    def flush() -> None:
        if len(current) >= 3:
            polygon = shapely.Polygon(current)
            if polygon.is_valid and not polygon.is_empty:
                rings.append(polygon)

    for token in d.replace(",", " ").split():
        if token in ("M", "m"):
            flush()
            current = []
            continue
        if token in ("Z", "z", "L", "l"):
            continue
        try:
            value = float(token)
        except ValueError:
            continue
        # Coordinates come two at a time; accumulate them pairwise.
        if len(current) and len(current[-1]) == 1:
            current[-1] = (current[-1][0], value)
        else:
            current.append((value,))

    flush()
    return rings


def _polygon_to_path(shape) -> str:
    """An SVG path ``d`` for a Polygon or MultiPolygon, holes included.

    Rings alternate direction (exterior clockwise, holes anticlockwise) so the
    default nonzero fill rule leaves the courtyards empty.
    """
    from shapely.geometry import Polygon

    polygons = [shape] if isinstance(shape, Polygon) else list(shape.geoms)
    commands = []
    for polygon in polygons:
        for ring in (polygon.exterior, *polygon.interiors):
            coords = list(ring.coords)
            if not coords:
                continue
            commands.append(f"M {coords[0][0]:.3f} {coords[0][1]:.3f}")
            commands.extend(f"L {x:.3f} {y:.3f}" for x, y in coords[1:])
            commands.append("Z")
    return " ".join(commands)


def _render(shape, lines, algorithm: str, output: Path, padding: float = 5.0) -> None:
    """Write one SVG showing ``lines`` on ``shape`` in a page-sized viewBox."""
    minx, miny, maxx, maxy = shape.bounds
    width = (maxx - minx) + 2 * padding
    height = (maxy - miny) + 2 * padding
    root = ET.Element(
        "svg",
        width=f"{width:.3f}mm",
        height=f"{height:.3f}mm",
        viewBox=f"{minx - padding:.3f} {miny - padding:.3f} {width:.3f} {height:.3f}",
        xmlns=SVG_NS,
    )
    # The region outline is deliberately light so the fill is what stands out.
    # `<path>` needs its geometry as a `d` attribute, so pull it out of the WKT
    # shapely serialises rather than reimplementing ring-to-path conversion.
    ET.SubElement(root, "path", d=_polygon_to_path(shape))
    style = ET.SubElement(root, "style")
    style.text = (
        "path { fill: none; stroke: #bbb; stroke-width: 0.15; }\n"
        "line { stroke: #000; stroke-width: 0.1; }\n"
    )
    group = ET.SubElement(root, "g", id=f"fill_{algorithm}")
    for line in lines:
        coords = list(line.coords)
        for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
            ET.SubElement(
                group,
                "line",
                x1=f"{x1:.3f}",
                y1=f"{y1:.3f}",
                x2=f"{x2:.3f}",
                y2=f"{y2:.3f}",
            )
    ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)


def run_fills(
    shape_name: str = "L",
    algorithms: list[str] | None = None,
    spacing: float = 1.0,
    angle: float = 45.0,
    output_dir: Path | None = None,
    from_svg: Path | None = None,
) -> None:
    """Render and measure every requested algorithm on one shape."""
    if from_svg is not None:
        shape = _load_from_svg(from_svg)
        label = from_svg.stem
    else:
        try:
            shape = FIXTURES[shape_name]
        except KeyError:
            known = ", ".join(FIXTURES)
            raise SystemExit(f"unknown shape {shape_name!r}; known shapes: {known}") from None
        label = shape_name

    names = algorithms or list(FILLS)
    rows = []
    for name in names:
        lines = fill(shape, spacing, algorithm=name, angle=angle)
        rows.append(measure(lines, shape, name))
        if output_dir is not None:
            output_dir.mkdir(parents=True, exist_ok=True)
            _render(shape, lines, name, output_dir / f"{label}_{name}.svg")

    print(f"shape: {label}   spacing: {spacing}mm   angle: {angle}")
    print(format_report(rows))
    if output_dir is not None:
        print(f"saved SVGs to {output_dir}/")


def cmd_fills(args: argparse.Namespace) -> int:
    run_fills(
        shape_name=args.shape,
        algorithms=args.algorithm or None,
        spacing=args.spacing,
        angle=args.angle,
        output_dir=args.output_dir,
        from_svg=args.from_svg,
    )
    return 0


def add_parser(sub) -> None:
    """Register the ``fills`` subcommand on an existing subparser set."""
    parser = sub.add_parser("fills", help="render and measure fill algorithms")
    parser.add_argument("--shape", default="L", help="fixture shape name")
    parser.add_argument(
        "--algorithm",
        action="append",
        help="algorithm to run; repeat for several (default: all)",
    )
    parser.add_argument("--spacing", type=float, default=1.0, help="fill spacing in mm")
    parser.add_argument("--angle", type=float, default=45.0, help="fill angle in degrees")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="write one SVG per algorithm here",
    )
    parser.add_argument(
        "--from-svg",
        type=Path,
        help="use the buildings geometry from an existing map.svg instead of a fixture",
    )
    parser.set_defaults(func=cmd_fills)
