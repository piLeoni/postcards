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

1. Terramask supplies elevation grid (Terrarium) for output bounds.
2. Profile builds a burin atlas (batch style, water, coast, etc.) via JS callback.
3. `terrain.rs` maps burin pixels to output mm (`Grid`, `Placed`, default width `WIDTH_PX`) and calls `Atlas::draw` on a [`Surface`](../../burin-map/docs/regions.md) (elevation, `px_m`, optional named regions).
4. Result is exposed as line geometry; clipped and masked like roads or fills.

Batches may name regions in `within` / `outside` with burin's `mask_*` parameters. Pass the polygons at draw time: `burin.terrain((b) => { … }, { regions: { urban: $areas.urban } })`. draw.land rasterises each area onto the elevation grid; a hard `in` clip is still available for a clean outer edge.

## Profile API

`burin.terrain(callback)` in `library.js` — callback runs in the same Boa context; errors attribute to profile lines (`drawland-script` tests).

Legacy/alternate: `lines.terrain` / grammar terrain ops where still present — prefer burin for new presets.

## Sibling repo

Implementation details and land-edge behaviour: `../burin-map` docs. draw.land depends by path; fix terrain in burin when the issue is in the engine, not in glue code.

## Related presets

Examples: `web/src/presets/city-grain.js` (`burin.terrain` on relief areas), `ink-by-elevation.js`, `engraved-sea.js`.
