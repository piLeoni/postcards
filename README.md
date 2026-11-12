# draw.land

Turn any address into a pen-plotter postcard map. OpenStreetMap data is
fetched, projected onto the paper and drawn as distinct layers (buildings
hatched, parks dotted, water waved, roads at their real width). The output is
one layered SVG in paper millimetres; what is drawn, and how, is a short
JavaScript profile. Area patterns come from
[penfill](https://github.com/piLeoni/penfill).

The profile can also prepare the strokes for the machine (merge, simplify,
sort, a hand-drawn tremble), and the web page exports the drawing as SVG, PNG,
DXF or G-code, whole, per sheet or per pen. Sending it to a plotter is left to
the plotter's own software.

## Use

The web page draws maps and carries the documentation at `/docs`: a gallery
of every preset, a tutorial that builds a map in eight steps, four presets cut
down to a page of code, the patterns drawn, and a reference generated from
`crates/drawland-script/drawland.d.ts`, the library's exact description. Its
sources are in `web/src/docs/` (see [Documentation](#documentation) below).

The command line installs from crates.io:

```bash
cargo install drawland-cli
drawland map --address "Piazza Maggiore, Bologna" -o map.svg
```

From a checkout:

```bash
./generate.sh "1730 Highland Pl, Berkeley, CA 94709"
# → exports/1730_highland_pl_berkeley_ca_94709/map.svg
```

or directly:

```bash
cargo run --release -p drawland-cli -- map --address "Piazza Maggiore, Bologna" -o map.svg
cargo run --release -p drawland-cli -- map web/src/presets/city-grain.js --lat 37.8771 --lng -122.2562
```

| Argument | Does |
|---|---|
| `profile` | The profile script (default `configs/postcard.js`), or a saved graph (`.json`) |
| `--address` / `--lat --lng` | Where; overrides the profile's `output({...})` |
| `--dump-graph` | Print the graph the profile builds, as JSON, and stop |
| `-o` | Output SVG (default `map.svg`) |
| `--cache` | Overpass / Nominatim response cache (default `cache/`; Overpass replies in `cache/overpass/`, reused by any map they cover) |
| `--offline` | Use cached responses only |
| `--refresh` | Fetch datasets again even when cached |
| `--slices` | For a card cut into sheets: `whole`, `slices` or `both` (default) |
| `--per-layer` | Also one SVG per top-level layer (a file per pen) |

## Profiles

A profile is a JavaScript file that calls the draw.land library: where the
map is and on what paper (`output({...})`), which map data to read
(`features.tiles("buildings")`, `features.osm({ leisure: "park" })`), what to
make of it (`areas.*`, `lines.*`, `fills.fill`, `modules.roads()`), and how to
ink and stack it (`draw`, `compose`). The script only builds a graph; the
engine runs the graph in Rust. `configs/postcard.js` is the default; the web
page's presets are in `web/src/presets/`. `crates/drawland-script/drawland.d.ts`
is the library's exact description: the web editor autocompletes and
type-checks against it, and the docs' reference is generated from it.

## Layout

| Path | Role |
|---|---|
| `crates/drawland-core` | The graph and its runner, projection, OSM and tiles → features, fills, compose, SVG. No I/O. |
| `crates/drawland-script` | Profile scripts: the library and its JavaScript engine (Boa), script → graph |
| `crates/drawland-cli` | The `drawland` binary: geocoding, Overpass, vector tiles, cache |
| `crates/drawland-wasm`, `drawland-script-wasm` | The engine and the script interpreter for the web page (`web/build-wasm.sh`) |
| `web/` | The web page: map, editor, presets |
| `configs/` | Profiles |
| `data/` | Address lists |
| `docs/architecture/` | Architecture index for contributors and coding agents (`AGENTS.md`) |
| `reference/python/` | The former Python pipeline, kept to read, not run |

## Tests

```bash
cargo test
(cd web && npm test)
```

draw.land builds against sibling checkouts of its own libraries, developed
alongside it: penfill in `../penfill` (fills), terramask in `../terramask`
(map tiles as polygons, the sea, elevation bands) and burin-map in
`../burin-map` (pen-and-ink terrain).

## Documentation

The `/docs` page is built from code it is checked against:

| Part | Source | Regenerate |
|---|---|---|
| Reference | `drawland.d.ts` → `web/src/docs/library-reference.json` | `node web/scripts/build-reference.mjs` (`npm test` fails when stale) |
| Tutorial, lite styles | `web/src/docs/examples/*.js` (type-checked by `npm test`) | `web/scripts/render-docs.sh examples` |
| Gallery | `web/src/presets/*.js` | `web/scripts/render-docs.sh gallery` |
| Patterns page, swatches | penfill's catalogue (`../penfill`) | `web/scripts/render-docs.sh patterns` |
| Pattern types in `drawland.d.ts` | penfill's catalogue | `cargo run -p drawland-script --example write_dts` (`cargo test` fails when stale) |

`web/scripts/render-docs.sh` with no argument draws every picture with the CLI
into `web/public/docs/` (`OFFLINE=1` draws from the cache only). Run it after a
change to the engine, a preset, or an example.
