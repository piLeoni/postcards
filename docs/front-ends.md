# Front ends and the document model

Where the scripting work stands across draw.land and burin-map, and the shape
it should take. Written after the first pass at burin-map's JS view, which was
right about the interpreter and wrong about almost everything around it.

## The idea

Two different jobs were being conflated:

1. **Describing a style.** Flat data: these parameters, this colour, this
   angle. Any format can hold it — it is a dictionary.
2. **Building a document.** Logic: loops, conditions, functions, "a belt for
   every 100 m", "union these areas". This is code.

YAML (and JSON5) can only do the first. `draw.land` outgrew it: once a
document needs a loop, the data format becomes a bad programming language. So
the flat formats go away — **in both projects** — and a document is written in
a real language.

But the engine never sees the language. By the time anything draws, what the
engine reads is one thing: **a graph of typed operations**. The interpreter is
a front end that emits that graph. That is already true today.

    Rust API   ─┐
    Python     ─┤
    JS         ─┼─▶  the document graph  ─▶  engine  ─▶  SVG / PNG
    (Starlark) ─┘     (typed ops, JSON)

**The document is one typed graph. Languages are front ends that emit it.**
The engine neither knows nor cares which one you used.

Consequences:

- A **Rust** user builds the graph with the typed API. No interpreter.
- A **CLI** user runs a script, or a saved graph. No browser language forced.
- A **web** user edits a script; the interpreter is a module loaded only when a
  script runs, and only the language in use is downloaded.
- **Nothing programmatic requires JavaScript.** JS is the web UI's front end
  because that is what runs in a browser — not the universal format.

## The stack, not the sisters

The three libraries are a chain, not peers:

    terramask    tiles → polygons and elevation grids        (data in)
    burin-map    a surface → engraved marks (lines, dots)    (marks out)
    draw.land    marks → a designed output (postcard, plan)  (a deliverable)

- **burin-map stands on its own.** It has a CLI, Python, Node, a web page, its
  own vocabulary, and independent users who want *only* pen-and-ink terrain. It
  is a tool, not a module.
- **draw.land depends on it** (already true, by path). The lower, more generic
  layer is the dependency of the higher, more specific one.
- **Do not merge burin-map into draw.land.** It would trap burin's future (for
  example generating vector graphics from satellite imagery — another way to
  fill the field burin engraves, which belongs *inside* burin and should reach
  its own users), and would force anyone who wants only terrain to take all of
  draw.land.

The real duplication is **not** the engines. It is the **front-end layer**:
today there are two `library.js`, two `.d.ts`, two script crates, two preset
systems. That is the weight to remove — by sharing the front-end machinery, not
by merging the projects.

## What already exists (accurate as of this writing)

**draw.land — essentially the target shape.**
- CLI `load()`: a `.js` profile is run through `drawland_script::evaluate`;
  a `.json` file is read back as a `Grammar`. `configs/postcard.js` is the
  default. So "script in, graph out" is already implemented.
- Web: **JS only**. Presets are real files (`web/src/presets/*.js?raw`), shown
  in the editor, with their graph precomputed into `presets/graphs.json`.
- The interpreter is a separate WASM module (`public/pkg-script`), loaded only
  when a script runs.
- `drawland-core` depends on `burin-map-core`, and reaches terrain through
  `lines.terrain` / `lines.contours`.

**burin-map — the interpreter is right, the rest is not.**
- `burin-map-script` (over Boa) + `burin-map-script-wasm`: the interpreter,
  sandboxed, returning atlas JSON, errors with line/column. **Good, keep.**
- `burin-map-core::script`: typed `Batch`/`WaterBatch`/`Shoreline`/`Atlas` with
  `atlas_from`/`atlas_to_json`. **This is the source of truth.** Keep.
- `burin-map-core::script::band_of` and a water pass's `where` now read both the
  script's camelCase (`elevMin`) and the saved snake_case (`elev_min`), fixing a
  round-trip bug that also affected draw.land. **Keep — it is a real fix.**
- **CLI still reads only `--style-file` / `--style-json`** (JSON5/YAML). There
  is **no `--script`**. This is the biggest gap.
- **Node/Python bindings expose `batch`/`atlas` as data constructors** — they
  read a value a script already produced, they do not run a script. That is the
  "describe a style from Python" model that is being retired.
- **Web: four views (YAML / JSON5 / CLI / JS).** Added in `ae715a9`. Wrong in
  shape: a fourth tab beside the others, a `burin.atlas()` builder the other
  languages do not have, and a model↔atlas conversion layer (`renderJs`,
  `atlasToModel`) that must know every field and is already a source of bugs.

## The rule that was missed

Adding JS as a **fourth view** treats the formats as parallel, user-facing
choices, so every one needs a parser and they must stay in sync. That is the
brittleness. The formats are **interchangeable front ends**, of which the web
app should ship **one**. Two parsers for one document is the tax; it buys
nothing.

## Target shape

**burin-map**
- CLI gains `--script PATH` (`.js`), running `burin-map-script::evaluate` into
  an atlas and drawing it — the same shape as drawland's `load()`. `--style-file`
  stays for a while as an escape hatch, not the main path.
- Node/Python bindings gain `evaluate(script) → atlas JSON`, so they are front
  ends too, not data constructors.
- Ship **template scripts** under `presets/` (with one sensible default), used
  by both the CLI and the web page, the way drawland ships `configs/`.
- **Web: JS only.** Delete the YAML/JSON5/CLI views, `views.js`, and the
  model↔atlas layer. Presets are real script files shown in the editor.
- **Drop `burin.atlas()`.** Bare calls, matching drawland's shape:
  `burin.batch({…})`, `burin.water(…)`, `burin.shore(…)`, then `burin.draw()`.

**draw.land**
- Already right. Confirm it consumes burin's graph through the **Rust API**
  (`burin-map-core` typed batches), not through any format.

**Shared front end (later, the real de-duplication)**
- One crate/package for what `drawland-script` and `burin-map-script` both
  reinvent: the interpreter host over Boa, the sandbox, the error positions, the
  `.d.ts` generation, the Monaco/editor wiring, the preset mechanism. The
  language libraries (`drawland.*`, `burin.*`) stay engine-specific and sit on
  top of it.

**Python on the web**
- Not now. Ship Python as a binding/CLI front end. If it later earns a browser
  place, it is a second lazily-loaded WASM module (`pkg-script/py`), selected at
  runtime; the page downloads only the language in use. Never load three
  interpreters upfront.

## Order of work

1. **burin-map CLI `--script`** — closes the biggest real gap, makes the two
   projects symmetric at the command line.
2. **burin-map web: JS only** — delete the views, the model layer, and
   `burin.atlas()`; presets become script files.
3. **Node/Python bindings** — `evaluate(script)`, front ends not constructors.
4. **Shared front-end crate** — extract what the two script crates duplicate.
5. **draw.land** — verify it reads burin's graph via the Rust API.

Steps 1 and 2 are the ones that remove the mess that exists today. 4 is the one
that stops it recurring.

## Not to do

- Do not revert `burin-map-script`, the WASM split, or the `band_of` fix. The
  interpreter is right; only its presentation was wrong.
- Do not merge burin-map into draw.land.
- Do not build a Python *browser* front end before one is asked for.
- Do not keep a flat data format as a first-class document anywhere.
