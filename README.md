# draw.land

Turn any address into a pen-plotter postcard map. OpenStreetMap data is
fetched, projected onto the card and drawn as distinct layers (buildings
hatched, parks dotted, water waved, roads at their real width). The output is
one layered SVG in card millimetres. Area patterns come from
[penfill](https://github.com/piLeoni/penfill).

Everything after the SVG (path optimisation, G-code, upload) is out of scope
for now.

## Use

```bash
./generate.sh "1730 Highland Pl, Berkeley, CA 94709"
# → exports/1730_highland_pl_berkeley_ca_94709/map.svg
```

or directly:

```bash
cargo run --release -p drawland-cli -- map --address "Piazza Maggiore, Bologna" -o map.svg
cargo run --release -p drawland-cli -- map --lat 37.8771 --lng -122.2562 --profile configs/examples/steps.yaml
```

| Flag | Does |
|---|---|
| `--profile` | Profile file, YAML or JSON5 (default `configs/postcard.yaml`) |
| `--address` / `--lat --lng` | Where; overrides the profile's `map` block |
| `-o` | Output SVG (default `map.svg`) |
| `--cache` | Overpass / Nominatim response cache (default `cache/`; Overpass replies in `cache/overpass/`, reused by any card they cover) |
| `--offline` | Use cached responses only |

## Profiles

A profile describes the card (size, scale, bearing, projection) and its
layers: which OSM features each layer draws, and how (outline, details,
fill). `configs/postcard.yaml` is the default card;
`configs/examples/steps.yaml` builds layers from step lists instead of
modules. [`docs/profile.md`](docs/profile.md) is the profile grammar.

## Layout

| Path | Role |
|---|---|
| `crates/drawland-core` | Profile, planner, projection, OSM → features, layers, compose, SVG. No I/O. |
| `crates/drawland-cli` | The `drawland` binary: geocoding, Overpass, vector tiles, cache |
| `configs/` | Profiles |
| `data/` | Address lists |
| `docs/plan.md` | The Rust rewrite: decisions, status, next phases |
| `reference/python/` | The former Python pipeline, kept to read, not run |

## Tests

```bash
cargo test
```

draw.land builds against sibling checkouts of its own libraries, developed
alongside it: penfill in `../penfill` (fills) and terramask in `../terramask`
(the sea, from vector tiles); burin-map in `../burin-map` comes next, for
terrain.
