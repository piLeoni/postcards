# Scripting — profiles written in JavaScript

**Status: decided direction, nothing implemented yet.** A profile becomes a
JavaScript program that calls a library we provide; the interpreter (Boa) lives
inside the engine. Starlark is the second choice if JavaScript does not work out.
The steps are in [`scripting-roadmap.md`](scripting-roadmap.md).

## What this is

Draw.land builds a map from a **profile**: where the output sits, which map data
to read, how each layer is drawn. Today the profile is written in our own YAML
grammar ([`profile.md`](profile.md)). This document replaces that, as the format
users write, with ordinary JavaScript:

```js
const bldg = features.osm({ building: true })
const foot = areas.polygons(bldg)
draw({ id: "bldg_fill", from: fills.fill({ in: foot, pattern: "zigzag", spacing: "0.5mm", per: "feature" }) })
```

The script only **calls our library**: it declares layers and how they are
drawn. It is not a plugin system and cannot extend the engine.

## Why

The v3 grammar is a good file, but it is a small invented language a user has to
learn before drawing anything (`$` markers, section-as-type, one operation per
def), and it is drifting toward functions anyway: `$recipes` / `primitives_*`
are functions with a `from:` parameter, and v4 plans expressions. Growing YAML
into a programming language would give us a worse one than any real language.

JavaScript gives:

- **a syntax most people already know**;
- **loops, conditionals and functions**: four park kinds from one loop, a
  recipe is just a function, a style chosen by an `if`;
- **type-aware autocomplete for free**: Monaco (already the web editor) checks
  plain JS against a `.d.ts` of our library, so a beginner sees the functions,
  their arguments and allowed values, and gets told when lines are passed where
  an area goes — while typing.

Why JavaScript before Starlark: familiarity and the editor experience, which
matter most for people who have never done this. Starlark would enforce
determinism in the language itself (no `while`, no recursion, frozen values) and
has Python's syntax, but its autocomplete would be ours to build and not
type-aware. Lua was considered first; its edge (easy embedding) matters less than
these two.

## How it fits the engine

```
script.js ──(Boa + our library)──▶ operation graph ──▶ validate ──▶ run_with ──▶ SVG
                                        │
                                        └─ serialisable as JSON (presets, debug, tests)
```

- **The script builds a graph and finishes.** Library calls do not draw; they
  add nodes to the operation graph (`Op::*` in `grammar.rs`). Only when the
  script has returned does the engine validate and run the graph, unchanged
  (`grammar::validate`, `grammar_run::run_with`). The JS state never meets the
  rayon threads, so there is no `Send` question.
- **The graph is the existing grammar in JSON form.** The engine already parses
  JSON5 profiles, so the first version of the library can emit exactly that
  document and reuse the parser. Unnamed intermediates (`areas.union(foot)`) get
  generated names.
- **The interpreter is Boa**, a JavaScript engine in pure Rust: no C toolchain
  for `wasm32-unknown-unknown`, and its own playground already runs in WASM. It
  goes in the engine, so CLI and web run the same thing.
- **YAML stops being a user format.** During the transition the engine reads
  both; the presets and `configs/` move to JS; afterwards YAML survives at most
  as a readable dump of the graph.

### Example

`configs/proposal/postcard.yaml`, in part:

```js
title("Parks and buildings")
output({ lat: 37.8771, lng: -122.2562, width: "6in", height: "4in",
         scale: "1:10000", bearing: 0, projection: "webmercator" })

// Each park kind claims its area minus the kinds before it.
const dots = { pattern: "dots", spacing: "0.45mm", mark: "0.2mm", angle: 45 }
const kinds = {
  garden: { leisure: "garden" },
  park:   { leisure: "park" },
  wood:   { natural: "wood", landuse: "forest", leisure: "nature_reserve" },
  grass:  { landuse: ["grass", "meadow"], natural: "grassland" },
}
const taken = [], parkIds = []
for (const [name, tags] of Object.entries(kinds)) {
  const area = areas.difference(areas.polygons(features.osm(tags)), taken)
  draw({ id: `parks_fill_${name}`, from: fills.fill({ in: area, ...dots }) })
  taken.push(area)
  parkIds.push(`parks_fill_${name}`)
}

const bldg = features.osm({ building: true })
const dissolved = areas.union(areas.polygons(bldg))
draw({ id: "bldg_ring", from: lines.rings(dissolved), stroke: "solid" })
draw({ id: "bldg_wall", stroke: "solid",
       from: lines.clip(lines.dedupe(lines.segments(bldg)), areas.grow(dissolved, "-0.1mm")) })

compose.mask({ from: dissolved, occludes: parkIds })
```

## The output block (formerly "card")

The map is not always a postcard, so **the card becomes the output**: its place
(`lat`, `lng`), paper (`width`, `height`, `padding`, `slices`), `scale`,
`bearing`, `projection`. The rename covers the engine, the YAML key, the UI and
the docs, and comes first in the roadmap. "Output" is already used inside the
engine (`grammar::Output` is a draw target, `grammar_run::Outputs` is a run's
result); those get other names.

The UI keeps editing the output in place. The script declares it as **one literal
call**:

```js
output({ lat: 37.8771, lng: -122.2562, scale: "1:10000", bearing: 0 })
```

- If the UI finds a top-level `output({...})` with literal values, dragging,
  rotating or rescaling rewrites those literals and leaves every other byte of
  the script alone — what `doc.js` does today on the YAML `card:` block.
- If the values are computed, inside a loop, or absent, the output controls
  become **read-only**, showing what the engine resolved, with a short message
  (*"the output is computed by the script"*).

Locating the call needs a real JS parser in the page (acorn is small), not
regexes. This is a web concern only; the engine receives a resolved output.

### Everything the UI writes today

The UI writes a little more than the card; each item has a place:

| Today (YAML) | With scripts |
|---|---|
| `setCardKeys` on `card:` (drag, scale, bearing, padding) | rewrite literals in `output({...})` |
| `setCardComment`: `# terrain …` on the scale line | the same, as `// terrain …` |
| `title:` (`setTitle` on presets, `titleOf` for file names) | a literal `title("…")` call, same treatment |
| presets: `styleOf` compares the document minus title and card; loading one swaps the document and keeps lat/lng | the same, minus the `title(...)` and `output(...)` calls |

The UI never edits structure (layers, styles, masks) and does not start to.

## Sandbox

The script sees only our library: no network, no files, no page, no timers.
`Math.random` and `Date` are removed so a script always draws the same map. Boa's
runtime limits cap loop iterations and recursion, so a mistaken loop ends with
an error instead of hanging the tab. Opening someone else's profile is therefore
safe.

## Errors

Every node the library creates records the script line that created it. A
validation or run error on a node points back to that line, and the existing
Monaco markers in `Sidebar.jsx` (which read `line:column` from the engine's
message) underline it. JS syntax and runtime errors come with their own line.

## Autocomplete

One **library description** (functions, arguments, allowed values, a line of
documentation each) lives in the engine and drives both sides:

- the JS bindings Boa exposes;
- a generated `.d.ts` that Monaco's TypeScript service reads for plain JS
  (`checkJs`): completion on `.`, argument names, allowed string values, hover
  docs, parameter hints, and type errors such as lines passed where an area is
  expected.

The same `.d.ts` works in any editor for CLI users.

## Loading: presets without the interpreter

Most visitors pick a preset and move the output; they never need the
interpreter.

- **Presets are pre-run at build time**: each preset script is evaluated once
  and its graph saved as JSON. The page draws a preset from its graph.
- **The interpreter is a separate WASM module**, loaded the first time someone
  edits a script or opens their own file.
- **The output stays outside the pre-run graph**, so moving it needs no
  re-run. A script that *reads* output values (`if (output.scale > 20000)`)
  makes its graph depend on the output; the library notices the read and marks
  the graph, which then needs the interpreter after each change.

## Second choice: Starlark

If Boa disappoints (size, startup, correctness), the front end is swapped for
Starlark (Meta's Rust implementation). The library description, the graph, the
output block, errors and loading stay the same; autocomplete is a Monaco
completion provider fed by the library description instead of a `.d.ts`.

## Terramask

Terramask has its own selector vocabulary (`select`, `Filter`, `subset`,
masks, outlines, bands) and a YAML surface of its own. Once draw.land's library
settles, terramask can get the same treatment, with the same shape, so a
draw.land script names terramask layers in one idiom. Draw.land keeps reading
terramask through `crates/drawland-core/src/tiles.rs`; scripting sits above that.

## Open questions

- **Names**: `output` for the card, and new names for `grammar::Output` and
  `grammar_run::Outputs`. Namespaced (`areas.union`) or flat (`union`) library?
- **Size and startup**: Boa's compressed WASM size and time to first eval;
  measured in the spike.
- **Transition**: how long the engine keeps reading YAML; whether a YAML → JS
  converter is worth writing, or the presets are converted by hand.
- **File naming**: `.js`, or `.drawland.js` so editors pick the right `.d.ts`?
- **Graph dump**: should the UI show "what my script built" as JSON or YAML?
- **`lines.raw(points)`**: literal lines drawn by hand. Needs a new `Op`; worth
  it, or does it blur the line between profile and data?

## Related docs

- [`scripting-roadmap.md`](scripting-roadmap.md) — the steps, in order.
- [`profile.md`](profile.md) — the v3 grammar the library emits during the transition.
- [`plan.md`](plan.md) — phases; the WASM host and the core's no-I/O rule.
- `crates/drawland-core/src/grammar.rs` — the operation set (`Op::*`).
- `crates/drawland-core/src/grammar_run.rs` — the executor.
- `web/src/lib/doc.js` — in-place editing today; the model for the output literal rewrite.
- `web/src/components/CardControls.jsx` — the controls that drive it.
