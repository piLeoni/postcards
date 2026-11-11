# Labels and text

## Purpose

Place names along lines or at points; render as Hershey strokes or Google font outlines; optional hatch areas per rule.

## Key files

| File | Role |
|------|------|
| `labels.rs` | `module_labels` — rules, collision, placement, outputs |
| `text.rs` | Stroke + Google layout, `glyph_silhouette` |
| `stroke_font.rs` | Hershey `.jhf`, EMS SVG fonts, catalog URLs, fallback layout |
| `google_fonts.rs` | Font bytes keyed for the job |
| `grammar_run.rs` | `Value::Labels` — lines + area coverage |

## Module contract

`modules.labels({ from: [feature sets], in?: area, rules: [...] })` in `library.js`.

By default, label placement (`labels::place`) checks glyph quads against the drawable sheet area (`sheets::drawable_area`: every sheet inset by `max(output.padding, slices.gutter / 2)`) rather than the raw card edge, so `output.padding` never slices placed labels in half. When `in: area` is passed, labels are further restricted to that area (e.g. a custom inset or rounded frame).

Rules match tags (`tiles:layer`, road `class`, etc.), set sizes (`size`, `minSize`), fonts, buffering along lines (`buffer`, `keepCenterline`).

Outputs used by profiles:

- `labels.lines` — ink strokes
- `labels.area` — union of label footprints (for masks / fills)
- Per-rule accessors when referenced by id (see d.ts)

## Google fonts

Web downloads CSS + font files (`web/src/lib/googleFonts.js`). Core parses TTF with `ttf_parser`.

Outline glyphs: filled silhouette uses **non-zero** winding across all contours (`text::glyph_silhouette`); ink uses silhouette rings, not raw overlapping contours. See [../google-font-labels.md](../google-font-labels.md) for history and tests.

## Hershey / stroke fonts

`"futural"` or `{ origin: "drawland", id, url? }` — single-stroke Hershey or EMS SVG fonts (`stroke_font.rs`). Catalog ids (`ems-readability`, `ems-swiss`) download at run time; `url` overrides the fetch target. `{ origin: "stroke", url }` loads any SVG/JHF URL. Missing glyphs fall back to `futural`, then whole-word `deunicode` transliteration (Arabic/CJK/Hangul → Latin letters; Greek/Cyrillic are drawn natively in `futural`). Bytes keyed by URL in `Inputs.stroke_fonts` (web: `strokeFontKeys` / `addStrokeFont`; CLI: `stroke_fonts::fetch`).

## Projection

Label geometry is in output mm after the same projection as other features.

## Avoid

`modules.labels({ avoid })` (`Labels::avoid`, `labels::place_avoiding`): an area the letters (grown by `padding`) keep off, while a place's point and dot may sit on it — a station on a transit line gets its name beside the line, never across it. Point labels try the eight spots round the dot, then the same eight a step farther out, so a long name beside a sloping line still finds room.

## Graticule (`graticule.rs`)

`tools_graticule` (lines: `part: grid | labels`) and `tools_graticule_area` (area: `part: keys | labels`) draw an atlas plate round the bounds of an `in` area. Meridians and parallels every `step` arc-minutes are sampled in lon/lat over the ground under the plate and projected; that ground is found by `Projector::locate`, a Newton inverse that works for every projection and bearing. A side's keys and labels come from where its own family (meridians on top and bottom, parallels on the sides) crosses it. Keys are inked by the parity of the arc-minutes, so opposite sides agree and they stay put as the plate moves. Labels sit `band + gap` outside the edge: level on top and bottom, turned on the sides. A label is skipped near a corner, or where it would touch the one before. Label areas keep counters open, so they can be filled solid.
