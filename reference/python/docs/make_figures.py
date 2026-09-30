"""Render the figures used by docs/fills.md into docs/img/.

    python docs/make_figures.py

Ink is black; dashed grey is pen-up travel between consecutive strokes, in the
order the fill returns them, so a continuous traversal shows almost none.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely import affinity
from shapely.geometry import LineString, Point, box

from postcards.utils.fills import fill, fill_names
from postcards.utils.fills._fixtures import L_SHAPE, STAR, TWO_BOXES
from postcards.utils.theme_style import stroke_lines

OUT = Path(__file__).resolve().parent / "img"

INK = "#1a1a1a"
OUTLINE = "#c9c9c9"
TRAVEL = "#e0457b"

BUILDING = affinity.rotate(
    box(0, 0, 24, 18).difference(box(8, 12, 16, 18)).difference(box(15, 3, 20, 8)),
    12,
    origin="centroid",
)
SMALL_SQUARE = affinity.rotate(box(0, 0, 3, 3), 45, origin="centroid")


def _outline(ax, region):
    for poly in getattr(region, "geoms", [region]):
        for ring in [poly.exterior, *poly.interiors]:
            xs, ys = ring.xy
            ax.plot(xs, ys, color=OUTLINE, lw=0.8, zorder=1)


def _strokes(ax, lines, lw=0.9, travel=True):
    lifts = 0
    prev = None
    for ln in lines:
        xs, ys = ln.xy
        ax.plot(xs, ys, color=INK, lw=lw, zorder=2, solid_capstyle="round")
        start = Point(ln.coords[0])
        if prev is not None and prev.distance(start) > 1e-6:
            lifts += 1
            if travel:
                ax.plot([prev.x, start.x], [prev.y, start.y], color=TRAVEL,
                        lw=0.6, ls=(0, (2, 2)), zorder=3)
        prev = Point(ln.coords[-1])
    return lifts


def _count(n, noun):
    return f"{n} {noun}" + ("" if n == 1 else "s")


def _frame(ax, title):
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(title, fontsize=10, family="monospace")


def _save(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / name, dpi=110, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", OUT / name)


def gallery(spacing=1.2):
    names = fill_names()
    cols = 3
    rows = -(-len(names) // cols)
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 4, rows * 3.4))
    for ax, name in zip(axes.flat, names):
        opts = {"mark": 0.5} if name == "dots" else {}
        lines = fill(BUILDING, spacing, name, **opts)
        _outline(ax, BUILDING)
        lifts = _strokes(ax, lines)
        _frame(ax, f"{name}: {_count(lifts, 'pen lift')}")
    for ax in list(axes.flat)[len(names):]:
        ax.axis("off")
    fig.suptitle(f"Every algorithm on the same footprint (spacing {spacing} mm)",
                 fontsize=12)
    _save(fig, "fills_gallery.png")


def connectors(spacing=0.75):
    shapes = [("star", STAR), ("L", L_SHAPE), ("two boxes", TWO_BOXES),
              ("3 mm square at 45°", SMALL_SQUARE)]
    modes = ["band", "boundary", "none"]
    fig, axes = plt.subplots(len(modes), len(shapes), figsize=(14, 9.5),
                             gridspec_kw={"width_ratios": [1.2, 1, 1.4, 0.6]})
    for r, mode in enumerate(modes):
        for c, (label, shape) in enumerate(shapes):
            ax = axes[r][c]
            s = spacing if c < 3 else 0.3
            lines = fill(shape, s, "zigzag", connector=mode)
            _outline(ax, shape)
            lifts = _strokes(ax, lines, lw=0.7)
            _frame(ax, f"{mode} · {label}\n{_count(lifts, 'lift')}")
    _save(fig, "zigzag_connectors.png")


def strokes():
    blob = Point(0, 0).buffer(4, quad_segs=24)
    blob = affinity.scale(blob, 1.4, 0.8).union(Point(3.6, 2).buffer(2))
    outline = [LineString(blob.exterior.coords)]
    styles = [
        ("solid", {"style": "solid"}),
        ('dash 0.45 / 0.40', {"style": "dash", "dash": 0.45, "gap": 0.40}),
        ('dotted 0.15', {"style": "dotted", "mark": 0.15}),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.6))
    for ax, (label, settings) in zip(axes, styles):
        lines = stroke_lines(outline, {}, "demo", defaults=settings)
        _strokes(ax, lines, lw=1.6, travel=False)
        _frame(ax, f"{label}  ({_count(len(lines), 'stroke')})")
    _save(fig, "strokes.png")


def main():
    gallery()
    connectors()
    strokes()


if __name__ == "__main__":
    main()
