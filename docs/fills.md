# Fills: interchangeable area-filling algorithms

Status: **implemented** for buildings. Algorithms live under
`postcards/utils/fills/`; selection is per theme in the plot profile.

## Why

The old building fill generated a card-wide hatch and clipped it to each
footprint afterwards. That works, but the clip is what creates the fragments:
a concave building becomes dozens of short strokes, and only vpype's
`linesort` reorders them later. Sorting is not joining — travel moves still
lift the pen, and a post-hoc merge can route outside the polygon.

Fills invert that: they generate paths **inside** the region and join nearby
scan lines themselves, so continuity is part of the geometry, not left to
chance downstream.

## Algorithms

| Name | What it draws | Continuous? |
|---|---|---|
| `rectilinear` | Parallel hatch (baseline / legacy look) | no — one stroke per fragment |
| `zigzag` | Same hatch, ends joined into a serpentine | yes |
| `spiral` | Concentric rings joined outside-in | mostly |
| `concentric` | Concentric rings, unjoined | each ring is one stroke |
| `grid` | Two `zigzag` passes at 90° | yes (per direction) |
| `honeycomb` | Three `zigzag` passes at 60° | yes (per direction) |
| `hilbert` | Hilbert curve clipped to the region | broken by the clip |

`grid` and `honeycomb` are **not** loose cross-hatches. Each direction is a
full zigzag traversal so the pen does not rely on `linesort` to stitch
neighbours — that would risk connectors outside the footprint.

## Config

In `configs/fluidnc.toml` (or any profile):

```toml
[fill.buildings]
algorithm = "zigzag"    # see table above
spacing = "0.5mm"
angle = 45
```

Optional per-algorithm options:

```toml
[fill.buildings.zigzag]
connector = "band"      # band | boundary | none
```

Omit the whole `[fill.buildings]` section to keep the historical card-wide
hatch. Parks and water still use the old patterns (`dots` / `waves`); only
buildings are wired to this family so far.

## Contract

```python
def fill_<name>(region, spacing, **options) -> list[LineString]
```

- `region` is already in page millimetres (Polygon or MultiPolygon)
- strokes stay inside the region, inset by ~`spacing / 2`
- holes are respected — nothing crosses a courtyard
- MultiPolygons are filled per part; no bridge between buildings

## Measuring / comparing

```bash
# fixture shapes (L, ring, star, U, …)
python -m postcards fills --shape L --output-dir /tmp/fills

# real footprints from an existing map.svg
python -m postcards fills \
  --from-svg exports/500_folsom_street_san_francisco_ca/map.svg \
  --output-dir /tmp/fills_real
```

Prints lifts, drawn length, coverage and containment for every algorithm, and
writes one SVG each. That report — not taste — decides which algorithms earn
a place on the plotter.

## Layout

```
postcards/utils/fills/
├── __init__.py        # registry: name → callable
├── _common.py         # inset, sweep, clip helpers
├── _fixtures.py       # L, ring, star, …
├── _report.py         # lifts / length / coverage
├── rectilinear.py
├── zigzag.py
├── concentric.py
├── spiral.py
├── grid.py
├── honeycomb.py
└── hilbert.py
```

`postcards/fills.py` is the CLI (`postcards fills`). Buildings pick the
algorithm in `postcards/utils/filters/buildings.py` via
`plot_config.fill_section`.

## Still open

- **Parks / water.** Same interface; not wired yet.
- **Skeleton / Fermat.** Worth it only if zigzag + spiral leave a measurable
  gap on real footprints.
- **Spiral on messy MultiPolygons.** Rings join within one nest; some real
  maps still show a few containment misses — treat spiral as experimental
  until that is closed.
