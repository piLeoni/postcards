# Fills, strokes, and SVG output

## Purpose

Turn areas into pen paths (patterns or outlines) and emit grouped SVG in millimetres.

## Fills (`fill.rs`)

- Input: `FillSpec` from profile + `MultiPolygon` region in mm.
- Backed by **penfill's catalogue** (`penfill::catalog`): every pattern is a *material* (named recipe: `gravel`, `marsh`, `limestone`) or a *generator* (`hatch`, `scatter`, `cells`, `tile`, `waves`, specialists). penfill owns the names, every option's kind/default/doc, validation and dispatch; see penfill `docs/architecture/catalog.md`.
- `fill.rs` only translates (`catalog_spec`): lengths (`"0.5mm"`) → mm, `[[x, y], …]` → polylines (custom `motif`), `anchor`/`shift` → `Anchor` (global by default), `edge`/`overflow` → `EdgeMode`, `fray`. Unknown options and bad values are the catalogue's errors (`FillError::Catalog`), which name the valid keys. draw.land keeps only what is its own: SVG `source`, `solid` (flat colour), `none`, and the `COVERED` cache.
- `motif` given as a `Lines` handle (`lines.shape`, `lines.text`) is a graph reference (`Fill.motif`); `grammar_run::with_motif` resolves it and `fill::motif_polylines` centres it on the origin before the fill runs.
- Footprint-aware patterns (`catalog::own_mask`: crowns, clouds, stones, scattered marks) feed `fills.cover`: `fill::cover` returns the run's mask, and the run is cached so the matching `fills.fill` reuses it.
- Output: `geom::Lines` (same type as hand-drawn linework).
- The pattern part of `drawland.d.ts` (between the `catalog:begin` / `catalog:end` markers: `Pattern`, `Material`, `Generator`, `Mark`, one `…Options` interface per generator, `PatternOptions`) is generated from the catalogue: `cargo run -p drawland-script --example write_dts`; `drawland-script` tests fail when it is stale. `FillOptions` is `FillBase & PatternOptions | content | source`; `FillStyle` is its distributive "without `in`" for style constants.

Per-feature fills (`per: "feature"`) iterate features for placement.

Fill budget / memory (`budget.rs`): before a fill runs inside a page, its cost is **sampled** — the pattern is drawn on a small square (12× its widest layer spacing, 20–150 mm), its points and strokes per mm² counted and scaled to the area, at `PER_POINT` / `PER_STROKE` bytes fitted by `examples/budget_calib.rs`. It holds for any material, symbol or custom motif without a per-name table. WASM sets `Job.memoryBudget` from WASM memory max; oversized fills fail with `RunError::TooLarge` rather than trapping.

## Strokes

`profile.rs` — `StrokeSpec` (solid, dash, dotted, width, cap). Applied when tessellating draws in `grammar_run` / `svg.rs`.

## SVG (`svg.rs`)

Layered groups matching `draw` ids and `compose.order`. Masks subtract paths from targeted groups before merge. Coordinate precision (`round_svg_decimals`) and per-layer / per-sheet file splitting (`split_svg_layers`, `sheets::export_svg_files`) are shared helpers in `drawland-core`.

## Compose (authoring vs runtime)

Profiles call `compose.mask({ from: area, occludes: ["group_id", …] })`. Runtime clipping of line work uses mask geometry against listed groups only — see [grammar-engine.md](grammar-engine.md).

Typical stacking: ground → nature → water → roads → buildings → labels, with masks for trails, water cover, road cover, label clear.

## Units (`units.rs`)

Lengths in profiles parse to mm (`"0.5mm"`, `"6in"`, etc.). Internal geometry is mm on paper at the stated scale.

## Dependencies

Pattern behaviour changes belong in **penfill** when general; draw.land only wires specs and regions.

Footprint-aware fills (isoline crowns, clouds, stones, scattered marks) publish what they cover: `fills.cover(options)` is a `$areas` def (`tools_fill_cover`, `fill::cover`) to mask other groups with, sharing one generator run with the matching `fills.fill`. See [isoline-blob-fills.md](isoline-blob-fills.md).
