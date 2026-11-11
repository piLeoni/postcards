# Graph grammar and engine

## Purpose

`define` the contract between profile scripts and rendering: a validated DAG of operations plus draw list and composition rules.

## Key files

| File | Role |
|------|------|
| `grammar.rs` | Schema, parsing/validation, JSON serde, `Grammar` type |
| `grammar_run.rs` | Evaluate defs, run fills, apply masks, run `compose.optimize`, emit SVG |
| `geom.rs` | `Lines`, clipping, buffering, boolean ops on areas |
| `optimize.rs` | Post-masking plotter path optimization (`deoverlap`, `linemerge`, `simplify`, `filter`, `reloop`, `orient`, `linesort`) and the hand-drawn look (`hand` → `penfill::hand`) |
| `select.rs` | Tag selectors for OSM/tile features |

## Graph shape

Sections (typed namespaces):

- `$features` — feature sets (`osm_select`, `tiles_select`, `data_select`, …)
- `$areas` — `MultiPolygon<f64>` in mm (`tools_polygons`, `tools_union`, `tools_difference`, …)
- `$lines` — `geom::Lines` (`tools_rings`, `tools_clip`, module outputs, …)
- `$fills` — penfill output as lines (`tools_fill`, …)

References use `$section.name`. Operations are namespaced: `tools_*`, `osm_*`, `tiles_*`, `engine_*`, `module_*`, burin-related ops on fills/lines.

`draw`: ordered list of `{ id, from, stroke }`. `compose`: `order` of group ids, `masks` (subtract geometry from specific groups only), optional `clip`.

Script positions are stored as `at: [line, column]` for error reporting.

## Evaluation (`grammar_run`)

Waves over the dependency DAG. Each def yields a `Value`:

- `Features`, `Area`, `Lines`, `Labels` (strokes + coverage from `labels.rs`)
- `Module` — roads bundle: `area`, `outlines`, `details`, `trails`, `centerlines`, `seams`, `rails` (`themes/roads.rs`; trails and rails are single lines whose strip joins `area`, present only when the input features include them)

Fills run when their input areas are known, normally in their own group during compose (streamed, a batch at a time). A fill that another def reads — `areas.buffer(hatch, …)` for a clearance round a pattern — is also made whole in the def waves (`eval_op`, `Op::Fill`), so that def can use its strokes; the group still draws it as usual. Terrain/burin defs produce lines like any other line set.

## Modules

`module_roads` and `module_labels` are compiled recipes invoked from `$areas` or `$lines` defs. Module line outputs cannot be fed back into generic `areas.*` transforms (enforced in `library.js`).

Road drawing typically uses `roads.outlines`, `roads.centerlines`, `roads.seams`, and `roads.area` for masks.

## Compose semantics

Masks **occlude** only the group ids listed in `occludes` — not a global z-buffer. Lets a layer sit on top without punching holes through unrelated groups. Clip bounds the final SVG.

When `compose.optimize` steps (`compose.deoverlap`, `compose.linemerge`, `compose.simplify`, `compose.filter`, `compose.reloop`, `compose.orient`, `compose.linesort`) are present, `grammar_run::compose` collects masked and sheet-cropped strokes per layer, runs `optimize::run_pipeline` in sequence (recording progress/timing tasks under `optimize`), and then emits the separate `<g id="…">` layers in compose order. `compose.hand(layers, { preset: "steady" | "sketch", wobble, tremor, bow, overshoot, close, reach, corners, seed, … })` is a step in the same sequence (`OptimizeOp::Hand`, `HandSpec::params`): it redraws strokes via `penfill::hand`. Call it after `linemerge`/`simplify` (so a street is a few long strokes, not one per OSM way, and simplify doesn't erase the tremor) and before `orient`/`linesort`. Use one `seed` across calls so strokes meeting in different layers tremble together. CLI-only for now: the web build needs a wasm rebuild before presets can use it (`configs/napkin-sketch.js` is the first user).

Layers oriented by `compose.orient` (or `compose.linesort({ direction })`) preserve their stroke directions (`follow: true`) in subsequent `linesort` passes.

## Errors

- Load-time: unknown ops, bad references — never partial render.
- Run-time: `RunError` (plan, fill budget, def attribution).

## Testing

Heavy coverage in `grammar.rs` (parse/validate) and `drawland-script` integration tests (script → graph → render). Web presets checked by `drawland-cli` example `check_web_presets`.

## Views (composite pages)

A graph may carry `views` (`Grammar::views`, JSON `views: [{ id, at, graph }]`): other places, each a whole graph with its own `output` (place, scale, and the rectangle's size), drawn into a rectangle of the page at `at` (mm). `grammar_run::run_graph` runs each view in *collect* mode (`compose` hands back `(id, stroke, lines)` instead of writing; flat-colour fills are skipped with a warning), moves the strokes to the rectangle, cuts them with every page mask whose `occludes` names the view's id, and writes them under the page's own groups. Groups with the same id across views merge into one group (one pen). A view with `ink` (`View::ink`) is recoloured whole and written as one group named after the view: a pen of its own. `Inputs::views` carries each view's own features, tiles, terrain and fonts, in order. The page's own rows are opened after the views run, since a view's rows share their names.
