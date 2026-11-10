# Web application

## Purpose

Interactive map + profile editor; preview and download SVG using the same engine as the CLI.

## Stack

- Vite + React (`web/src/App.jsx`)
- Jotai (`lib/store.js`) for editor document state
- MapLibre (`MapView.jsx`) — OpenFreeMap Positron, no token
- Two WASM packages under `web/public/pkg` and `web/public/pkg-script`

## Threads

| Component | Role |
|-----------|------|
| Main | UI, map, compile profile to graph JSON, font prefetch |
| `draw.worker.js` | Download + `Job` render; streams progress events |
| `plan.worker.js` | Tile planning when output frame moves (debounced) |

`loadDrawland()` (`lib/drawland.js`) imports engine WASM; exposes `memory` for fill budget ceiling.

## Draw sequence (worker)

1. `new engine.Job(graph, lat, lng)`
2. If `needsOsm` — `fetchOverpass` → `job.read`
3. `fetchTiles` → `job.readTiles`
4. `fetchTerrain` → `job.readTerrain`
5. GeoJSON datasets (`features.geojson`): `fetchDatasets` (`lib/datasets.js`) reads `job.datasets`, fetches URLs (Cache Storage, 15 min) or takes dropped files posted with the draw, and calls `job.addDataset`
6. Google fonts (prefetched or `fetchGoogleFonts`)
7. Stroke fonts for labels/`lines.text` — catalog ids and `{ origin: "stroke", url }` (`strokeFontKeys` / `loadStrokeFontsForGraph` on main thread, or `fetchStrokeFonts` in worker; `job.addStrokeFont`). Catalog GitLab URLs in the graph are fetched from bundled copies under `web/public/fonts/` (`strokeFontUrls.js`); CLI still downloads from GitLab.
8. `job.draw` — SVG streamed via callbacks; result as Blob parts plus an overview `ImageBitmap` (`lib/preview.js`) rendered onto an `OffscreenCanvas` in the worker; when the map settles (`moveend`), the worker re-renders the visible viewport slice from its recorded vector coordinates at native device-pixel resolution so zoomed-in views stay vector-sharp without parsing large SVG DOMs on the main thread

Cancel via `AbortController`; WASM trap handling avoids leaving a borrowed `Job` (see worker comments).

## Routing

`/docs` — in-app docs (`docs/Docs.jsx`), not a static file route. Map/editor stay mounted; `history.pushState` + `popstate`.

Share URLs: `lib/share.js` (fragments `#js=`, etc.).

## Presets

`lib/presets.js` lists built-in scripts. Choosing one — from the card's style picker or the sidebar's preset menu — loads it whole (`loadDoc` in `App.jsx`): its place, scale and paper, the map moved and fitted to it, then drawn. The sidebar's "inject here" keeps the current place instead, except for a preset with `ownPlace: true` (a world map, a dataset's city, a postcard of views), which always loads whole. The map's `minZoom` is 0 and `MapView` passes its own `transformConstrain` (any zoom, latitude kept within ±85°): MapLibre's default, with `renderWorldCopies` off, kept the world at least as wide as the window, so a world card (`earthquakes`) could never be zoomed out to fit.

## Views (composite pages)

A graph with `views` (`view(...)`: Bonjour de France, `postcard-france`) is drawn the way the CLI draws it. After the page's own downloads, `gatherViews` in `draw.worker.js` makes a `Job` for each `views[i].graph` at its own place, runs the same pipeline on it (Overpass, tiles, terrain, datasets, Google and stroke fonts), and hands it to the page job with `job.addView(sub)` (wasm moves its inputs out; the sub-job is used up). Each view's progress rows are emitted with ids prefixed `view:<id>:` under a `view <id>` row, so they never collide with the page's. Built-in presets a view names are embedded in the script interpreter (`drawland-script/build.rs`).

## GeoJSON import

A `.geojson`/`.json` dropped anywhere on the page (`App.jsx`) is kept in memory by file name (`importedDatasets`, lost on reload) and posted to the worker with each draw. If the script already reads `features.geojson("<name>")` it is redrawn; otherwise the `geojson-overlay` preset opens with `DATA` set to the file, its output framed to the data's extent (`frameBounds`: centre, rounded scale, tile zoom). Highlighting tracks style keys from preset metadata. Saving uses `title:` from profile.

## Editor integration

`compile()` underlines errors using wasm-reported line/column. Literal `output({…})` can be parsed for map framing without full graph (`literalOutputInfo`).

## Export, G-code & DXF (`lib/download.js`, `lib/gcode.js`, `lib/dxf.js`)

`DownloadModal.jsx` exports the drawn SVG as `.svg`, `.png`, or plotter G-code (`.gco` / `.gcode`), or `.dxf`, whole or per-slice, combined or one file per top-level `<g id>` layer. `lib/gcode.js` implements `vpype-gcode` (`[gwrite.<profile>]` and `[gwrite.<profile>.default_values]`) TOML parsing, Python-style `{var}` / `{var:.3f}` template formatting, coordinate transforms (`vertical_flip`, `bed_width`, `bed_height`, optional fit-to-bed margin), and live bed bounds diagnostics (`components/GcodeConfig.jsx`, persisted in `gcodeConfigAtom` in `lib/store.js`). `lib/dxf.js` writes AutoCAD R12 ASCII DXF (mm, Y flipped upright) from the same `extractSvgGeometry` strokes; each top-level layer becomes a DXF layer.

## Deploy

`web/deploy.sh`, `vercel.json`. Env: `VITE_OVERPASS_URL` for proxy when public Overpass 504s in browser.

## Related

[pipeline.md](pipeline.md), [profiles.md](profiles.md), [cli-data.md](cli-data.md)
