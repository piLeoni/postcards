#!/usr/bin/env python3
"""Export G-code from an optimized SVG using a plotter profile TOML.

Placement, pen up/down, and job start/end come from the config.
With placement.split_layers=true, writes one file per layer (full detail,
smaller files FluidNC can open) — not a reduction of geometry.

Parts land in exports/<job>/part_XX.gcode and chain via $SD/Run when
placement.chain_parts=true.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import vpype as vp
from vpype.io import read_multilayer_svg, write_svg

from postcards.utils.plot_config import (
    DEFAULT_CONFIG,
    feeds_section,
    gwrite_plotter,
    load_plot_config,
    placement_section,
    write_vpype_gwrite_config,
)

PX_TO_MM = 25.4 / 96.0

_XY = re.compile(
    r"^(?P<code>G0?[01])\s+X(?P<x>-?\d+\.?\d*)\s+Y(?P<y>-?\d+\.?\d*)(?P<rest>.*)$"
)


def _pen_up_re(pen_up: float | int) -> re.Pattern[str]:
    z = str(pen_up).rstrip("0").rstrip(".") if isinstance(pen_up, float) else str(pen_up)
    return re.compile(rf"^G0?1?\s*Z\s*{re.escape(z)}(\s|$)", re.I)


def _pen_up_line(feeds: dict) -> str:
    return f"G1 Z{feeds['pen_up']} F{feeds['pen_z']}"


def _continue_start(feeds: dict) -> str:
    return f"""G21
G90
G94
{_pen_up_line(feeds)}
"""


def _point_xy(point) -> tuple[float, float]:
    """Extract (x, y) from a vpype point.

    vpype stores coordinates as complex numbers (real = x, imag = y), but tests
    and callers may hand us an ``[x, y]`` pair instead. Both are accepted.
    """
    if np.iscomplexobj(point):
        return float(np.real(point)), float(np.imag(point))
    return float(point[0]), float(point[1])


def _segment_length(p0, p1) -> float:
    """Euclidean distance between two points."""
    x0, y0 = _point_xy(p0)
    x1, y1 = _point_xy(p1)
    return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5


def clean_line(line: np.ndarray, min_seg: float) -> np.ndarray | None:
    """Drop consecutive points closer than ``min_seg``.

    Two-point lines are kept as-is when the two points differ at all: those are
    intentional dabs (park dots, building marks) and are meant to be shorter than
    ``min_seg``. Zero-length two-point lines are dropped, since a pen-down at the
    same coordinate as the previous move draws nothing.
    """
    if line is None or len(line) == 0:
        return None

    if len(line) == 2:
        return line if _segment_length(line[0], line[1]) > 1e-9 else None

    out = [line[0]]
    for pt in line[1:]:
        if _segment_length(pt, out[-1]) < min_seg:
            continue
        out.append(pt)

    if len(out) < 2:
        return None
    return np.asarray(out, dtype=line.dtype)


def clean_document(doc: vp.Document, min_seg: float) -> None:
    for layer_id in list(doc.layers):
        lc = doc.layers[layer_id]
        new_lc = vp.LineCollection(metadata=lc.metadata)
        for line in lc:
            c = clean_line(line, min_seg)
            if c is not None:
                new_lc.append(c)
        doc.layers[layer_id] = new_lc


def document_bounds(doc: vp.Document) -> tuple[float, float, float, float] | None:
    """Bounding envelope of every point in the document, in page units.

    Equivalent to ``doc.bounds()`` but computed here explicitly, so the bed check
    in :func:`place_document` does not depend on vpype's internal representation.
    vpype stores a line as a flat array of complex numbers — ``real`` is x,
    ``imag`` is y — and every coordinate is inspected rather than any subset.
    """
    xs_min = ys_min = None
    xs_max = ys_max = None

    for layer in doc.layers.values():
        for line in layer:
            if line is None or len(line) == 0:
                continue
            xs, ys = line.real, line.imag
            x_lo, x_hi = float(np.min(xs)), float(np.max(xs))
            y_lo, y_hi = float(np.min(ys)), float(np.max(ys))

            xs_min = x_lo if xs_min is None else min(xs_min, x_lo)
            xs_max = x_hi if xs_max is None else max(xs_max, x_hi)
            ys_min = y_lo if ys_min is None else min(ys_min, y_lo)
            ys_max = y_hi if ys_max is None else max(ys_max, y_hi)

    if xs_min is None:
        return None
    return (xs_min, ys_min, xs_max, ys_max)


def place_document(doc: vp.Document, placement: dict) -> None:
    if document_bounds(doc) is None:
        raise SystemExit("empty document — nothing to export")

    bed_w = float(vp.convert_length(f"{placement.get('bed_width_mm', 200)}mm"))
    bed_h = float(vp.convert_length(f"{placement.get('bed_height_mm', 140)}mm"))
    origin_x = float(vp.convert_length(f"{placement.get('origin_x_mm', 0)}mm"))
    origin_y = float(vp.convert_length(f"{placement.get('origin_y_mm', 140)}mm"))
    flip_y = bool(placement.get("flip_y", True))
    anchor = str(placement.get("anchor", "page")).lower()

    page = doc.page_size
    if page is None and anchor == "page":
        raise SystemExit("SVG has no page size — cannot use placement.anchor=page")

    if flip_y:
        doc.scale(1, -1)

    if anchor == "page":
        doc.translate(origin_x, origin_y)
    elif anchor == "content":
        xmin, ymin, xmax, ymax = document_bounds(doc)
        doc.translate(origin_x - xmin, origin_y - ymax)
    else:
        raise SystemExit(f"unknown placement.anchor={anchor!r} (use page|content)")

    xmin, ymin, xmax, ymax = document_bounds(doc)
    eps = 1e-3
    if xmin < -eps or ymin < -eps or xmax > bed_w + eps or ymax > bed_h + eps:
        raise SystemExit(
            f"placed geometry outside bed: "
            f"X[{xmin * PX_TO_MM:.2f},{xmax * PX_TO_MM:.2f}] "
            f"Y[{ymin * PX_TO_MM:.2f},{ymax * PX_TO_MM:.2f}] mm "
            f"(bed 0..{placement.get('bed_width_mm')} × 0..{placement.get('bed_height_mm')})"
        )

    page_mm = ""
    if page is not None:
        page_mm = f"page {float(page[0]) * PX_TO_MM:.1f}×{float(page[1]) * PX_TO_MM:.1f} mm; "
    print(
        f"{page_mm}origin ({placement.get('origin_x_mm')}, {placement.get('origin_y_mm')}); "
        f"ink X[{xmin * PX_TO_MM:.2f},{xmax * PX_TO_MM:.2f}] "
        f"Y[{ymin * PX_TO_MM:.2f},{ymax * PX_TO_MM:.2f}]"
    )


def scrub_gcode(path: Path, min_mm: float, pen_up_z: float = 4.0) -> None:
    """Drop consecutive G1 moves shorter than min_mm. Keep G0→G1 dabs intact."""
    lines = path.read_text().splitlines()
    out: list[str] = []
    last_g1_xy: tuple[float, float] | None = None
    dropped = 0

    for line in lines:
        stripped = line.strip()
        m = _XY.match(stripped)
        if not m:
            out.append(line)
            zm = re.match(r"^G0?\s*Z\s*(-?\d+\.?\d*)", stripped, re.I)
            if zm and float(zm.group(1)) >= pen_up_z - 0.01:
                last_g1_xy = None
            continue

        code = m.group("code").upper().replace("00", "0").replace("01", "1")
        x, y = float(m.group("x")), float(m.group("y"))

        # Only collapse back-to-back G1 segments — never delete a dab after G0.
        if code in ("G1", "G01") and last_g1_xy is not None:
            dx, dy = x - last_g1_xy[0], y - last_g1_xy[1]
            if (dx * dx + dy * dy) ** 0.5 < min_mm:
                dropped += 1
                continue

        out.append(line)
        if code in ("G1", "G01"):
            last_g1_xy = (x, y)
        else:
            last_g1_xy = None

    path.write_text("\n".join(out) + "\n")
    print(f"scrubbed {dropped} short/duplicate moves → {path}")


def validate_gcode(path: Path, placement: dict) -> None:
    bed_w = float(placement.get("bed_width_mm", 200))
    bed_h = float(placement.get("bed_height_mm", 140))
    text = path.read_text()
    xs, ys = [], []
    for m in re.finditer(r"([XY])(-?\d+\.?\d*)", text):
        (xs if m.group(1) == "X" else ys).append(float(m.group(2)))
    if not xs:
        raise SystemExit("no XY moves in gcode")
    if min(xs) < -0.01 or max(xs) > bed_w + 0.01:
        raise SystemExit(f"X out of bed: [{min(xs)}, {max(xs)}] (0..{bed_w})")
    if min(ys) < -0.01 or max(ys) > bed_h + 0.01:
        raise SystemExit(f"Y out of bed: [{min(ys)}, {max(ys)}] (0..{bed_h})")
    print(
        f"validated {path.name}: X[{min(xs):.2f},{max(xs):.2f}] "
        f"Y[{min(ys):.2f},{max(ys):.2f}] within 0..{bed_w} × 0..{bed_h}"
    )


def _gwrite(doc: vp.Document, gcode_path: Path, cfg_path: Path, bed_w: float, bed_h: float) -> None:
    with tempfile.NamedTemporaryFile(suffix=".svg", delete=False) as tmp:
        tmp_svg = Path(tmp.name)
    try:
        with tmp_svg.open("w", encoding="utf-8") as f:
            write_svg(f, doc, page_size=(bed_w, bed_h))
        subprocess.run(
            [
                "vpype",
                "--config",
                str(cfg_path),
                "read",
                str(tmp_svg),
                "gwrite",
                "--profile",
                "plotter",
                str(gcode_path),
            ],
            check=True,
        )
    finally:
        tmp_svg.unlink(missing_ok=True)


def _extract_body(lines: list[str]) -> list[str]:
    start_idx = 0
    for i, line in enumerate(lines):
        if line.startswith("G0 X") or line.startswith("G00 X"):
            start_idx = i
            break
    end_idx = len(lines)
    for i in range(len(lines) - 1, -1, -1):
        s = lines[i].strip()
        if s.startswith("G1 ") or s.startswith("G01 ") or s.startswith("G0 X") or s.startswith("G00 X"):
            end_idx = i + 1
            break
    return lines[start_idx:end_idx]


def _chunk_body(body: list[str], max_lines: int, pen_up_re: re.Pattern[str]) -> list[list[str]]:
    if max_lines <= 0 or len(body) <= max_lines:
        return [body]
    chunks: list[list[str]] = []
    cur: list[str] = []
    for line in body:
        cur.append(line)
        if len(cur) >= max_lines and pen_up_re.match(line.strip()):
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return chunks if chunks else [body]


def assemble_job(
    raw_paths: list[Path],
    job_dir: Path,
    document_start: str,
    document_end: str,
    continue_start: str,
    pen_up_line: str,
    pen_up_re: re.Pattern[str],
    max_lines: int,
    chain: bool,
) -> list[Path]:
    """Write job_dir/part_XX.gcode with home only on first/last; chain via $SD/Run."""
    job_dir.mkdir(parents=True, exist_ok=True)
    for old in job_dir.glob("part_*.gcode"):
        old.unlink()

    bodies: list[list[str]] = []
    for path in raw_paths:
        bodies.extend(
            _chunk_body(_extract_body(path.read_text().splitlines()), max_lines, pen_up_re)
        )
        path.unlink(missing_ok=True)

    if not bodies:
        raise SystemExit("no gcode body to assemble")

    sd_dir = "/" + job_dir.name
    out_paths: list[Path] = []

    for i, body in enumerate(bodies):
        is_first = i == 0
        is_last = i == len(bodies) - 1
        out = job_dir / f"part_{i + 1:02d}.gcode"
        parts: list[str] = []
        parts.extend((document_start if is_first else continue_start).strip().splitlines())
        parts.extend(body)
        if not body or not pen_up_re.match(body[-1].strip()):
            parts.append(pen_up_line)
        if is_last:
            parts.extend(document_end.strip().splitlines())
        elif chain:
            parts.append(f"$SD/Run={sd_dir}/part_{i + 2:02d}.gcode")
        out.write_text("\n".join(parts) + "\n")
        out_paths.append(out)
        print(f"wrote {out} ({len(parts)} lines, {out.stat().st_size} bytes)")

    if chain and len(out_paths) > 1:
        print(f"chained: {out_paths[0].name} → … → {out_paths[-1].name} via $SD/Run")
    print(f"job folder: {job_dir}/")
    print(f"on SD as:  {sd_dir}/part_01.gcode …")
    return out_paths


def export(
    svg_path: Path,
    gcode_path: Path,
    config_path: Path,
    split_layers: bool | None = None,
) -> None:
    cfg = load_plot_config(config_path)
    placement = placement_section(cfg)
    if split_layers is not None:
        placement["split_layers"] = split_layers

    feeds = feeds_section(cfg)
    gwrite = gwrite_plotter(cfg)
    document_start = str(gwrite.get("document_start", _continue_start(feeds)))
    document_end = str(gwrite.get("document_end", _pen_up_line(feeds) + "\n"))
    continue_start = _continue_start(feeds)
    pen_up_line = _pen_up_line(feeds)
    pen_up_re = _pen_up_re(feeds["pen_up"])

    min_seg = float(vp.convert_length(f"{placement.get('scrub_min_mm', 0.15)}mm"))
    do_split = bool(placement.get("split_layers", False))
    max_lines = int(placement.get("max_lines_per_file", 0) or 0)
    chain = bool(placement.get("chain_parts", True))

    doc = read_multilayer_svg(str(svg_path), quantization=0.1)
    clean_document(doc, min_seg)
    place_document(doc, placement)
    clean_document(doc, min_seg)

    bed_w = float(vp.convert_length(f"{placement.get('bed_width_mm', 200)}mm"))
    bed_h = float(vp.convert_length(f"{placement.get('bed_height_mm', 140)}mm"))
    scrub_mm = float(placement.get("scrub_min_mm", 0.15))

    layer_ids = [lid for lid in sorted(doc.layers.keys()) if not doc.layers[lid].is_empty()]
    if not layer_ids:
        raise SystemExit("no layers to export")

    if gcode_path.stem == "job":
        job_dir = gcode_path.parent
    else:
        job_dir = gcode_path.parent / gcode_path.stem
    job_dir.mkdir(parents=True, exist_ok=True)
    for old in job_dir.glob("part_*.gcode"):
        old.unlink()
    work = job_dir / "_raw"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    raw_paths: list[Path] = []

    vpype_cfg = write_vpype_gwrite_config(cfg)
    try:
        if do_split and len(layer_ids) > 1:
            for i, lid in enumerate(layer_ids, start=1):
                part = vp.Document(page_size=doc.page_size)
                src = doc.layers[lid]
                copied = vp.LineCollection(metadata=src.metadata)
                copied.extend(list(src))
                part.add(copied, lid)
                out = work / f"L{i}.gcode"
                _gwrite(part, out, vpype_cfg, bed_w, bed_h)
                scrub_gcode(out, scrub_mm)
                validate_gcode(out, placement)
                print(f"layer {lid} → {out.name} ({out.stat().st_size} bytes)")
                raw_paths.append(out)
        else:
            out = work / "all.gcode"
            _gwrite(doc, out, vpype_cfg, bed_w, bed_h)
            scrub_gcode(out, scrub_mm)
            validate_gcode(out, placement)
            raw_paths.append(out)

        assemble_job(
            raw_paths,
            job_dir,
            document_start,
            document_end,
            continue_start,
            pen_up_line,
            pen_up_re,
            max_lines,
            chain,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
        vpype_cfg.unlink(missing_ok=True)

