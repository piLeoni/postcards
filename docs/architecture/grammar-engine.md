# Graph grammar and engine

## Purpose

`define` the contract between profile scripts and rendering: a validated DAG of operations plus draw list and composition rules.

## Key files

| File | Role |
|------|------|
| `grammar.rs` | Schema, parsing/validation, JSON serde, `Grammar` type |
| `grammar_run.rs` | Evaluate defs, run fills, apply masks, emit SVG |
| `geom.rs` | `Lines`, clipping, buffering, boolean ops on areas |
| `select.rs` | Tag selectors for OSM/tile features |

## Graph shape

Sections (typed namespaces):

- `$features` — feature sets (`osm_select`, `tiles_select`, …)
- `$areas` — `MultiPolygon<f64>` in mm (`tools_polygons`, `tools_union`, `tools_difference`, …)
- `$lines` — `geom::Lines` (`tools_rings`, `tools_clip`, module outputs, …)
- `$fills` — penfill output as lines (`tools_fill`, …)

References use `$section.name`. Operations are namespaced: `tools_*`, `osm_*`, `tiles_*`, `engine_*`, `module_*`, burin-related ops on fills/lines.

`draw`: ordered list of `{ id, from, stroke }`. `compose`: `order` of group ids, `masks` (subtract geometry from specific groups only), optional `clip`.

Script positions are stored as `at: [line, column]` for error reporting.

## Evaluation (`grammar_run`)

Waves over the dependency DAG. Each def yields a `Value`:

- `Features`, `Area`, `Lines`, `Labels` (strokes + coverage from `labels.rs`)
- `Module` — roads bundle: `area`, `outlines`, `details`, `trails`, `centerlines`, `seams`

Fills run when their input areas are known. Terrain/burin defs produce lines like any other line set.

## Modules

`module_roads` and `module_labels` are compiled recipes invoked from `$areas` or `$lines` defs. Module line outputs cannot be fed back into generic `areas.*` transforms (enforced in `library.js`).

Road drawing typically uses `roads.outlines`, `roads.centerlines`, `roads.seams`, and `roads.area` for masks.

## Compose semantics

Masks **occlude** only the group ids listed in `occludes` — not a global z-buffer. Lets a layer sit on top without punching holes through unrelated groups. Clip bounds the final SVG.

## Errors

- Load-time: unknown ops, bad references — never partial render.
- Run-time: `RunError` (plan, fill budget, def attribution).

## Testing

Heavy coverage in `grammar.rs` (parse/validate) and `drawland-script` integration tests (script → graph → render). Web presets checked by `drawland-cli` example `check_web_presets`.
