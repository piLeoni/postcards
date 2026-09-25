#!/usr/bin/env python3
"""Optimize multilayer postcard SVG using tolerances from a plotter config."""

from __future__ import annotations

import argparse
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

from utils.plot_config import DEFAULT_CONFIG, load_plot_config, optimize_section


def get_id(target_id: str, svg_file: str) -> int | None:
    tree = ET.parse(svg_file)
    root = tree.getroot()
    index = 1
    for elem in root.iter():
        if elem.tag.endswith("g") and "id" in elem.attrib:
            if elem.attrib["id"] == target_id:
                return index
            index += 1
    return None


def build_vpype_args(svg_file: str, output: str, cfg_path: Path, opt: dict) -> list[str]:
    snap = str(opt.get("snap", "0.05mm"))
    simplify = str(opt.get("simplify", "0.1mm"))
    linemerge = str(opt.get("linemerge", "0.25mm"))
    fill_merge = str(opt.get("fill_merge", "0.3mm"))
    filter_min = str(opt.get("filter_min", "0.15mm"))
    trim = str(opt.get("trim", "3mm"))
    penwidth = str(opt.get("penwidth", "0.1mm"))
    passes = int(opt.get("linesort_passes", 1000))
    two_opt = bool(opt.get("linesort_two_opt", True))
    linesort_t = "-t" if two_opt else ""

    outlines = get_id("outlines", svg_file)
    roads = get_id("roads", svg_file)
    buildings = get_id("buildings", svg_file)
    buildings_filling = get_id("buildings_filling", svg_file)
    water = get_id("water", svg_file)
    water_filling = get_id("water_filling", svg_file)
    parks = get_id("parks", svg_file)
    parks_filling = get_id("parks_filling", svg_file)

    args = ["vpype", "--config", str(cfg_path), "read", svg_file, "trim", trim, trim]

    def linesort(layer: int, two_opt_flag: bool = two_opt) -> list[str]:
        cmd = ["linesort", "-l", str(layer)]
        if two_opt_flag:
            cmd.append("-t")
        cmd += ["-p", str(passes)]
        return cmd

    if outlines is not None:
        print("optimizing outlines", outlines)
        args += [
            "snap", "-l", str(outlines), snap,
            "linesimplify", "-l", str(outlines), "-t", simplify,
            # Never use vpype `deduplicate` here: that plugin ignores -l and
            # merges all layers into layer 1 (wipes fillings).
            "linemerge", "--layer", str(outlines), "-t", linemerge,
            "filter", "-l", str(outlines), "-m", filter_min,
            *linesort(outlines),
        ]
    if roads is not None:
        args += [
            "linesimplify", "-l", str(roads), "-t", simplify,
            "linemerge", "-l", str(roads), "-t", linemerge,
            "filter", "-l", str(roads), "-m", filter_min,
            *linesort(roads),
        ]
    if buildings is not None:
        args += [
            "linesimplify", "-l", str(buildings), "-t", simplify,
            "linemerge", "-l", str(buildings), "-t", linemerge,
            "filter", "-l", str(buildings), "-m", filter_min,
            *linesort(buildings),
        ]
    if buildings_filling is not None:
        args += [
            "linesimplify", "-l", str(buildings_filling), "-t", simplify,
            "linemerge", "-l", str(buildings_filling), "-t", fill_merge,
            "filter", "-l", str(buildings_filling), "-m", filter_min,
            *linesort(buildings_filling),
        ]
    if water is not None:
        args += [
            "linesimplify", "-l", str(water), "-t", simplify,
            "linemerge", "-l", str(water), "-t", linemerge,
            "filter", "-l", str(water), "-m", filter_min,
            *linesort(water),
        ]
    if water_filling is not None:
        args += [
            "linesimplify", "-l", str(water_filling), "-t", simplify,
            "filter", "-l", str(water_filling), "-m", filter_min,
            "linesort", "-l", str(water_filling), "-f",
            *(["-t"] if two_opt else []),
            "-p", str(passes),
        ]
    if parks is not None:
        args += [
            "linesimplify", "-l", str(parks), "-t", simplify,
            "linemerge", "-l", str(parks), "-t", linemerge,
            "filter", "-l", str(parks), "-m", filter_min,
            *linesort(parks),
        ]
    if parks_filling is not None:
        args += ["linesort", "-l", str(parks_filling), "-f"]

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
    opt = optimize_section(cfg)
    vp_args = build_vpype_args(args.svg, args.output, cfg["_path"], opt)
    subprocess.run(vp_args, check=True)
    print("saved", args.output)


if __name__ == "__main__":
    main()
