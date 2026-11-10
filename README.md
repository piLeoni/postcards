# draw.land

Turn any address into a pen-plotter postcard map. OpenStreetMap data is
fetched, projected onto the paper and drawn as distinct layers (buildings
hatched, parks dotted, water waved, roads at their real width). The output is
one layered SVG in paper millimetres; what is drawn, and how, is a short
JavaScript profile. Area patterns come from
[penfill](https://github.com/piLeoni/penfill).

Everything after the SVG (path optimisation, G-code, upload) is out of scope
for now.

## Use

The web page draws maps and carries the documentation at `/docs`: the library
reference, the profiles it runs, and where the Rust, command-line and Python
front ends stand. Start here: [`docs/library.md`](docs/library.md) is the
reference, and `crates/drawland-script/drawland.d.ts` is its exact description.

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

## Profiles

A profile is a JavaScript file that calls the draw.land library: where the
map is and on what paper (`output({...})`), which map data to read
(`features.tiles("buildings")`, `features.osm({ leisure: "park" })`), what to
make of it (`areas.*`, `lines.*`, `fills.fill`, `modules.roads()`), and how to
ink and stack it (`draw`, `compose`). The script only builds a graph; the
engine runs the graph in Rust. `configs/postcard.js` is the default; the web
page's presets are in `web/src/presets/`. [`docs/library.md`](docs/library.md)
is the reference, and `crates/drawland-script/drawland.d.ts` its exact
description (the web editor autocompletes and type-checks against it).

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
| `docs/plan.md` | The Rust rewrite: decisions, status, next phases (not in tree yet) |
| `reference/python/` | The former Python pipeline, kept to read, not run |

## Tests

```bash
cargo test
(cd web && npm test)
```

draw.land builds against sibling checkouts of its own libraries, developed
alongside it: penfill in `../penfill` (fills) and terramask in `../terramask`
(the sea, from vector tiles); burin-map in `../burin-map` comes next, for
terrain.
