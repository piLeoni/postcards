# Agent instructions (draw.land)

draw.land turns OpenStreetMap data into layered pen-plotter SVGs. A **profile** (JavaScript) builds an operation **graph**; **drawland-core** downloads map data and runs the graph. The web app and `drawland` CLI share the same core (CLI does I/O; WASM does not).

## Knowledge base (read selectively)

1. Start at [`docs/architecture/INDEX.md`](docs/architecture/INDEX.md) — subsystem map and links.
2. Open **only** the subsystem doc(s) that match your task.
3. Verify behavior in **source** when docs might be stale. Code wins over docs.

| Quick pointer | Where |
|---------------|--------|
| Profile API (exact types) | `crates/drawland-script/drawland.d.ts`, `crates/drawland-script/src/library.js` |
| Graph schema & runner | `crates/drawland-core/src/grammar.rs`, `grammar_run.rs` |
| User-facing overview | `README.md` |
| Sibling libs (penfill, terramask, burin-map) | `.cursor/rules/our-libraries.mdc` |
| Google font label fix notes | `docs/google-font-labels.md` |
| Web app behaviour | `web/README.md` |

Do **not** load every architecture file for small edits. Do **not** treat `reference/python/` as runnable product code.

## Repo layout (crates)

| Crate | Role |
|-------|------|
| `drawland-core` | Graph validation, geometry, fills, compose, SVG — no network/files |
| `drawland-script` | Boa interpreter + `library.js` → graph |
| `drawland-cli` | `drawland map`: geocode, Overpass, tiles, cache |
| `drawland-wasm` | Engine bindings for the browser |
| `drawland-script-wasm` | Profile interpreter for the browser (lazy-loaded) |

`web/` — Vite/React UI, workers, presets in `web/src/presets/`. Default CLI profiles: `configs/`.

## Maintenance (substantial tasks)

When you change responsibilities, interfaces, data flow, or invariants:

1. Update the relevant `docs/architecture/<subsystem>.md` (and `decisions.md` if the rationale matters).
2. Update `docs/architecture/INDEX.md` if files were added, removed, or renamed.
3. In your final message, say which docs changed or that none were needed.

Skip doc updates for trivial fixes. Follow `.cursor/rules/knowledge-base.mdc`.

## Working style: MVP first

Try new ideas end to end on the **CLI first**: change the Rust engine (penfill
and/or `drawland-core`), write or tweak a profile in `configs/`, and render it
with `drawland map <profile>` (or `./generate.sh`) to look at the SVG. Only
once the result looks right do we carry it through `drawland-wasm`, the web
presets / UI, and penfill's Python / Node / wasm bindings. Don't widen a
change to every surface in the same step unless asked.

## Build & test

```bash
cargo test
./web/build-wasm.sh   # after changes in crates/ used by the page
(cd web && npm test)
```

After changing a sibling library (`../penfill`, `../terramask`, `../burin-map`), build and test there first, then rebuild draw.land (and WASM when affected).
