# Architecture index

Compact map of draw.land. Read this first, then open **one or two** subsystem docs — not the whole folder.

## End-to-end flow

```
Profile (.js)  →  drawland-script (Boa)  →  Grammar (JSON)
       →  fetch OSM / vector tiles / terrain / fonts (CLI or web worker)
       →  grammar_run  →  layered SVG (mm)
```

See [pipeline.md](pipeline.md).

## Subsystems

| Subsystem | Doc | Primary locations |
|-----------|-----|-------------------|
| Pipeline & units | [pipeline.md](pipeline.md) | `output.rs`, `projection.rs`, `units.rs`, `profile.rs` |
| Graph & execution | [grammar-engine.md](grammar-engine.md) | `grammar.rs`, `grammar_run.rs`, `geom.rs`, `optimize.rs` |
| Profile language | [profiles.md](profiles.md) | `drawland-script/`, `drawland.d.ts`, `web/src/presets/` |
| Map data & CLI I/O | [cli-data.md](cli-data.md) | `drawland-cli/`, `osm.rs`, `tiles.rs`, `osm_cache.rs`, `geojson.rs` |
| Web & WASM | [web.md](web.md) | `web/`, `drawland-wasm/`, `drawland-script-wasm/` |
| Fills & strokes | [fills-compose.md](fills-compose.md) | `fill.rs`, `optimize.rs`, `profile.rs`, `svg.rs`, penfill |
| Isoline blob fills (design) | [isoline-blob-fills.md](isoline-blob-fills.md) | penfill (new generator), `fill.rs`, compose masks |
| Terrain (burin) | [terrain-burin.md](terrain-burin.md) | `terrain.rs`, `burin.*` in profiles |
| Labels & text | [labels.md](labels.md) | `labels.rs`, `text.rs`, `stroke_font.rs`, `google_fonts.rs`, `graticule.rs` |
| Decisions | [decisions.md](decisions.md) | Rationale that spans crates |

## External libraries (sibling repos)

penfill, terramask, burin-map — path dependencies, change in-repo when needed. Summary: `.cursor/rules/our-libraries.mdc` (not duplicated here).

## Other documentation

| Topic | Path |
|-------|------|
| Google outline fonts | [../google-font-labels.md](../google-font-labels.md) |
| Product README | [../../README.md](../../README.md) |
| Web dev notes | [../../web/README.md](../../web/README.md) |
| Legacy Python pipeline (reference only) | `reference/python/docs/` |

**Note:** `README.md` links to `docs/library.md` and `docs/plan.md`; those files are not in the tree yet. The live API reference is `crates/drawland-script/drawland.d.ts`.
