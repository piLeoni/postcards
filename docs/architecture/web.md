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
5. Google fonts (prefetched or `fetchGoogleFonts`)
6. `job.draw` — SVG streamed via callbacks; result as Blob parts plus an overview `ImageBitmap` (`lib/preview.js`) rendered onto an `OffscreenCanvas` in the worker; when the map settles (`moveend`), the worker re-renders the visible viewport slice from its recorded vector coordinates at native device-pixel resolution so zoomed-in views stay vector-sharp without parsing large SVG DOMs on the main thread

Cancel via `AbortController`; WASM trap handling avoids leaving a borrowed `Job` (see worker comments).

## Routing

`/docs` — in-app docs (`docs/Docs.jsx`), not a static file route. Map/editor stay mounted; `history.pushState` + `popstate`.

Share URLs: `lib/share.js` (fragments `#js=`, etc.).

## Presets

`lib/presets.js` lists built-in scripts. Highlighting tracks style keys from preset metadata. Saving uses `title:` from profile.

## Editor integration

`compile()` underlines errors using wasm-reported line/column. Literal `output({…})` can be parsed for map framing without full graph (`literalOutputInfo`).

## Deploy

`web/deploy.sh`, `vercel.json`. Env: `VITE_OVERPASS_URL` for proxy when public Overpass 504s in browser.

## Related

[pipeline.md](pipeline.md), [profiles.md](profiles.md), [cli-data.md](cli-data.md)
