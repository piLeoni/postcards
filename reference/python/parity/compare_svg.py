"""Compare two layered map SVGs group by group.

    .venv/bin/python crates/postcards-cli/parity/compare_svg.py python.svg rust.svg

For every ``<g id>`` layer: stroke count, total ink length (mm), and the
extent of the drawing, side by side with the relative length difference.
Length is the number that tracks plotting time and visual density; counts
differ for harmless reasons (where a ring starts, how dashes split).
"""

from __future__ import annotations

import math
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.w3.org/2000/svg}"


def _points(text: str) -> list[tuple[float, float]]:
    out = []
    for pair in text.replace(",", " ").split():
        out.append(float(pair))
    return list(zip(out[0::2], out[1::2]))


def _strokes(elem) -> list[list[tuple[float, float]]]:
    tag = elem.tag.removeprefix(NS)
    if tag == "polyline":
        return [_points(elem.get("points", ""))]
    if tag == "line":
        return [[(float(elem.get("x1")), float(elem.get("y1"))), (float(elem.get("x2")), float(elem.get("y2")))]]
    out = []
    for child in elem:
        out.extend(_strokes(child))
    return out


def layers(path: str) -> dict[str, list[list[tuple[float, float]]]]:
    root = ET.parse(path).getroot()
    return {g.get("id"): _strokes(g) for g in root if g.tag.removeprefix(NS) == "g" and g.get("id")}


def stats(strokes):
    length = 0.0
    xs, ys = [], []
    for s in strokes:
        for (x0, y0), (x1, y1) in zip(s, s[1:]):
            length += math.hypot(x1 - x0, y1 - y0)
        xs.extend(p[0] for p in s)
        ys.extend(p[1] for p in s)
    box = (min(xs), min(ys), max(xs), max(ys)) if xs else None
    return len(strokes), length, box


def main(a: str, b: str) -> None:
    la, lb = layers(a), layers(b)
    ids = list(la) + [k for k in lb if k not in la]
    print(f"{'layer':22} {'strokes A':>9} {'strokes B':>9} {'length A':>10} {'length B':>10} {'Δlen':>7}  extent A | extent B")
    for k in ids:
        na, len_a, box_a = stats(la.get(k, []))
        nb, len_b, box_b = stats(lb.get(k, []))
        d = (len_b - len_a) / len_a * 100 if len_a else float("nan")
        fmt = lambda box: "-" if box is None else "{:.1f},{:.1f}..{:.1f},{:.1f}".format(*box)
        print(f"{k:22} {na:9d} {nb:9d} {len_a:10.1f} {len_b:10.1f} {d:6.1f}%  {fmt(box_a)} | {fmt(box_b)}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
