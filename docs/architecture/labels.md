# Labels and text

## Purpose

Place names along lines or at points; render as Hershey strokes or Google font outlines; optional hatch areas per rule.

## Key files

| File | Role |
|------|------|
| `labels.rs` | `module_labels` — rules, collision, placement, outputs |
| `text.rs` | Hershey + Google layout, `glyph_silhouette` |
| `google_fonts.rs` | Font bytes keyed for the job |
| `grammar_run.rs` | `Value::Labels` — lines + area coverage |

## Module contract

`modules.labels({ from: [feature sets], in?: area, rules: [...] })` in `library.js`.

By default, label placement (`labels::place`) checks glyph quads against the drawable sheet area (`sheets::drawable_area`, which subtracts `output.padding` and `output.slices.gutter`) rather than the raw card edge, so `output.padding` never slices placed labels in half. When `in: area` is passed, labels are further restricted to that area (e.g. a custom inset or rounded frame).

Rules match tags (`tiles:layer`, road `class`, etc.), set sizes (`size`, `minSize`), fonts, buffering along lines (`buffer`, `keepCenterline`).

Outputs used by profiles:

- `labels.lines` — ink strokes
- `labels.area` — union of label footprints (for masks / fills)
- Per-rule accessors when referenced by id (see d.ts)

## Google fonts

Web downloads CSS + font files (`web/src/lib/googleFonts.js`). Core parses TTF with `ttf_parser`.

Outline glyphs: filled silhouette uses **non-zero** winding across all contours (`text::glyph_silhouette`); ink uses silhouette rings, not raw overlapping contours. See [../google-font-labels.md](../google-font-labels.md) for history and tests.

## Hershey

`{ origin: "drawland", id: "…" }` or string id — single-stroke glyphs, no TTF overlap issue.

## Projection

Label geometry is in output mm after the same projection as other features.
