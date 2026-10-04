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

- [ ] One library description in `drawland-script` (functions, arguments,
      allowed values, docs), used by the bindings.
- [ ] Generate `drawland.d.ts` from it at build time.
- [ ] Monaco: JavaScript mode, `allowJs` + `checkJs`, the `.d.ts` as an extra
      lib.

Done when: in the web editor, typing `fills.` lists the fills, `pattern:`
offers the patterns, and passing lines to `in:` is underlined.

## 7. Web: the output block, title, presets

- [ ] Locate a top-level literal `output({...})` with acorn; rewrite its
      literals in place (the `setCardKeys` cases: change, add, remove a key).
- [ ] `// terrain …` comment on the scale; `title("…")` read and written.
- [ ] Computed or missing output → read-only controls with a message.
- [ ] `styleOf` for scripts: the text minus `title(...)` and `output(...)`.
- [ ] Download and import `.js`.

Done when: drag, rotate, rescale, padding, slices, presets and title all work
on a JS document, with tests next to `doc.js`'s.

## 8. YAML out

- [ ] Presets and `configs/` rewritten in JS.
- [ ] The YAML / JSON5 grammar parser, `grammar::validate`'s reference checks
      and `doc.js`'s YAML editing deleted.
- [ ] `profile.md` replaced by the library reference (generated from the
      library description where possible).

## 9. Presets and lazy loading

- [ ] Build step: pre-run each preset, ship its graph as JSON.
- [ ] Boa split into a second WASM module, loaded on first edit or import.
- [ ] Reading output values from the script marks the graph output-dependent.

Done when: loading the page and using a preset does not fetch the interpreter;
editing the script does.

## 10. burin-map-core: expression tree and batch API

In `../burin-map`, built and tested there. Independent of steps 2–9: can
start any time.

- [ ] An expression tree with its evaluator (scalars and colours; fields,
      arithmetic, comparisons, `? :`, `&&` / `||`, `Math` functions, `lerp`,
      `clamp`, `smoothstep`, `mix`, `ramp`), replacing the string parser in
      `color_expr.rs` as the core representation. burin's own document
      strings parse into the same tree.
- [ ] A typed Rust API for building a drawing from batches, so callers do not
      go through the document.

Done when: burin's examples render the same SVG as before; burin-map's CLI,
web, Python and Node builds pass.

## 11. burin in draw.land

[`plan.md`](plan.md) phase 5, with the script as its front end.

- [ ] `burin-map-core` by path; elevation fetched for the output through
      terramask, in the CLI and in the page.
- [ ] Bindings: `burin.terrain()`, `.batch({...})` with every batch field and
      style parameter in the library description (and so in the `.d.ts`).
- [ ] burin's lines in the graph: drawn, clipped and masked like any other
      lines.

Done when: a script draws contours in a loop over elevation bands, in the CLI
and on the web.

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

## Later

- burin's expression tree on the GPU (WGSL).
- More fields in `p`: `slope`, `aspect`, `x`, `y`.
- Per-point values for burin's spacing and dash density, and penfill's
  spacing.
- burin-map's own app on JavaScript, if draw.land's library has proved itself.
- Terramask scripting, same library shape.
- `lines.raw(points)`, if it earns its place.
- Starlark front end, only if JavaScript falls short.
