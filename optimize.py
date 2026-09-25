#!/usr/bin/env python3
"""Optimize a multilayer postcard SVG for the plotter.

Each SVG layer gets the vpype pipeline declared for it in the plot config's
``[layers.<name>]`` sections (see configs/fluidnc.toml). Layer ids are resolved
from the SVG itself, so the pipelines apply to whatever the composer emitted.

Layers with no config section are passed through untouched.

Usage:
    python optimize.py map.svg opt --config configs/fluidnc.toml
    # writes opt.svg
"""

from __future__ import annotations

import argparse
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from utils.plot_config import (
    DEFAULT_CONFIG,
    layers_section,
    load_plot_config,
    optimize_section,
)


def layer_ids(svg_file: str) -> dict[str, int]:
    """Map each ``<g id="...">`` in the SVG to its vpype layer number.

    vpype numbers layers in document order starting at 1.
    """
    root = ET.parse(svg_file).getroot()
    ids: dict[str, int] = {}
    index = 1
    for elem in root.iter():
        if elem.tag.endswith("g") and "id" in elem.attrib:
            ids[elem.attrib["id"]] = index
            index += 1
    return ids


def _op_args(op: dict[str, Any], defaults: dict[str, Any], layer: int) -> list[str]:
    """Translate one configured op into vpype CLI arguments."""
    name = str(op["name"]).lower()
    args = [name, "-l", str(layer)]

    if name == "snap":
        args.append(str(op.get("tolerance", defaults.get("snap", "0.05mm"))))
    elif name == "linesimplify":
        args += ["-t", str(op.get("tolerance", defaults.get("simplify", "0.1mm")))]
    elif name == "linemerge":
        args += ["-t", str(op.get("tolerance", defaults.get("linemerge", "0.25mm")))]
    elif name == "filter":
        args += ["-m", str(op.get("tolerance", defaults.get("filter_min", "0.15mm")))]
    elif name == "linesort":
        if op.get("two_opt", defaults.get("linesort_two_opt", True)):
            args.append("-t")
        if op.get("follow", False):
            args.append("-f")
        args += ["-p", str(op.get("passes", defaults.get("linesort_passes", 1000)))]
    else:
        raise ValueError(f"unknown optimize op: {name!r}")

    return args


def build_vpype_args(
    svg_file: str,
    output: str,
    cfg_path: Path,
    pipelines: dict[str, list[dict[str, Any]]],
    defaults: dict[str, Any],
) -> list[str]:
    """Assemble the full vpype command line for one SVG."""
    trim = str(defaults.get("trim", "3mm"))
    penwidth = str(defaults.get("penwidth", "0.1mm"))

    args = ["vpype", "--config", str(cfg_path), "read", svg_file, "trim", trim, trim]

    available = layer_ids(svg_file)
    for name, ops in pipelines.items():
        if name not in available:
            continue
        layer = available[name]
        for op in ops:
            args += _op_args(op, defaults, layer)

    args += ["penwidth", penwidth, "write", "-m", "layer", f"{output}.svg"]
    return args


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg")
    parser.add_argument("output", help="output prefix (writes <output>.svg)")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help=f"plotter profile TOML (default: {DEFAULT_CONFIG})",
    )
    args = parser.parse_args()

    cfg = load_plot_config(args.config)
    defaults = optimize_section(cfg)
    pipelines = layers_section(cfg)
    if not pipelines:
        raise SystemExit(f"no [layers.*] pipelines defined in {args.config}")

    vp_args = build_vpype_args(
        args.svg, args.output, cfg["_path"], pipelines, defaults
    )
    subprocess.run(vp_args, check=True)
    print(f"saved {args.output}.svg")


if __name__ == "__main__":
    main()
