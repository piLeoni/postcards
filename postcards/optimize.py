#!/usr/bin/env python3
"""Optimize a multilayer postcard SVG for the plotter.

Each SVG layer gets the vpype pipeline declared for it in the plot config's
``[layers.<name>]`` sections (see configs/fluidnc.toml). Layer ids are resolved
from the SVG itself, so the pipelines apply to whatever the composer emitted.

Layers with no config section are passed through untouched.

Usage:
    python -m postcards optimize map.svg opt --config configs/fluidnc.toml
    # writes opt.svg
"""

from __future__ import annotations

import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from postcards.utils.plot_config import (
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


def restore_layer_names(svg_path: Path, names: dict[str, int]) -> int:
    """Rename vpype's ``layerN`` groups back to the original layer ids.

    vpype reads the ``<g id>`` names but writes ``<g id="layerN">``, so the
    mapping established on read is reapplied here on the way out. ``names`` maps
    layer id to vpype layer number, exactly as :func:`layer_ids` returned it.

    Inkscape's layer panel shows the ``inkscape:label`` attribute rather than the
    id, so that is updated too — otherwise every layer still reads as a bare
    number in the editor.

    Returns the number of groups renamed.
    """
    by_number = {number: name for name, number in names.items()}
    tree = ET.parse(svg_path)
    root = tree.getroot()
    renamed = 0
    for elem in root.iter():
        if not (elem.tag.endswith("g") and "id" in elem.attrib):
            continue
        match = re.fullmatch(r"layer(\d+)", elem.attrib["id"])
        if not (match and int(match.group(1)) in by_number):
            continue
        name = by_number[int(match.group(1))]
        elem.attrib["id"] = name
        for key in list(elem.attrib):
            if key.endswith("label"):
                elem.attrib[key] = name
        renamed += 1
    if renamed:
        tree.write(svg_path, encoding="utf-8", xml_declaration=True)
    return renamed


def run_optimize(svg_path: Path, output: Path, config_path: Path) -> Path:
    """Run the configured vpype pipeline and write ``<output>.svg``.

    Returns the path written.
    """
    cfg = load_plot_config(config_path)
    defaults = optimize_section(cfg)
    pipelines = layers_section(cfg)
    if not pipelines:
        raise SystemExit(f"no [layers.*] pipelines defined in {config_path}")

    names = layer_ids(str(svg_path))
    vp_args = build_vpype_args(str(svg_path), str(output), cfg["_path"], pipelines, defaults)
    subprocess.run(vp_args, check=True)
    result = Path(f"{output}.svg")

    renamed = restore_layer_names(result, names)
    if renamed:
        print(f"restored {renamed} layer name(s): {', '.join(sorted(names))}")
    print(f"saved {result}")
    return result
