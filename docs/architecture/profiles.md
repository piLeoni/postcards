# Profiles (JavaScript)

## Purpose

Authoring format for maps: declarative calls into the draw.land library that build a `Grammar`.

## Key files

| Path | Role |
|------|------|
| `crates/drawland-script/src/library.js` | API surface profiles call |
| `crates/drawland-script/src/lib.rs` | Boa sandbox, natives, `evaluate()` |
| `crates/drawland-script/drawland.d.ts` | Type reference for editor + docs |
| `configs/*.js` | Default CLI profiles |
| `web/src/presets/*.js` | Shipped web presets |
| `web/src/docs/examples/*.js` | Tutorial steps and lite presets shown on `/docs` (type-checked like presets) |

## Execution model

1. `library.js` is evaluated with natives (`dl.node`, `dl.fail`, …).
2. Profile source runs; each API call appends defs / draws / compose entries.
3. `evaluate` validates and returns `Grammar`. Interpreter is discarded before render.

Limits: `LOOP_LIMIT`, `RECURSION_LIMIT` in `lib.rs`. Errors format as `line N column M: …` using `SCRIPT_PATH` (`profile.js`).

## API groups (top-level)

`output`, `title`, `features`, `areas`, `lines`, `fills`, `engine`, `burin`, `ink`, `modules`, `draw`, `compose` — see `library_names()` / d.ts.

Common patterns:

- `features.tiles("buildings")` / `features.osm({ … })`
- `features.json(url, { items, lat, lng })` — points from plain JSON (a live API), fields as dotted tags
- `features.geojson(url | path | {…})` — a dataset; properties are tags, so `features.where` bands it (`configs/shaky-ground.js`, `configs/red-pencil.js`)
- `areas.polygons`, `union`, `difference`, `grow`, `buffer`, …
- `areas.move(area, [across, down])`: the area moved across the page (a cloud's shadow cast off its footprint).
- `pattern: "clouds"` (penfill `clouds.rs`): cumulus from above, a covering fill like `isoline-stack`, so `fills.cover` gives its footprint. The Cloud cover preset (`configs/karl-the-fog.js`, `web/src/presets/karl-the-fog.js`) masks City Grain under it and stipples the footprint moved down-sun as the shadow.
- `fills.fill({ in, pattern, spacing, … })`
- `modules.roads({ from, widthMode, classes, … })`, `modules.labels({ from, rules })`
- `modules.graticule({ in, step, ticks, band, gap, size, font })`: an atlas plate's meridians and parallels round a page rectangle (`.lines`), its border keys (`.keys`), and degree labels (`.labels`, `.labelArea`). The script never knows the plate's centre (the page sends lat/lng to the engine), so anything tied to the ground round a paper rectangle has to be computed in the engine, as this is; the Schoolroom atlas uses it.
- `burin.terrain((b) => …)` — burin-map-script builder; atlas stored on graph
- `compose.mask({ name, from, occludes: [draw ids…] })`
- `view({ id, at, size, lat, lng, scale }, "city-grain" | () => {…})` — another place drawn into a rectangle of the page (`configs/sixty-five-north.js`). The script crate keeps a stack of builders: a function style builds the view's graph in place; a preset name runs that preset (embedded from `web/src/presets` by `build.rs`) in a fresh interpreter. Inside a view, `output()` keeps the view's place and size over the style's own, and returns the effective spec, with the paper read into mm as `paper: { width, height }` (so `engine.scale()` and `engine.paper()` are the view's)

## Web compile path

`web/src/lib/graph.js` loads `drawland-script-wasm`, returns JSON for the engine. `outputOf` / `doc.js` may inject literal `output({…})` from editor text without re-running geometry.

`web/src/presets/graphs.json` — **CI/headless only** (`check_web_presets`, `wasm_render`), not the live app graph source.

## WASM split

- **pkg-script** — interpreter only (small, `wasm-script` profile).
- **pkg** — full engine (`drawland-wasm`).

Rebuild: `web/build-wasm.sh`.

## Authoring conventions

For substantial presets (`web/src/presets/*.js`, `configs/*.js`), follow `.cursor/rules/profile-style.mdc`:
- Group all visual constants, stroke specs, buffer widths, fill patterns, and taxonomy tables at the top (`1. PARAMETERS & STYLE PALETTE`).
- Execute feature extraction/geometry (`2`), `draw` declarations (`3`), `compose.mask` / `compose.order` (`4`), and plotter optimization (`5`) linearly below without inline magic numbers.
- One stroke width per pen; weight comes from offset double lines, never a wider stroke (`ink.width` is for print/screen styles such as the Schoolroom atlas).

## When changing the API

1. `library.js` + native bindings in `lib.rs`
2. `drawland.d.ts` (and tests that keep d.ts aligned)
3. `node web/scripts/build-reference.mjs` (the `/docs` reference; `npm test` fails until it is rerun)
4. Subsystem docs here if behaviour or contracts change; the `/docs` Concepts section (`web/src/docs/Concepts.jsx`) if the change alters how profiles are written
