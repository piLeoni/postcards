# Architectural decisions

Short rationale for choices that are easy to misread from code alone. Add entries when the team makes a durable change; link to subsystems for detail.

## Profile builds a graph, engine runs it

JavaScript never holds geometry. Keeps WASM bundle strategy sane (interpreter separate from engine) and lets CLI dump/load JSON graphs.

## Two WASM modules on the web

Engine is always loaded; interpreter only when the user edits/runs a script (`wasm-script` profile, size-optimised). See [web.md](web.md).

## Vector tiles default; Overpass optional

Tiles are fast CDN fetches with OpenMapTiles classes; Overpass retained for tags tiles lack and for comparison presets. Tile logic centralized in terramask + `tiles.rs`.

## Sibling libraries by path

penfill, terramask, burin-map evolve with draw.land; registry versions are not the source of truth in this monorepo layout. Policy: `.cursor/rules/our-libraries.mdc`.

## Compose masks target group ids

Occlusion is per draw id list, not automatic painter's order only. Presets can punch holes (roads through parks) without global subtraction.

## Projection modes

`webmercator` aligns SVG with the MapLibre preview; `utm` is for survey-true local plots. Custom PROJ strings supported where proj4rs can compile without C (WASM).

## Deterministic profiles

No randomness, time, or network in the sandbox — same script + same inputs → same SVG.

## Core has no I/O

All HTTP and filesystem live in CLI or browser workers; WASM `Job` receives bytes. Simplifies testing and parity between front ends.

## User docs are generated or checked, never transcribed

The `/docs` page drifted for months when it was hand-written prose (patterns listed by hand, files linked that never existed). Now the reference is generated from `drawland.d.ts`, every example is a real profile that `npm test` type-checks, and every picture is drawn by the CLI (`web/scripts/render-docs.sh`). Prose stays where only prose works (tutorial, concepts). See [web.md](web.md#docs-srcdocs).
