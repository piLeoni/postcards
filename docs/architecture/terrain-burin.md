# Terrain and burin

## Purpose

Pen-and-ink relief and related linework from elevation under the output, integrated as ordinary `Lines` in the graph.

## Key files

| File | Role |
|------|------|
| `terrain.rs` | Terrarium grid → mm placement; run burin `Drawing` |
| `burin-map-core` | Atlas, expression trees, rasterised hatching |
| `burin-map-script` | `burin.terrain((b) => …)` builder mounted in drawland-script |

## Data flow

1. Terramask supplies elevation grid (Terrarium) for output bounds, at the zoom that matches the grid (up to 14). The CLI sets `Fetcher::elevation_max_zoom` to `TERRARIUM_MAX_ZOOM` so it reads as deep as the web page (`ZoomLimits::default()` in `drawland-wasm`); at zoom 10 coasts come out as pixel staircases.
2. Profile builds a burin atlas (batch style, water, coast, etc.) via JS callback.
3. `terrain.rs` maps burin pixels to output mm (`Grid`, `Placed`; grid width `width_px(output)` = paper width of the covered area at `MM_PER_PX` 0.15 mm/px, so a burin style is the same physical size on any sheet, as burin-map does for paper) and calls `Atlas::draw` on a [`Surface`](../../burin-map/docs/regions.md) (elevation, `px_m`, optional named regions).
4. Result is exposed as line geometry; clipped and masked like roads or fills.

Batches may name regions in `within` / `outside` with burin's `mask_*` parameters. Pass the polygons at draw time: `burin.terrain((b) => { … }, { regions: { urban: $areas.urban } })`. draw.land rasterises each area onto the elevation grid; a hard `in` clip is still available for a clean outer edge.

**Water mask.** `burin.terrain(cb, { water: area })` hands burin a water coverage (`terrain::coverage_of`, scanline-rasterised onto the grid with 4× vertical supersampling and exact horizontal coverage, so traced coasts are smooth; `Burin.water` in the grammar) so `b.shore` / `b.water` follow that outline. Without it burin calls water whatever sits at or below 0.5 m, which misses the sea in deep Terrarium tiles at places like Big Sur (no shore, no water lines). Pass the vector-tile ocean + water for any preset that draws the sea at detail.

## Profile API

`burin.terrain(callback)` in `library.js` — callback runs in the same Boa context; errors attribute to profile lines (`drawland-script` tests).

Legacy/alternate: `lines.terrain` / grammar terrain ops where still present — prefer burin for new presets.

## Sibling repo

Implementation details and land-edge behaviour: `../burin-map` docs. draw.land depends by path; fix terrain in burin when the issue is in the engine, not in glue code.

## Related presets

Examples: `web/src/presets/city-grain.js` (`burin.terrain` on relief areas), `ink-by-elevation.js`, `engraved-sea.js`, `salt-and-stone.js` (land strokes, concentric shore, swirling `follow: "map"` currents, with a tile `water` mask).
