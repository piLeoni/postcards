# Fills: a family of area-filling algorithms

Status: **implemented** — `rectilinear`, `concentric`, `zigzag` live under
`postcards/utils/fills/`. Select per theme with `[fill.<theme>]` in the profile;
`postcards fills` renders and measures them.

## Why

Theme fills are currently generated one way: a full-board pattern that is
intersected with the target polygon afterwards. That works, and for buildings it
produces a rectilinear hatch at 45°.

Two limitations motivate this work.

**Fragmentation.** The pattern is generated *outside* the region and clipped
afterwards, so the clip is what splits it. A building with a courtyard, or any
concave footprint, yields many disconnected fragments that are only ordered
later by vpype's `linesort`. The pen lifts once per fragment.

**One algorithm only.** `lines_pattern`, `dots_pattern` and `waves_pattern` are
three textures, not three strategies. Everything else a slicer offers —
concentric, monotonic, spiral, Hilbert — is unavailable.

The goal is a set of interchangeable fill algorithms, selectable per theme from
the config, and testable against each other on the same input. Buildings first,
but the interface takes any closed polygon, so parks and water follow for free.

Note this is deliberately **independent of the existing patterns**. Nothing here
rewires `lines_pattern`; the two coexist so they can be compared.

## What "good" means here

The metric that matters is not how many algorithms exist, it is whether a fill
is measurably better on real footprints. For each candidate, measure:

- **pen lifts** — the number of separate polylines produced
- **drawn length** — total mm, to catch a fill that bought continuity by
  adding visible connector strokes (which the pen does draw, unlike extruded
  infill where connectors are buried inside the part)
- **coverage** — worst-case distance from an interior sample point to the
  nearest stroke, as in `tests/test_patterns.py`. Catches the unwritten-wedge
  class of bug that the current patterns had.
- **containment** — every stroke inside the region, minus a small inset

Pen lifts and drawn length are in tension: reducing lifts means adding
connectors. Report both, never one alone.

## Interface

One function per algorithm, uniform signature:

```python
def fill_<name>(
    region: Polygon | MultiPolygon,
    spacing: float,
    **options,
) -> list[LineString]
```

Contract:

- input is one or more closed polygons, already in page millimetres
- output is LineStrings **inside the region**, inset by `spacing / 2` so strokes
  do not touch the border
- output is unordered; a separate step may order or connect it
- holes are respected: no stroke crosses an interior ring

Returning geometry rather than a GeoDataFrame keeps these pure and easy to test.
The caller wraps the result with `as_gdf`.

A second, optional entry point for algorithms that produce a genuine traversal:

```python
def path_<name>(region, spacing, **options) -> list[LineString]
```

Same contract, but the list is a *sequence* meant to be drawn in order, and
adjacent elements already share endpoints. `zigzag`, `skeleton` and `fermat`
provide this; `rectilinear` and `concentric` do not.

## Candidate algorithms

Ordered by value against effort. Implement the first three before judging
whether the rest are worth it.

| Name | Idea | Source | Effort |
|---|---|---|---|
| `concentric` | rings by iterated `buffer(-d)` | shapely only | low |
| `rectilinear` | parallel lines, current behaviour, as a fill | existing | low |
| `zigzag` | parallel lines joined into a serpentine | Cura `connectInfills` | medium |
| `skeleton` | decompose, then serpentine each part | PrusaSlicer monotonic; `shapely_polyskel` | medium |
| `spiral` | one continuous spiral per region | Cura concentric | medium |
| `fermat` | Fermat spiral, joined into one curve | CFS, SIGGRAPH 2016 | high |
| `hilbert` | Hilbert curve | classic slicing | low |
| `grid` | square cells | slicer grid infill | low |

### Priority 1 — `concentric`

Trivial and immediately useful. Repeatedly offset the region inward by
`spacing` until the offset is empty; each ring is one polyline. On a convex
footprint this is nearly continuous. On a concave one the rings split at
narrowings, which is the honest limitation and worth seeing.

No new dependency. `shapely.buffer` with `join_style` and `mitre_limit` set for
crisp corners.

### Priority 2 — `zigzag`

The direct answer to "generate a continuous path instead of clipping a
pattern". This is Cura's `connectInfills`:

1. generate parallel lines at the fill angle
2. clip to the region
3. group fragments into bands along the sweep direction
4. within a band, order fragments along the line direction and alternate
   direction between consecutive lines
5. join the end of one fragment to the start of the next

Step 5 is where connector strokes appear. Their length is the design parameter:
they can run along the band (short, many turns) or along the boundary (long,
fewer turns). Cura connects along the boundary so the extra strokes read as
part of the outline.

Read `CuraEngine/src/FffGcodeWriter.cpp` (`connectInfills`) and
`CuraEngine/src/infill.cpp` as the reference. Port the logic, not the code —
the licences are AGPL and this project is not.

### Priority 3 — `skeleton`

Decompose the region into parts where a serpentine is guaranteed continuous,
then fill and concatenate. This is what makes the difference on real building
footprints, which are concave far more often than not.

`shapely_polyskel` (already in the venv, pulled in by vpype) provides the
straight skeleton. Worth verifying its API before committing to it — if it does
not expose a usable decomposition, fall back to a boustrophedon decomposition,
which is straightforward to write and is the basis of the coverage-path
literature.

### Deprioritised

`fermat` is attractive on paper and is likely the most visually striking, but
the implementation is a research-grade algorithm with a graph traversal step
and non-obvious failure modes around holes. It also changes the look
substantially. Revisit after the first three are measured.

`spiral` overlaps heavily with `concentric`. `hilbert` and `grid` are easy but
are unlikely to suit pen drawing — Hilbert's locality is exactly what makes it
busy and high-curvature.

## Config

Selection is per theme, in `configs/fluidnc.toml`:

```toml
[fill.buildings]
algorithm = "zigzag"         # rectilinear | concentric | zigzag | spiral | grid | honeycomb | hilbert
spacing = "0.5mm"
angle = 45
```

Per-algorithm options:

```toml
[fill.buildings.zigzag]
connector = "band"           # band | boundary | none
```

When no `[fill.<theme>]` section is present, buildings keep the historical
card-wide hatch — existing profiles render unchanged.

`spacing` and `angle` are length quantities, parsed like the rest of the config
through `vpype.convert_length` or `pint`, matching `[optimize]`.

## Testing

The value of this work is entirely in the measurements, so tests come before
breadth.

- **Conformance**: every algorithm satisfies the shared contract — output is
  inside the region, holes are respected, nothing exceeds the inset.
- **Coverage**: reuse the sampling method from `tests/test_patterns.py`. Every
  algorithm must reach `0.6 * spacing` worst case, as the patterns now do.
- **Determinism**: same input, same output. No set iteration or hash ordering.
- **Fixtures**: a small library of shapes that actually break things — an L,
  a U, a ring (polygon with a hole), a narrow corridor, a star, and a real
  building footprint extracted from an existing `map.svg`.
- **Comparison**: a report over the fixture set printing lifts, drawn length,
  coverage and containment per algorithm. This is the artefact that decides
  which algorithms earn a place, rather than opinion.

Add a `postcards fills` subcommand that renders each algorithm on a chosen
polygon to an SVG for visual inspection. Comparing them by eye on a real
footprint is faster than reading numbers alone.

## Layout

```
postcards/utils/fills/
├── __init__.py        # registry: name -> callable
├── _common.py         # inset, banding, connector helpers
├── concentric.py
├── rectilinear.py
├── zigzag.py
├── skeleton.py
└── ...                # fermat, hilbert, grid
```

Mirrors `postcards/utils/filters/`, so the two families read the same way.

## Open questions

- **Connector visibility.** Extruded infill hides connectors inside the part.
  A pen draws them. How much extra visible line is acceptable before continuity
  stops being worth it? This is the central trade-off and it needs a number
  from the comparison report, not a preference.
- **Ordering vs connecting.** vpype's `linesort` already orders fragments. If
  `zigzag` only orders them, `linesort` gets most of the benefit without a new
  algorithm — worth measuring before writing more code.
- **Per-theme or per-shape.** A long thin building and a tozzy one want
  different fills. Selecting per theme is simple; selecting per polygon is
  better and much harder. Start per theme.
- **Does this belong in the project or in vpype?** These are generic polygon
  fills with no postcard content. A vpype plugin would make them reusable and
  is the same spirit as the `deduplicate` plugin already planned.
