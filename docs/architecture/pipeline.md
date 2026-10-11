# Pipeline overview

## Purpose

Turn a **place** and a **profile** into a single layered **SVG** measured in paper millimetres. Post-SVG tooling (G-code, optimisation) is out of scope.

## Stages

1. **Compile profile** — JavaScript runs in `drawland-script` (Boa). It only constructs a `Grammar`; no geometry is computed in JS.
2. **Resolve place** — Centre `(lon, lat)` from CLI flags, geocoding, or `output({ lat, lng, … })` in the profile.
3. **Download** — Whatever the graph references:
   - Overpass JSON when any def uses `osm_select` (`Job.needsOsm` / CLI equivalent).
   - Vector tiles for `tiles_select` (OpenFreeMap / terramask inside `tiles.rs`).
   - Terrarium terrain PNGs when burin terrain or `tools_terrain` is used.
   - Google font bytes when labels request `{ origin: "google", … }`.
4. **Run** — `grammar_run::run` evaluates the def DAG, then applies `draw` + `compose` (masks, clip) and writes SVG.

## Output model

`Output` (`output.rs`) holds centre, `width_mm` / `height_mm`, scale denominator, bearing, projection mode, optional `tile_zoom`. Ground extent follows from scale and paper size; `query_polygon()` drives Overpass and tile selection.

## Projection

All features end in **output mm**, **y down** (`projection.rs`):

- `utm` — UTM zone of centre (true distances; meridian convergence away from centre).
- `webmercator` — EPSG:3857 with scale tied to centre latitude (matches web map preview).
- Custom PROJ string via proj4rs (no default C deps; WASM-safe).

## Typed graph sections

Features → areas (`MultiPolygon`) / lines (`geom::Lines`) / fills (lines from penfill). Modules (roads, labels) publish multiple named outputs from one def. See [grammar-engine.md](grammar-engine.md).

## Front ends

| Front end | Compile profile | Download | Run |
|-----------|-----------------|----------|-----|
| CLI | `drawland-script::evaluate` | `drawland-cli` + terramask fetch | `grammar_run` in-process |
| Web | `drawland-script-wasm` (lazy) | `draw.worker.js` | `drawland-wasm` `Job` |

## Key invariants

- Profiles must be deterministic: sandbox strips `Date`, `Math.random`, network, and filesystem from JS.
- Geometry is computed once per def in the DAG; downstream defs read cached values.
- SVG group ids come from `draw({ id: … })`; compose masks reference those ids.
