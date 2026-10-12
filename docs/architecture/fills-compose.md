# Fills, strokes, and SVG output

## Purpose

Turn areas into pen paths (patterns or outlines) and emit grouped SVG in millimetres.

## Fills (`fill.rs`)

- Input: `FillSpec` from profile + `MultiPolygon` region in mm.
- Backed by **penfill** (`Region`, generators, optional SVG `source`).
- Generator names in `GENERATORS` (must stay in sync with d.ts / penfill).
- Output: `geom::Lines` (same type as hand-drawn linework).

Per-feature fills (`per: "feature"`) iterate features for placement.

Fill budget / memory: WASM sets `Job.memoryBudget` from WASM memory max; oversized fills fail with `RunError::TooLarge` rather than trapping.

## Strokes

`profile.rs` — `StrokeSpec` (solid, dash, dotted, width, cap). Applied when tessellating draws in `grammar_run` / `svg.rs`.

## SVG (`svg.rs`)

Layered groups matching `draw` ids and `compose.order`. Masks subtract paths from targeted groups before merge.

## Compose (authoring vs runtime)

Profiles call `compose.mask({ from: area, occludes: ["group_id", …] })`. Runtime clipping of line work uses mask geometry against listed groups only — see [grammar-engine.md](grammar-engine.md).

Typical stacking: ground → nature → water → roads → buildings → labels, with masks for trails, water cover, road cover, label clear.

## Units (`units.rs`)

Lengths in profiles parse to mm (`"0.5mm"`, `"6in"`, etc.). Internal geometry is mm on paper at the stated scale.

## Dependencies

Pattern behaviour changes belong in **penfill** when general; draw.land only wires specs and regions.

**Isoline** fills (`isoline-blobs`, `isoline-stack`) also publish what they cover: `fills.cover(options)` is a `$areas` def (`tools_fill_cover`, `fill::cover`) to mask other groups with, sharing one generator run with the matching `fills.fill`. See [isoline-blob-fills.md](isoline-blob-fills.md).
