# Roadmap — JavaScript profiles

The steps to [`scripting.md`](scripting.md), in order. Each one ends in
something that builds, passes its tests and can be merged on its own. Branch:
`js-scripting`.

## 1. Card → output

The map is not always a card. Rename before the scripting library exists, so
its API starts with the right word.

- [ ] Free the name: `grammar::Output` (a draw target) and
      `grammar_run::Outputs` (a run's result) get other names.
- [ ] Engine: `card.rs` / `Card` → `output.rs` / `Output`, and every `card`
      in `drawland-core`, `drawland-cli`, `drawland-wasm`.
- [ ] Profile: the YAML key `card:` → `output:`; `card:` still read, with a
      deprecation warning, until the YAML transition ends.
- [ ] CLI flags and messages.
- [ ] Web: `CardControls.jsx`, `setCardKeys` / `setCardComment` / `cardUnit`,
      `MapView.jsx`, `App.jsx`, presets.
- [ ] Docs: `profile.md`, `plan.md`, configs and their comments.

Done when: `cargo test` passes, the presets and `configs/` render the same SVG
as before the rename, the web UI drags and rescales the output.

## 2. Spike: Boa in the engine

Go / no-go for JavaScript, cheaply.

- [ ] `boa_engine` behind a `script` feature in `drawland-core`.
- [ ] Evaluate a script that calls one bound function and returns a value;
      runtime limits on; `Math.random` and `Date` removed.
- [ ] Build `drawland-wasm` with it (`web/build-wasm.sh`); measure the
      compressed size delta and the time to first eval, in the browser.

Done when: the numbers are written down here. If they are unacceptable, the
same spike with Starlark (`starlark` crate) decides whether to switch.

## 3. Library v0: emit the grammar

The library builds the existing grammar document; the existing parser,
validation and executor take it from there.

- [ ] Bindings: `features.osm`, `features.tiles`, `areas.*`, `lines.*`,
      `fills.fill`, `modules.roads`, `engine.ocean`, `draw`, `compose.order`,
      `compose.mask`, `compose.clip`, `output`, `title`.
- [ ] Generated names for unnamed intermediates; every node records its script
      line.
- [ ] `drawland-core` entry point: script text → grammar → `run_with`.
- [ ] `configs/proposal/postcard.js`, written by hand.

Done when: `postcard.js` and `postcard.yaml` render identical SVG.

## 4. Errors and sandbox

- [ ] Engine errors on a node are reported at its script line, in the
      `line:column` form the web markers already read.
- [ ] JS syntax and runtime errors carry their own line.
- [ ] Tests: an infinite loop stops with an error; `fetch`, `Date`,
      `Math.random`, `require` are absent.

Done when: each error case has a test with the expected line.

## 5. CLI

- [ ] `drawland profile.js` next to `drawland profile.yaml`.
- [ ] `--dump-graph` prints the grammar the script built.

Done when: the CLI renders `postcard.js`.

## 6. Autocomplete

- [ ] One library description in the engine (functions, arguments, allowed
      values, docs), used by the bindings.
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
- [ ] Download saves `.js`; import takes `.js` and `.yaml`.

Done when: drag, rotate, rescale, padding, slices, presets and title all work
on a JS document, with tests next to `doc.js`'s.

## 8. Presets and lazy loading

- [ ] Presets converted to JS.
- [ ] Build step: pre-run each preset, ship its graph as JSON.
- [ ] Boa split into a second WASM module, loaded on first edit or import.
- [ ] Reading output values from the script marks the graph output-dependent.

Done when: loading the page and using a preset does not fetch the interpreter;
editing the script does.

## 9. Retire YAML as a user format

- [ ] `configs/` converted to JS.
- [ ] `profile.md` rewritten as the library reference (or generated from the
      library description).
- [ ] Decide: drop YAML input, or keep it read-only for old files.

## Later

- `lines.raw(points)`, if it earns its place.
- Terramask scripting, same library shape.
- Starlark front end, only if JavaScript falls short.
