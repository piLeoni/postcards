# Roadmap — JavaScript profiles

The steps to [`scripting.md`](scripting.md), in order. Each one ends in
something that builds, passes its tests and can be merged on its own. No
compatibility layers: what JavaScript replaces is deleted. Branch:
`js-scripting`.

## 1. Card → output

The map is not always a card. Rename before the library exists, so its API
starts with the right word.

- [ ] Free the name: `grammar::Output` (a draw target) and
      `grammar_run::Outputs` (a run's result) get other names.
- [ ] Engine: `card.rs` / `Card` → `output.rs` / `Output`, and every `card`
      in `drawland-core`, `drawland-cli`, `drawland-wasm`; the YAML key becomes
      `output:` (no alias, YAML is going anyway).
- [ ] CLI flags and messages.
- [ ] Web: `CardControls.jsx`, `setCardKeys` / `setCardComment` / `cardUnit`,
      `MapView.jsx`, `App.jsx`, presets.
- [ ] Docs, configs and their comments.

Done when: `cargo test` passes, the presets and `configs/` render the same SVG
as before, the web UI drags and rescales the output.

## 2. Spike: Boa in the engine

Go / no-go for JavaScript, cheaply.

- [ ] `boa_engine` in a new `drawland-script` crate.
- [ ] Evaluate a script that calls one bound function and returns a value;
      runtime limits on; `Math.random` and `Date` removed.
- [ ] Parse an arrow function with Boa's parser and walk its AST (the basis of
      per-point functions, step 12).
- [ ] Build `drawland-wasm` with it (`web/build-wasm.sh`); measure the
      compressed size delta and the time to first eval, in the browser.

Done when: the numbers are written down here. If they are unacceptable, the
same spike with Starlark (`starlark` crate) decides whether to switch.

## 3. The graph and library v0

- [ ] Graph types: nodes refer to each other by handle; `serde` for JSON
      save / load; each node records its script line.
- [ ] `grammar_run` runs the new graph.
- [ ] Bindings: `features.osm`, `features.tiles`, `areas.*`, `lines.*`,
      `fills.fill`, `modules.roads`, `engine.ocean`, `draw`, `compose.order`,
      `compose.mask`, `compose.clip`, `output`, `title`.
- [ ] `configs/proposal/postcard.js`, written by hand.

Done when: `postcard.js` renders the same SVG as `postcard.yaml` (the last use
of the YAML path).

## 4. Errors and sandbox

- [ ] Engine errors on a node are reported at its script line, in the
      `line:column` form the web markers already read.
- [ ] JS syntax and runtime errors carry their own line.
- [ ] Tests: an infinite loop stops with an error; `fetch`, `Date`,
      `Math.random`, `require` are absent.

Done when: each error case has a test with the expected line.

## 5. CLI

- [ ] `drawland profile.js`.
- [ ] `--dump-graph` prints the graph as JSON.

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
