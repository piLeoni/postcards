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
- `features.geojson(url | path | {…})` — a dataset; properties are tags, so `features.where` bands it (`configs/earthquakes.js`, `configs/geojson-overlay.js`)
- `areas.polygons`, `union`, `difference`, `grow`, `buffer`, …
- `fills.fill({ in, pattern, spacing, … })`
- `modules.roads({ from, widthMode, classes, … })`, `modules.labels({ from, rules })`
- `burin.terrain((b) => …)` — burin-map-script builder; atlas stored on graph
- `compose.mask({ name, from, occludes: [draw ids…] })`
- `view({ id, at, size, lat, lng, scale }, "city-grain" | () => {…})` — another place drawn into a rectangle of the page (`configs/postcard-france.js`). The script crate keeps a stack of builders: a function style builds the view's graph in place; a preset name runs that preset (embedded from `web/src/presets` by `build.rs`) in a fresh interpreter. Inside a view, `output()` keeps the view's place and size over the style's own, and returns the effective spec (so `engine.scale()` is the view's)

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

## When changing the API

1. `library.js` + native bindings in `lib.rs`
2. `drawland.d.ts` (and tests that keep d.ts aligned)
3. Subsystem docs here if behaviour or contracts change
