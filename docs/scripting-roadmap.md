# Roadmap — JavaScript profiles

The steps to [`scripting.md`](scripting.md), in order. Each one ends in
something that builds, passes its tests and can be merged on its own. No
compatibility layers: what JavaScript replaces is deleted. Branch:
`js-scripting`.

## 1. Card → output

The map is not always a card. Rename before the library exists, so its API
starts with the right word.

- [x] Free the name: `grammar::Output` (a draw target) and
      `grammar_run::Outputs` (a run's result) get other names.
- [x] Engine: `card.rs` / `Card` → `output.rs` / `Output`, and every `card`
      in `drawland-core`, `drawland-cli`, `drawland-wasm`; the YAML key becomes
      `output:` (no alias, YAML is going anyway).
- [x] CLI flags and messages.
- [x] Web: `CardControls.jsx`, `setCardKeys` / `setCardComment` / `cardUnit`,
      `MapView.jsx`, `App.jsx`, presets.
- [x] Docs, configs and their comments.

Done when: `cargo test` passes, the presets and `configs/` render the same SVG
as before, the web UI drags and rescales the output.

## 2. Spike: Boa in the engine

Go / no-go for JavaScript, cheaply.

- [x] `boa_engine` in a new `drawland-script` crate.
- [x] Evaluate a script that calls one bound function and returns a value;
      runtime limits on; `Math.random` and `Date` removed.
- [x] Parse an arrow function with Boa's parser and walk its AST (the basis of
      per-point functions; done as part of step 12).
- [x] Build it for the page (`web/build-wasm.sh`); measure the compressed size
      and the time to first eval, in the browser.

Done when: the numbers are written down here. If they are unacceptable, the
same spike with Starlark (`starlark` crate) decides whether to switch.

**Numbers** (Boa 0.22 without default features; built straight away as its own
module, `drawland-script-wasm`, with the size profile `wasm-script`:
`opt-level = "z"`, fat LTO, one codegen unit):

| | raw | gzip | brotli |
|---|---|---|---|
| engine (`drawland_wasm_bg.wasm`, unchanged) | 3.82 MB | 1.22 MB | 0.84 MB |
| interpreter (`drawland_script_wasm_bg.wasm`) | 3.31 MB | 1.13 MB | 0.79 MB |
| interpreter with the plain release profile | 6.32 MB | 1.90 MB | — |

In the browser (Chrome, local server): module init 9 ms, first evaluation of
a postcard-sized script 116 ms, later ones 29 ms (a fresh context each run,
so nothing leaks between runs). Go: the cost is one more engine-sized
download, paid only by people who edit, and well under a frame per run after
the first.

Positions: a native reads the calling line from an `Error`'s `stack` (call
sites); `CallFrame::position()` lags inside functions. `ReferenceError`
carries no reliable position, so the first use of the name stands in.

## 3. The graph and library v0

- [x] Graph types: nodes refer to each other by handle; `serde` for JSON
      save / load; each node records its script line.
- [x] `grammar_run` runs the new graph.
- [x] Bindings: `features.osm`, `features.tiles`, `areas.*`, `lines.*`,
      `fills.fill`, `modules.roads`, `engine.ocean`, `draw`, `compose.order`,
      `compose.mask`, `compose.clip`, `output`, `title`.
- [x] `configs/proposal/postcard.js`, written by hand.

Done when: `postcard.js` renders the same SVG as `postcard.yaml` (the last use
of the YAML path). **Done**: byte-identical, 11.2 MB, Berkeley, offline cache.

How it came out: a handle is a def reference (`$areas.difference_7`), so the
executor runs the graph unchanged. The library (`library.js`) is plain JS
over eight natives; each op goes through the same op parser as before, so
units, patterns and their errors are shared. The graph's JSON is the op
form plus `at: [line, column]` on every def, draw and mask
(`Grammar::to_json` / `from_json`, round-trip tested).

## 4. Errors and sandbox

- [x] Engine errors on a node are reported at its script line, in the
      `line:column` form the web markers already read.
- [x] JS syntax and runtime errors carry their own line.
- [x] Tests: an infinite loop stops with an error; `fetch`, `Date`,
      `Math.random`, `require` are absent.

Done when: each error case has a test with the expected line.

## 5. CLI

- [x] `drawland profile.js`.
- [x] `--dump-graph` prints the graph as JSON.

## 6. Autocomplete

- [x] One library description in `drawland-script` (functions, arguments,
      allowed values, docs), used by the bindings.
- [x] ~~Generate `drawland.d.ts` from it at build time~~: the `.d.ts` is the
      description, kept in step by tests (below).
- [x] Monaco: JavaScript mode, `allowJs` + `checkJs`, the `.d.ts` as an extra
      lib.

Done when: in the web editor, typing `fills.` lists the fills, `pattern:`
offers the patterns, and passing lines to `in:` is underlined.

How it came out: the description *is* `crates/drawland-script/drawland.d.ts`,
written by hand, not generated; a generator would have been a second, worse
TypeScript. Tests keep it honest instead: the names it declares are exactly
the globals `library.js` defines, and its `Pattern`, `TilePreset` and
`PatName` unions are penfill's generators, terramask's presets and penfill's
built-in hatches. `Features`, `Area` and `Lines` are branded classes, so in
the editor `areas.union(lines.rings(x))` reads "Argument of type 'Lines' is
not assignable to parameter of type 'Area'" while typing; the same mistake
run is "line N column M: areas.union expects an area …, got lines".

## 7. Web: the output block, title, presets

- [x] Locate a top-level literal `output({...})` with acorn; rewrite its
      literals in place (the `setCardKeys` cases: change, add, remove a key).
- [x] `// terrain …` comment on the scale; `title("…")` read and written.
- [x] Computed or missing output → read-only controls with a message.
- [x] `styleOf` for scripts: the text minus `title(...)` and `output(...)`.
- [x] Download and import `.js`.

Done when: drag, rotate, rescale, padding, slices, presets and title all work
on a JS document, with tests next to `doc.js`'s.

## 8. YAML out

- [x] Presets and `configs/` rewritten in JS.
- [x] The YAML / JSON5 grammar parser, `grammar::validate`'s reference checks
      and `doc.js`'s YAML editing deleted.
- [x] `profile.md` replaced by the library reference (generated from the
      library description where possible).

How it came out: the engine reads graph JSON only (`Grammar::from_json`);
`profile::Format`, the `json5` crate and the CLI's YAML fallback are gone,
and `serde-saphyr` is a dev-dependency (the grammar's unit tests still write
their small graphs in YAML, converted to JSON). `grammar::validate` stays: it
checks the JSON, which can come from a saved file, and its errors now carry
script positions. `configs/postcard.js` is the CLI's default;
`configs/compare/*.yaml` were the same cards as the web presets
`full`/`mixed`/`overpass`, so they went rather than being copied. The old
`$expressions` / `~name` placeholders went too: step 12 replaces them.
[`library.md`](library.md) is written by hand from the `.d.ts`.

## 9. Presets and lazy loading

- [x] Build step: pre-run each preset, ship its graph as JSON.
- [x] Boa split into a second WASM module, loaded on first edit or import.
- [x] Reading output values from the script marks the graph output-dependent.

Done when: loading the page and using a preset does not fetch the interpreter;
editing the script does.

How it came out: `cargo run -p drawland-cli --example check_web_presets --
--write` writes `web/src/presets/graphs.json`, and without `--write` fails
when it is stale. The page keys graphs by the script with its literal
`title(...)` and `output({...})` blanked, so dragging, rescaling or renaming
reuses the graph and never needs the interpreter; the literal output simply
replaces the graph's. Scripts cannot read the output (there is no getter), so
no graph is output-dependent; a *computed* `output(...)` is the one case that
needs the interpreter for a preset-shaped script, and it makes the output
controls read-only ("output computed by the script"). The interpreter
(`web/public/pkg-script/`, 1.13 MB gzip) is fetched on the first apply or
import of an edited script.

## 10. burin-map-core: expression tree and batch API

In `../burin-map`, built and tested there. Independent of steps 2–9: can
start any time.

- [x] An expression tree with its evaluator (scalars and colours; fields,
      arithmetic, comparisons, `? :`, `&&` / `||`, the scalar functions, and
      `lerp` / `mix` between colours), replacing the string parser in
      `color_expr.rs` as the core representation. A document carries the same
      tree as JSON.
- [x] A typed Rust API for building a drawing from batches, so callers do not
      go through the document: `Batch` / `WaterBatch` / `Shoreline` builders
      and `Atlas`.

Done when: burin's examples render the same SVG as before; burin-map's CLI,
web, Python and Node builds pass. **Done**: `color_expr.rs` is gone;
`expr.rs` and `atlas.rs` replace it; 57 core tests, 3 atlas parity tests and
the CLI's 21 pass. A typed atlas and the document that says the same thing
draw the identical drawing (paths and runs equal), and a script's atlas saves
as the document's JSON.

How it came out: `Expr` is a scalar or a colour, and a scalar used as a colour
is a grey, so `color` and `width` take the same trees. `burin-map-core::script`
reads the options a JavaScript front end passes — the shape `burin.d.ts`
declares — into those batches without an interpreter, and the WASM and Node
bindings expose it; the CLI reads a script's atlas from the same `--style-json`
a document uses. Trees are written as `["lerp", "#e8dcc8", "#2a1810", "tone"]`:
compact, and the same JSON a preset saves.

## 11. burin in draw.land

[`plan.md`](plan.md) phase 5, with the script as its front end.

- [x] `burin-map-core` by path; elevation fetched for the output through
      terramask, in the CLI and in the page (Terrarium, the same tiles burin
      reads; only fetched when a def draws terrain).
- [x] `lines.terrain({ in, color, width, angle, layer, shore, …style })` in the
      library description (and so in the `.d.ts`). `color` and `width` are
      burin's own trees, through its `batch_from`.
- [x] burin's lines in the graph: drawn, clipped and masked like any other
      lines, in the CLI and on the web.
- [x] ~~`burin.terrain()` / `.batch({...})` with every batch field~~: `terrain`
      is `lines.*`, like the rest of the library, not a second namespace. The
      batch fields beyond `color`/`width`/`angle`/`layer` ride in `style` by
      burin's names. `draw` picks hatching, a fill or dots, and `where` is the
      band. Water batches are still to come.
- [x] Contours in a loop over elevation bands: `lines.contours({ from, to })`
      is a flat fill of the band, drawn as its own layer, so a loop stacks the
      belts. `where` reaches burin through its `batch_from` (terramask being
      the same tiles burin reads). Fills come back as their rings, so a belt is
      clipped and masked like any other lines.

Done when: a script draws contours in a loop over elevation bands, in the CLI
and on the web. `configs/contours.js`: hatching under seven belts, 8 groups,
both sides.

## 12. Per-point functions

- [ ] Compile `color: (p) => …` / `width: (p) => …` to burin's expression
      tree: Boa's parser, the allowed subset, constants from the script
      substituted.
- [ ] Errors at the function's line for anything outside the subset.
- [ ] `p` and the helpers typed in the `.d.ts`.

Done when: every `color_expr` / `width_expr` example in burin's `SYNTAX.md`
has a JS equivalent that renders the same, plus tests for a ternary, a `ramp`
and an error.

## 13. `postprocess`

The opt-in slow path: real JavaScript over finished lines.

- [ ] `postprocess(lines, fn)` node: lines in as `Float32Array`s, lines out
      with optional `color`, `width`, `layer`; output validated.
- [ ] Its input cached, so editing the function re-runs only the JavaScript.
- [ ] Its own progress row (`JS postprocess · <draw id>`) with lines and time,
      in the terminal and the page; a summary line when it took a noticeable
      share of the run.
- [ ] Web editor: last run time next to each `postprocess(...)` call.
- [ ] Pre-run presets that use it fall back to loading the interpreter.

Done when: a script filtering and recolouring burin lines draws in the CLI and
on the web, its time shows on its own row, and a second edit of the function
does not redraw burin.

## 14. burin-map's own page on JavaScript

The engine is already there — `burin-map-core`'s `script.rs` and `burin.d.ts`
(`burin.batch`, `burin.water`, `burin.shore`, `burin.atlas`, the expression
helpers) — built as draw.land's dependency in step 10. This step is the front
end on top of it, so burin's own app stops being YAML/JSON5/CLI only.

The gate the old "Later" line carried — *if draw.land's library has proved
itself* — is met: steps 1–11 built and tested that surface, and the bands this
step's sibling added are the first change it took in its stride.

- [x] A `js` view beside YAML / JSON5 / CLI in `web/src/lib/views.js`, its own
      Monaco language, and `detectView` reading a `.js` file.
- [x] The library the page's editor sees: `burin.*` from `burin.d.ts`, loaded
      the way draw.land loads `drawland.d.ts` (extra lib, `checkJs`), so
      autocomplete works in the page.
- [x] Run a JS document: evaluate it through `burin-map-wasm` into an `Atlas`,
      draw it, and show it — the same draw the other views drive, so presets,
      progress rows and the pan/zoom overlay are unchanged.
- [x] A JS preset, so a fresh page has a living example (the `contours` preset,
      written as a loop over `burin.batch`).
- [x] The CLI view's `--` flags and the YAML model stay working: the three
      existing views are the shape of the same document, and JS is a fourth
      spelling of it, not a replacement.

Done: burin-map's page opens on a JavaScript document, autocompletes against
`burin.d.ts`, draws it, and the YAML/JSON5/CLI views still work. The
interpreter is `burin-map-script` over Boa, its own WASM module loaded only
when a document runs; `evaluate` returns the atlas JSON, and the page turns
that into its model. Two script presets ship with it (Contour belts, Scripted
hills). `burin-map-core`'s `band_of` and a water pass's `where` now read both
the script's camelCase and the saved snake_case, so a saved atlas reads back.

## Later

- burin's expression tree on the GPU (WGSL).
- More fields in `p`: `slope`, `aspect`, `x`, `y`.
- Per-point values for burin's spacing and dash density, and penfill's
  spacing.
- Terramask scripting, same library shape.
- `lines.raw(points)`, if it earns its place.
- Starlark front end, only if JavaScript falls short.
