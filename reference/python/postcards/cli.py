"""Command line entry point: ``python -m postcards <command>``.

Subcommands map to the pipeline stages, so the whole thing is discoverable from
``--help`` instead of needing to know which script lives where.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from postcards import __version__


def slugify(text: str) -> str:
    """Turn an address into a directory name."""
    out = "".join(c if c.isalnum() else "_" for c in text.lower())
    return "_".join(filter(None, out.split("_")))


def cmd_map(args: argparse.Namespace) -> int:
    """Stage 1: address or coordinates -> map.svg."""
    from postcards.make_map import build_map
    from postcards.utils.cli_parser import parse_args

    argv = ["--config", str(args.config), "--output", str(args.output)]
    if args.address:
        argv += ["--address", args.address]
    else:
        argv += ["--lat", str(args.lat), "--lng", str(args.lng)]
    if args.width:
        argv += ["--width", args.width]
    if args.scale:
        argv += ["--scale", args.scale]
    if args.bearing is not None:
        argv += ["--bearing", str(args.bearing)]
    if args.projection:
        argv += ["--projection", args.projection]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    build_map(parse_args(argv))
    return 0


def cmd_optimize(args: argparse.Namespace) -> int:
    """Stage 2: map.svg -> opt.svg via vpype."""
    from postcards.optimize import run_optimize

    output = args.output or args.svg.with_suffix("")
    run_optimize(args.svg, output, args.config)
    return 0


def cmd_gcode(args: argparse.Namespace) -> int:
    """Stage 3: opt.svg -> part_*.gcode."""
    from postcards.export_gcode import export

    output = args.output or args.svg.parent / "job.gcode"
    export(args.svg, output, args.config)
    return 0


def cmd_make(args: argparse.Namespace) -> int:
    """Stages 1-3, writing everything into ``exports/<slug>/``."""
    from postcards.export_gcode import export
    from postcards.make_map import build_map
    from postcards.optimize import run_optimize
    from postcards.utils.cli_parser import parse_args

    if not args.address and (args.lat is None or args.lng is None):
        raise SystemExit("give an address, or both --lat and --lng")

    label = args.address or f"{args.lat}_{args.lng}"
    job_dir = Path(args.out_dir) / slugify(label)
    job_dir.mkdir(parents=True, exist_ok=True)

    raw = job_dir / "map.svg"
    opt = job_dir / "opt"

    argv = ["--config", str(args.config), "--output", str(raw)]
    if args.address:
        argv += ["--address", args.address]
    else:
        argv += ["--lat", str(args.lat), "--lng", str(args.lng)]

    print(f"==> job dir: {job_dir}")
    print(f"==> 1/3 map SVG       -> {raw}")
    build_map(parse_args(argv))

    print(f"==> 2/3 optimize paths -> {opt}.svg")
    run_optimize(raw, opt, args.config)

    print(f"==> 3/3 G-code         -> {job_dir}/part_*.gcode")
    export(f"{opt}.svg", job_dir / "job.gcode", args.config)

    print(f"==> done: {job_dir}/")
    return 0


def cmd_upload(args: argparse.Namespace) -> int:
    """Stage 4: push a job folder to the plotter over WebDAV."""
    from postcards.upload_fluidnc import upload_job

    argv = [str(args.job_dir), "--host", args.host]
    if args.run:
        argv.append("--run")
    if args.no_upload:
        argv.append("--no-upload")
    return upload_job(argv)


def cmd_check(args: argparse.Namespace) -> int:
    """Validate a generated job folder without touching the machine."""
    from postcards.export_gcode import validate_gcode
    from postcards.utils.plot_config import load_plot_config, placement_section

    parts = sorted(Path(args.job_dir).glob("part_*.gcode"))
    if not parts:
        raise SystemExit(f"no part_*.gcode in {args.job_dir}")

    placement = placement_section(load_plot_config(args.config))
    for part in parts:
        validate_gcode(part, placement)
    print(f"{len(parts)} part(s) validated in {args.job_dir}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="postcards",
        description="Generate pen-plotted postcards from OpenStreetMap data.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_config(p, default="configs/fluidnc.toml"):
        p.add_argument("--config", type=Path, default=Path(default), help="plotter profile TOML")

    def add_location(p):
        p.add_argument("--address", help="street address (geocoded)")
        p.add_argument("--lat", type=float, help="latitude, if not using --address")
        p.add_argument("--lng", type=float, help="longitude, if not using --address")

    # make: the one-shot command.
    p = sub.add_parser("make", help="address -> map.svg, opt.svg and part_*.gcode")
    add_location(p)
    add_config(p)
    p.add_argument("--out-dir", default="exports", help="root output directory")
    p.set_defaults(func=cmd_make)

    # Individual stages.
    p = sub.add_parser("map", help="stage 1: address -> map.svg")
    add_location(p)
    add_config(p)
    p.add_argument("--output", required=True, type=Path, help="path to write map.svg")
    p.add_argument("--width", help="card width, e.g. 6in or 152.4mm")
    p.add_argument("--scale", help="map scale, e.g. 1:10000")
    p.add_argument("--bearing", type=float, help="rotation in degrees")
    p.add_argument("--projection", choices=("utm", "webmercator"))
    p.set_defaults(func=cmd_map)

    p = sub.add_parser("optimize", help="stage 2: map.svg -> opt.svg")
    p.add_argument("svg", type=Path, help="input SVG")
    p.add_argument("output", nargs="?", type=Path, help="output prefix, without .svg")
    add_config(p)
    p.set_defaults(func=cmd_optimize)

    p = sub.add_parser("gcode", help="stage 3: opt.svg -> part_*.gcode")
    p.add_argument("svg", type=Path, help="input SVG")
    p.add_argument("output", nargs="?", type=Path, help="job path; its folder holds the parts")
    add_config(p)
    p.set_defaults(func=cmd_gcode)

    p = sub.add_parser("upload", help="stage 4: send a job folder to the plotter")
    p.add_argument("job_dir", type=Path, help="folder containing part_*.gcode")
    p.add_argument("--host", required=True, help="FluidNC hostname or IP")
    p.add_argument("--run", action="store_true", help="start part_01 after upload")
    p.add_argument("--no-upload", action="store_true", help="only run, skipping upload")
    p.set_defaults(func=cmd_upload)

    p = sub.add_parser("check", help="validate G-code against the bed, without the machine")
    p.add_argument("job_dir", type=Path, help="folder containing part_*.gcode")
    add_config(p)
    p.set_defaults(func=cmd_check)

    # fills: render and measure the fill algorithms on a fixture shape.
    from postcards.fills import add_parser as add_fills_parser

    add_fills_parser(sub)

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
