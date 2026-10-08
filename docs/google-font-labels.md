# Google outline font labels

Handoff for anyone fixing letter rendering in `modules.labels` with `{ origin: "google", … }` fonts (Roboto, IBM Plex Serif, DynaPuff, etc.).

## Status: fixed

Root cause: Google serves variable-font instances (Roboto from `fonts.gstatic.com` is one), whose contours overlap — across contours (`L`, `n`, `E`: stem + bar) and **within a single contour** (`P`, `e`). The old silhouette ran each contour through `geom::make_valid`, which resolves a self-overlap even-odd, so the overlap became a spurious hole (`P` and `e` came out with two counters); the ink then drew every raw contour on top.

Fix:

- `text::glyph_silhouette` fills all of a glyph's contours at once by the **non-zero** rule (i_overlay `simplify_shape(FillRule::NonZero)`, windings as drawn) — exactly how the font is meant to be filled. One body per letter, counters open.
- `labels::place` inks outline glyphs with `geom::rings` of that silhouette (outer edge + one ring per counter), not the raw contours. Hatch (`labels.<id>.area`) and ink now share the same geometry.
- Test: `roboto_glyphs_are_one_body_each_with_their_counters` (needs `/tmp/roboto.ttf`, the file the CSS API serves for `Roboto:400`).

The rest of this note is the original analysis.

## What the user sees

Park and other labels that use a Google font (e.g. city-grain preset: Roboto on `tiles:layer: park`) look wrong:

- Letters appear as **several overlapping closed paths** (stem, bowl, serifs, etc.) instead of one clean silhouette.
- Diagonal hatch fill (`fills.fill({ in: labels.park.area, pattern: "lines" })`) plus ink strokes on top makes **internal seams** very visible (e.g. “Lands End”: vertical bar visible inside “d”, “n”, “E”).
- User expectation: **one coherent letter shape** for fill and/or pen strokes — overlapping TTF subpaths should **merge** where they belong to the same glyph; counters (`o`, `e`, `P`) must stay open.

Hershey fonts (`"futural"`) do not have this issue (single-stroke glyphs, no TTF contours).

## How labels + Google fonts work today

1. **Download** (web): `web/src/lib/googleFonts.js` fetches CSS from `fonts.googleapis.com`, then TTF/WOFF2 from `fonts.gstatic.com`. Fonts are prefetched on the **main thread** (`App.jsx`) and passed into the draw worker. Failures must be readable (not bare `Failed to fetch`).

2. **Layout** (`crates/drawland-core/src/text.rs`):
   - `layout_google()` uses `ttf_parser` + `OutlineCollector` to turn each glyph into **multiple closed contours** (`LabelGlyph.strokes`: `Vec<Vec<(f64,f64)>>` in font units).
   - `LabelLayout.outline == true` for Google fonts.

3. **Placement** (`crates/drawland-core/src/labels.rs`):
   - `place()` maps glyphs to mm, collision detection, buckets per `rules[].id`.
   - For outline fonts, per glyph pose:
     - `s = p.strokes(&layout)` — all raw TTF contours in mm.
     - `text::glyph_silhouette(&s)` builds a **filled** `MultiPolygon` for mask/area (non-zero winding: union same-sign shells, subtract opposite-sign holes).
     - **Ink:** `strokes.extend(s)` — again the **raw** contours (current behaviour after user asked to restore contours).

4. **Preset** (`web/src/presets/city-grain.js`):
   - Park rule: Google font + `label_fill` hatch on `labels.park.area`.
   - `draw({ id: "labels", from: labels.lines })` — all label strokes including parks.

## The core tension

| Goal | Approach tried | Result |
|------|----------------|--------|
| Merge overlapping subpaths (stem + bowl) | `glyph_silhouette` + `geom::rings(&shape)` for ink only | User: **all contours disappeared** (only outer boundary; parks also excluded from `labels.lines` briefly). |
| Restore visible ink | `strokes.extend(s)` raw contours + `labels.lines` for parks | Contours back, **fragments / seams** still visible, especially with hatch fill. |
| Merge at layout time | `merge_outline_glyph_strokes()` before storing glyph | Broke counter holes in tests (`OPg`); reverted. |

**Silhouette for area** (`glyph_silhouette` in `text.rs`) uses `union_all` on same-winding shells then subtracts holes. Tests pass for Roboto `"Lands"` / `"adng"` per-glyph part count on Arial/Roboto — geometry merge may already be OK for **area**, while **ink still draws every subpath**.

## Likely root cause

- TTF → pen plotter pipeline draws **each closed contour as its own stroke**.
- Hatch is clipped per polygon in `fill.rs` `regions()`; if `labels.park.area` is a `MultiPolygon` with **multiple polygons per glyph** or overlapping pieces, hatch shows **seams**.
- Even with a correct single polygon per glyph in `area`, drawing **raw contours on top** of hatch retraces internal edges.

Success probably requires **one** of:

1. **Ink:** stroke only the **boundary** of `glyph_silhouette` (outer + hole rings), not raw subpaths — without losing counters or making letters vanish when combined with fill.
2. **Fill:** ensure `labels.*.area` is exactly one polygon per glyph (with interiors for holes), never one multipolygon piece per subpath; verify with Roboto “d” / “Lands End” in mm space after placement.
3. **Both:** unified silhouette for fill; ink either same rings or a dedicated “outline” pass; park preset may need **either** hatch **or** contour ink, not both on overlapping geometry.

## Files to touch

| Path | Role |
|------|------|
| `crates/drawland-core/src/text.rs` | `layout_google`, `OutlineCollector`, `glyph_silhouette` |
| `crates/drawland-core/src/labels.rs` | `place()`, `keep` callback, `Placed.area` / buckets |
| `crates/drawland-core/src/fill.rs` | `regions()` — per-polygon hatch |
| `web/src/lib/googleFonts.js` | Fetch + error messages |
| `web/src/presets/city-grain.js` | Park Google font + `label_fill` + `labels` |

## Tests already added

- `outline_glyph_overlapping_contours_merge_to_one_silhouette` (system Arial)
- `roboto_glyphs_are_one_body_each_with_their_counters` (needs `/tmp/roboto.ttf` downloaded)
- `an_outline_font_covers_its_glyphs_with_the_counters_open` (`OPg`, holes)

Run: `cargo test -p drawland-core outline`

## WASM / web

Engine changes need `cd web && npm run wasm` or the browser keeps old behaviour.

## Google Fonts fetch (separate issue)

IBM Plex Serif failed in worker with `Failed to fetch`; Roboto worked. Prefetch on main thread was added. If CSS has no `/* latin */` block, `pickUrl` must still find `fonts.gstatic.com` URLs (see `pick_url_from_css` in `crates/drawland-core/src/google_fonts.rs`).

## Suggested acceptance criteria

1. City-grain at SF (or any park with a name): Google park labels readable — no obvious **internal** subpath seams on letters like `a`, `d`, `E`, `n`.
2. Counters preserved on `O`, `P`, `e`, `g`.
3. `labels.lines` non-empty for park + street rules; user can choose hatch-only, stroke-only, or both without broken geometry.
4. No regression on Hershey `futural` labels.

## Current state

- `glyph_silhouette` in `text.rs`: non-zero fill of all contours together.
- Outline ink = rings of the silhouette.
- `city-grain.js` draws `labels.lines` (includes parks).

Do not “fix” only in presets by excluding park strokes or dropping Google fonts — user wants the **font/labels module** fixed.
