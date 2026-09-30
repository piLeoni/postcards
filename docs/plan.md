# Plan: postcards in Rust — penfill patterns, declarative profile, burin later

**The map stage of postcards is rewritten in Rust, and it produces SVG —
only SVG.** Work happens on the `rust-rewrite` branch. The project is Rust
only: the whole Python pipeline (map stage, vpype `optimize`,
`export_gcode`, `upload`) now lives in `reference/python/`, kept to read and
not run. There is **no binding** between the two: no PyO3, no maturin.

Anything after the SVG (path optimisation, G-code, upload) is out of scope
for now; it will be designed later, in Rust.

Order of work:

1. **Rust core with penfill.** Every area pattern comes from
   [penfill](https://github.com/piLeoni/penfill), used as a normal crate
   (`penfill` on crates.io).
2. **Declarative from the first map.** The Rust map stage is driven by a
   profile file from day one; themes are written as modules or step lists,
   not ported one-for-one from `filter_*`.
3. **Burin later, as a penfill input.**
   [burin-map](https://github.com/piLeoni/burin-map) draws terrain as an SVG;
   penfill clips it into whatever region the profile names. Nothing depends
   on burin until the profile can express it.

---

## Goals

1. **One profile file** — YAML, with JSON5 accepted for the same schema —
   describes the map frame, data sources, layers, stacking, and styles; new
   combinations need no code. YAML is the primary format: anchors and merge
   keys cover the small amount of reuse the declarative config needs.
2. **One pattern engine.** Fills are penfill calls, configured by name and
   options. The same fill spec can take a **source** (a static SVG first,
   burin later) instead of a named generator.
3. **Fast.** One OSM fetch, parallel layers, native geometry.
4. **One core, several hosts.** The same crate runs the CLI and, later, a
   browser build (WASM) that renders and downloads the SVG.

Non-goals: anything after the SVG (vpype, G-code, upload) for now; WebDAV
upload from a static page; any burin dependency before the declarative
profile; byte-identical output to the Python pipeline.

---

## Starting point (Python, now in `reference/python/`)

As documented in `reference/python/docs/pipeline.md`, roughly 5,200 lines:

- **One Overpass request** through osmnx with a fixed tag superset; each
  theme **filters in memory** on the same projected GeoDataFrame.
- Themes are **imperative Python** (`filter_*` → `LayerParts`: outlines,
  details, filling, mask). Roads is the largest (~500 lines).
- **Stacking** is generic: bottom-up order, clip each slot against masks
  above (`composition.py`). Filling is trusted once generated.
- **Styling** is partly declarative in TOML (`[fill.*]`, `[stroke.*]`).
- **Water** adds ocean tiles via watermask.
- **optimize** shells out to the vpype CLI; **export_gcode** uses vpype's
  Python API to read the SVG; **upload** is plain HTTP to FluidNC.

### What each dependency becomes

| Python | Rust |
|--------|------|
| osmnx Overpass query | same query string, sent from the CLI |
| osmnx way/relation → geometry | in-tree port of `osmnx.features` (polygon tag rules, multipolygon relations, validity repair, tag + area filter) |
| osmnx geocode (Nominatim) | same request (`search`, `format=json`, `limit=1`, `dedupe=0`) from the CLI |
| geopy geodesic (card bounds) | `geographiclib-rs` — the same GeographicLib algorithms |
| pyproj (UTM zone, EPSG:3857) | in-tree transverse Mercator (Krüger series) and spherical web Mercator; `geographiclib-rs` for the web-mercator scale |
| shapely / geopandas | `geo` (booleans and buffers via `i_overlay`) plus a few in-tree line helpers |
| `postcards/utils/fills/*`, `patterns/*` | penfill |
| watermask (Python wheel) | `watermask` crate (same Rust core) |
| pint lengths (`"6in"`, `"0.5mm"`) | small in-tree parser |

### Geometry: `geo` + `i_overlay`, penfill included

The map stage needs: many-polygon union, difference and intersection;
negative polygon buffers (buildings); line buffers with flat caps and round
joins, point disks, and buffer-out/buffer-in closing (roads); clipping and
subtracting lines against polygons (compose, details); line merge and
substrings (dashes, relation assembly); validity repair of OSM polygons.

**Decision: the `geo` crate for all of it.** Its boolean ops and buffer are
built on `i_overlay` — integer-snapped, robust on messy input, fast on the
thousands of polygons a city card unions, and pure Rust (nothing to cross-
compile for WASM). `geo` types are also the natural shape for OSM features.
It has line-vs-polygon clipping (`BooleanOps::clip`, with an invert flag for
difference) and `Buffer` with caps and joins. Line merge and substring are
not in `geo`; they are ~100 lines in core.

penfill runs on `i_overlay` too (it moved off Clipper2 in phase 2), so
core and fills share one engine and no C++ is built anywhere. Core converts
a `geo` polygon to a `penfill::Region` only at the fill call.

Fallback if `geo`'s buffer disappoints on roads: call `i_overlay`'s outline
API directly (what `geo` wraps) for that one operation.

### Projection: in-tree, no PROJ

The pipeline uses exactly two projections plus geodesics:

- **UTM** (default): the zone of the card centre, EPSG:326xx / 327xx.
  Transverse Mercator via the Krüger series (Karney 2011) — the same
  algorithm PROJ uses for `utm` — so points agree with pyproj to well
  under a millimetre on the ground, which is nothing at 1:10,000. About a
  hundred lines, testable against pyproj reference points generated from
  the Python venv.
- **Web Mercator** (EPSG:3857): spherical formulas, plus the geodesic
  metres-per-unit correction the Python code already does, via
  `geographiclib-rs`.
- **Card bounds**: geodesic direct problem (walk N/E/S/W from the centre),
  `geographiclib-rs`, same library geopy uses.

`proj4rs` (pure-Rust PROJ.4) was the alternative. It is worth it only if the
profile ever needs arbitrary CRSs; the two modes above do not.

---

## Workspace

```text
Cargo.toml                 # workspace
crates/
  postcards-core/          # no I/O: profile, planner, projection, OSM → features,
                           # geometry ops, layers, compose, SVG writer, penfill
  postcards-cli/           # the binary: HTTP (Nominatim, Overpass, ocean tiles),
                           # disk cache, subcommands map | fill
  postcards-wasm/          # later: browser host over the same core
configs/                   # profiles
reference/python/          # the former Python pipeline, read-only
```

Core stays free of network and filesystem so it builds for `wasm32`
unchanged. Hosts fetch bytes and hand them to core. The binary is still
called `postcards-rs`; it can take the plain name now that the Python CLI is
retired.

---

## penfill

Crate `penfill` **0.1** (AGPL-3.0-only; the scanline fills are a CuraEngine
port). Depend on it directly:

```toml
penfill = "0.1"
```

Contract — the one postcards fills already follow:

- Input: a `penfill::Region` in **millimetres** (outer rings and holes) plus
  `spacing`, `angle`, `seed`, and per-generator options.
- Output: `Strokes`, polylines in millimetres, each one pen-down, in draw
  order, holes respected, nothing outside the region.

`penfill::Region` (i_overlay shapes in millimetres) is used only at the fill
call; the rest of core works on `geo` geometry (see Geometry above).

### Fill spec

One shape for every fill in the profile:

```text
FillSpec
  generator: <penfill name>     # zigzag, dots, waves, grass, stipple, pat, …
  | source:  <svg source>       # an SVG to place and clip instead
  spacing, angle, seed, inset   # common knobs
  options: { … }                # generator-specific (mark, lattice, …)
```

`generator` and `source` are exclusive. A `source` is resolved to an SVG in
**card millimetres**, then penfill clips it into the region
(`svg_strokes` + `Region::clip`, or `svg_fill` for CSS-style placement). The
first source kind is `file` (a static SVG). Burin becomes a second source
kind; the schema does not change.

### Mapping today's algorithms

| postcards today | penfill | Notes |
|-----------------|---------|-------|
| `rectilinear` | `rectilinear` | same |
| `zigzag` | `zigzag` | penfill lifts the pen where a hop would leave the shape; no `connector` modes |
| `spiral` | `spiral` | same idea |
| `concentric` | `concentric` | penfill adds a centreline in thin parts |
| `hilbert` | `hilbert` | same |
| `dots` | `dots` | `mark`, `angle`; `lattice` becomes available |
| `waves` | `waves` | same |
| `grid` | `grid` | **different**: postcards = two zigzag passes; penfill = two plain hatches |
| `honeycomb` | `triangles` (closest) | **different**: postcards = three zigzags at 60°; penfill `honeycomb` draws hexagon cells |

- `connector = "boundary"` (used for buildings today) has no penfill
  equivalent. penfill's zigzag is the reference look; judge on a plotted
  card.
- `grid` / `honeycomb` mean **penfill's** geometry. The old continuous look
  is two `zigzag` fills on the same region.
- Every other penfill generator (`grass`, `wood`, `stipple`, `gravel`,
  `scales`, `pat`, …) is available from the first release.
- **Strokes are not fills.** Outline dash/dot stays in postcards core;
  penfill does not dash lines.

---

## Target architecture

```text
                    ┌─────────────────────────────────────┐
  profile ────────► │ Planner: fetch plan + layer DAG     │
                    └──────────────┬──────────────────────┘
                                   │   (host does the HTTP)
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   geocode (once)            OSM Overpass              secondary fetches
         │                   (tag union)               (ocean; elevation later)
         └─────────────────────────┬─────────────────────────┘
                                   ▼
                OSM → features → project to card mm (once)
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        module / steps      module / steps       module / steps
        (rayon)             (rayon)              (rayon)
              │    filling = penfill(region, FillSpec)  │
              └────────────────────┼────────────────────┘
                                   ▼
                          compose (stack + mask clip)
                                   ▼
                            layered SVG
                                   │
             (outside this scope: vpype optimize → gcode → upload)
```

### Internal representation

**`LayerParts`** carries over: four slots per logical theme — `outlines`,
`details`, `filling`, `mask`. Modules and step pipelines **produce**
`LayerParts`; **compose** consumes them; the **SVG writer** emits one
`<g id="theme_slot">` per non-empty slot (`parks_filling`, …). Features keep
their OSM tags so styles can select by kind.

### Two ways to define a layer

| Mechanism | Use when | User sees in profile |
|-----------|----------|----------------------|
| **`module: name/vN`** | Messy or algorithmic logic (roads; burin later) | Short block + `options` |
| **`steps:`** (primitives) | Tag select, union, buffer, assign slot, fill | Linear recipe |

**Primitives** (core builtins): `select`, `union`, `buffer`, `difference`,
`clip_to`, `polygons_to_lines`, `assign_slot`, `dash`, `fill` (penfill with
a `FillSpec`).

**Compose** is a **single declarative rule** in the profile (order +
bottom-up mask subtraction). Modules stay independent; compose cuts.

**Leftover** (the card minus the masks of every layer above) is a region a
layer can target. The planner computes it once masks exist. It is useful
without burin — any generator can fill the leftover — and it is exactly
what a future terrain layer needs.

---

## Data loading

1. **Preprocess profile** → enabled layers and modules.
2. **Union OSM tag requirements** from module manifests and `select` steps.
3. **Single Overpass query** (split only by geometry class if timeouts
   force it).
4. **Secondary fetches** declared by modules or sources (ocean tiles for
   water; elevation once a fill uses burin), in parallel with Overpass.
5. **Assemble features**: nodes, ways, and multipolygon relations to
   geometries, with the usual rule for when a closed way is an area. This is
   what osmnx does for us today, and the most likely source of differences.
6. **Project once** to card millimetres (projection, bearing, scale from
   `map`).
7. **Run layers in parallel.** penfill calls are pure and independent.
8. **Compose**, then **write SVG**.

The CLI caches raw Overpass responses on disk (as osmnx does), which also
gives the test fixtures.

---

## Profile file shape (target)

```yaml
map:        # center | address, size, scale, bearing, projection
sources:    # osm (+ elevation once burin is a source)
layers:
  - id: parks
    steps:
      - select: { leisure: [park, garden], natural: [wood, grassland] }
      - assign_slot: mask
    filling:
      generator: dots
      spacing: 0.5mm
      angle: 45
      options: { mark: 0.2mm }
    kinds:                       # per-kind FillSpec, as [fill.parks.kinds.*] today
      wood:  { generator: grass, spacing: 0.7mm }
      grass: { generator: stipple, spacing: 0.85mm }
    outline: { dash: 0.45mm, gap: 0.40mm }
  - id: water
    module: water/v1             # OSM water + ocean tiles
    filling: { generator: waves, spacing: 0.75mm }
  - id: buildings
    steps:
      - select: { building: true }
      - assign_slot: mask
      - polygons_to_lines: outlines
    filling: { generator: zigzag, spacing: 0.5mm, angle: 45 }
  - id: roads
    module: roads/v1
compose:
  order: [parks, water, roads, buildings]   # bottom-up
svg:        # units, layer naming
```

The profile only covers the map. The grammar is being redesigned in
[`profile.md`](profile.md).

Later, without a schema change:

```yaml
  - id: terrain
    region: leftover
    filling:
      source: { burin: { preset: freehand, pen_mm: 0.3 } }
```

**SVG contract** (the same as the Python pipeline's): one
`<g id="...">` per output layer, in draw order; plot-critical dashes as real
geometry; mm user space `0 0 width_mm height_mm`.

---

## Hosts

| Host | Output |
|------|--------|
| CLI (native Rust) | layered SVG |
| WASM (browser) | layered SVG, downloaded |

---

## Parity and tests

- **Fixtures from the reference.** A capture script runs the Python map
  stage and records, per case: the params (centre, size, scale, bearing,
  projection), the raw Overpass response, the ocean polygon when there is
  one, and the Python SVG. Rust tests run offline from those files. Cases:
  dense city on the coast (Ferry Building), a big park (Golden Gate Park),
  a lake in a city (Lake Merritt) — all three already in the osmnx cache.
- **Compare by layer, not by bytes.** Per SVG layer: present or absent,
  stroke count and total length within a tolerance, drawn extent. Fills are
  expected to differ (penfill vs. old Python); outlines, details and masks
  should agree closely.
- **Geometry invariants.** Fill strokes stay inside their region and out of
  holes; compose never leaves ink under a higher mask; park dabs stay
  two-point segments that the G-code scrubber keeps.
- **Projection.** Reference points from pyproj (UTM and 3857) and geopy
  (bounds) generated from the Python venv.

---

## Phased plan

### Phase 0 — Contracts and fixtures

- This document: `LayerParts`, compose rule, `FillSpec`, profile v1 shape.
- Capture the reference fixtures above from the current Python pipeline.

### Phase 1 — Parity map stage

- Cargo workspace with `postcards-core` and `postcards-cli`.
- Profile v1 (YAML / JSON5): `map`, `layers` (each a module + `FillSpec` +
  stroke style), `compose.order`, `svg`. A default profile that renders
  what `configs/fluidnc.toml` renders today.
- CLI: geocode (Nominatim), Overpass (osmnx's query, disk cache), ocean
  tiles via the `watermask` crate.
- Core: OSM → features (port of `osmnx.features`), bounds, projection,
  penfill fills, dashing, the four themes as modules (`buildings/v1`,
  `parks/v1`, `water/v1`, `roads/v1`) with the Python logic, compose, SVG.
- `postcards-rs map` writes an SVG the Python `optimize` / `gcode` accept
  as-is.

Done when the three fixtures pass the layer comparison.

**Status (branch `rust-rewrite`).** Implemented end to end:
`postcards-rs map --profile configs/postcard.yaml (--address … | --lat … --lng …)`.
Fixtures run offline from the shared `./cache`, since the Overpass query and
cache keys are identical to osmnx's. The parity tools are in
`reference/python/parity/` (SVG comparison, feature dump, pre-compose
layer stats) and `crates/postcards-cli/examples/`. Results against Python on
the three cards:

- Features: identical to osmnx (same 4105 elements and areas on the Ferry
  Building card).
- Water, roads and building outlines: within 0.3% ink length; masks
  identical or within 0.01%.
- Park outlines: within ±3%. Dash phase only: GEOS and i_overlay start rings
  at different vertices, so different dashes land under the roads.
- Building details: +1–2%. Shared walls are deduplicated by exact segment,
  and collinear walls that don't share nodes are kept twice. vpype
  `deoverlap` removes them downstream.
- Fills: they differ, as expected. penfill's zigzag insets by spacing/2 and
  leaves the smallest footprints empty (Golden Gate Park building fill is
  −53% ink).
- Time: about 6–7 s per card against about 24 s for Python.

Still open in Phase 1: capturing ocean fixtures for fully offline runs (ocean
tiles come from the watermask cache today). Stroke `none` draws nothing
(Python drew it solid).

### Phase 2 — Declarative layers

- Step primitives (`select`, `union`, `buffer`, `difference`, `clip_to`,
  `polygons_to_lines`, `assign_slot`, `dash`, `fill`).
- Planner: OSM tag union from the profile instead of the fixed superset;
  `leftover` region.
- Re-express buildings, parks, and water as steps where that reads better
  than a module; roads stays `roads/v1`.
- Parallel layers (rayon).

Done when adding a theme or changing its look is a profile edit only.

**Status.** A layer has either `module:` or `steps:`. The example
`configs/examples/steps.yaml` adds terrain, rail and piers, and rebuilds
buildings, with no code change. The step vocabulary settled on, run in order
over a working selection, area and lines:

- `select {tags, except, underground}`, `region: card | leftover`, `union`,
  `lines`, `outline [all | exterior]`.
- `buffer <len> | {distance, of: area | lines, cap: round | flat}`,
  `fill_holes`, `difference <id>`, `intersect <id>`.
- `stroke {…}` and `fill {…}` / `fill_each {…}`. Both are merged over the
  layer's `stroke` / `fill`.
- `emit outlines | details | mask`.

Unknown steps or fields are profile errors, and so are references to layers
that don't exist.

- OSM tags: the query is the standard osmnx tag set plus any key a `select`
  asks for, rather than only what the profile needs. Keeping the standard set
  keeps the query, and so the cache key, shared with osmnx and with every
  profile that adds nothing.
- Planner: a layer waits for the masks it names (`difference`, `intersect`),
  and a `leftover` layer waits for every layer above it. Ready layers run
  together (rayon) in waves. A loop or a reference to a disabled layer is a
  plan error.
- penfill: stippling `leftover` hung in `poisson_disk`. The cause is a
  Clipper2 2.0.1 bug: its miter offset breaks on turns that nearly reverse,
  like the slivers a polygon overlay leaves. A shrunk sliver came back
  hundreds of metres wide. penfill now runs on `i_overlay` instead, which
  handles those slivers; maps render about 1.8× faster, and the penfill WASM
  build needs no C++ toolchain. postcards depends on the local `../penfill`
  until both are stable enough to publish together.

Not done: the parity themes stay modules. Building inner walls, park kinds
and leftovers, and water with ocean tiles don't fit the current steps.

### Phase 3 — Retire the Python pipeline

**Done.** The whole Python pipeline, downstream stages included, moved to
`reference/python/` (last Python state committed first). It is not run or
tested. `generate.sh` runs `postcards-rs map` and writes
`exports/<slug>/map.svg`.

Next: agree on the profile grammar in [`profile.md`](profile.md) (v2:
`defs` / `draw` / `compose`) before any parser work.

### Phase 4 — WASM

- `postcards-wasm` over the same core: browser fetch for Nominatim and
  Overpass (proxy if CORS requires), render, download SVG.
- Document bundle size (penfill, projection).

### Phase 5 — burin as a penfill source

- Add `burin-map-core` to core, pinned:

  ```toml
  burin-map-core = { git = "ssh://git@github.com/piLeoni/burin-map.git", branch = "main" }
  ```

  (replace `branch` with `rev` in the same change). CI gets credentials for
  the git dependency.
- Source kind `burin`: the planner adds an **elevation** fetch for the card;
  burin draws **once per card**; the SVG is scaled into card millimetres;
  each fill that references it clips that same drawing into its region (a
  terrain layer on `leftover`, a park kind, …).
- DEM loading: burin-map's own loader in the CLI host; the browser host
  fetches elevation tiles as burin's web app does.
- Tests use burin's CPU draw on a synthetic grid; its GPU path is not
  byte-stable across machines.

---

## Decisions already made

- **postcards is Rust only and outputs SVG only.** The Python pipeline is
  kept in `reference/python/` to read. No bindings. vpype, G-code and upload
  are out of scope for now.
- **Geocoding is ported** (same Nominatim request as osmnx).
- **Geometry:** `geo` (booleans and buffers via `i_overlay`); penfill on
  `i_overlay` too.
- **Projection:** in-tree UTM (Krüger series) and web Mercator;
  `geographiclib-rs` for geodesics. No PROJ.
- **Profile:** YAML primary, JSON5 accepted, one schema.
- **Zigzag and friends:** whatever penfill draws. No old connector modes.
- **penfill is the pattern engine**, used as a Rust crate.
- **`FillSpec` has a source slot from day one**, so burin (or any SVG
  producer) plugs in without a schema change.
- **Declarative from the first Rust map.** Themes are profile entries —
  steps for simple ones, modules for roads and water — not ports of
  `filter_*`.
- **Core has no I/O**, so native and WASM share it.
- **Single OSM fetch**, layers in parallel after projection.
---

## Open questions

- **OSM validity repair:** shapely's `make_valid` has no exact `geo`
  equivalent; unioning a polygon with itself through `i_overlay` is the
  planned stand-in. Check against the fixtures.
- **After the SVG:** path optimisation, G-code and upload, in Rust, are a
  later design.
- **License:** postcards has no `LICENSE`; the binary links AGPL penfill.

---

## Related docs

- [`profile.md`](profile.md) — the profile grammar (proposal).
- [`../reference/python/docs/pipeline.md`](../reference/python/docs/pipeline.md) — the Python pipeline.
- [`../reference/python/docs/fills.md`](../reference/python/docs/fills.md) — the Python fill configuration; replaced by penfill.
- [`../reference/python/docs/roads.md`](../reference/python/docs/roads.md) — roads rules for `roads/v1`.
- penfill README — generators, `svg_fill`, `Region::clip`.
- burin-map README — for phase 7.
