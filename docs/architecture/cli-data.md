# CLI and map data

## Purpose

`drawland-cli` is the non-browser front end: geocoding, HTTP fetch, disk cache, then the same `grammar_run` as WASM.

## Entry

`crates/drawland-cli/src/main.rs` — subcommand `map`:

- Profile: `.js` (evaluate script) or `.json` (saved graph)
- Place: `--address` (Nominatim) or `--lat` / `--lng`
- `--cache` (default `cache/`), `--offline`, `--refresh`
- `--dump-graph` — print JSON and exit

`generate.sh` wraps common invocations.

## OSM / Overpass

`osm.rs` — parse Overpass JSON into `Feature`, tag matching via `select.rs`.

`osm_cache.rs` — request shaping: padded ground, cache keys, what a stored reply must cover. Shared logic with WASM (`osmRequest` / `read` on `Job`).

CLI HTTP: `drawland-cli/src/osm_http.rs`. Policy constants (endpoints, timeouts) live in `output.rs` / wasm re-exports.

## Vector tiles

`tiles.rs` — terramask integration:

- Source: `TILES` URL (OpenFreeMap planet).
- Tile set from output bounds + zoom; building layers may force deeper zoom (`MAX_BUILDING_TILES` vs `MAX_FEATURE_TILES`).
- Features tagged with `tiles:layer` (`LAYER_TAG`).
- Ocean fetch may be skipped inland when Overpass shows no coastline (`filter_selectors`).

CLI downloads via terramask's fetcher; web uses `web/src/lib/tiles.js` + `Job.readTiles`.

## Terrain tiles

Terrarium PNGs for elevation — terramask; web `terrain.js`, CLI/wasm `readTerrain` on `Job`. Consumed by `terrain.rs` / burin.

## Google fonts

CLI: `drawland-cli/src/google_fonts.rs`. Core: `google_fonts.rs`, `text.rs`. Web prefetches in `App.jsx` / `googleFonts.js` and passes bytes into the worker.

## Cache layout

Default `cache/overpass/` for Overpass bodies; geocoding under cache root. Web uses Cache Storage with similar coverage rules (see `web/README.md`).

## No I/O in core

`drawland-core` accepts in-memory features, tile bytes, and font bytes. Any new data source should either feed those buffers or extend `tiles.rs` / `osm.rs`, not add HTTP to core.
