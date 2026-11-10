# CLI and map data

## Purpose

`drawland-cli` is the non-browser front end: geocoding, HTTP fetch, disk cache, then the same `grammar_run` as WASM.

## Entry

`crates/drawland-cli/src/main.rs` — subcommand `map`:

- Profile: `.js` (evaluate script) or `.json` (saved graph)
- Place: `--address` (Nominatim) or `--lat` / `--lng`
- `--cache` (default `cache/`), `--offline`, `--refresh`
- `--dump-graph` — print JSON and exit
- SVG export: `--decimals <0..6>`, `--per-layer`, `--slices <whole|slices|both>` (`sheets::export_svg_files`)

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

## GeoJSON and JSON datasets

`features.json(url, { items, lat, lng })` compiles to `data_select: { json: { url, items, lat, lng } }` (`DataSource::Json`): plain JSON fetched and cached exactly like a GeoJSON URL (it is in `Grammar::datasets()`), then turned into points by `geojson::features_from_json` — dot-paths to the item array and each item's position, every other field a tag under its dotted path. First user: `configs/boston-live.js` (MBTA vehicles).


`features.geojson(source)` compiles to `data_select`. A string source (URL or file path) is listed by `Grammar::datasets()`; the host reads each one and passes the text as `Inputs::data`, keyed as written. An inline object (`{ geojson: {…} }`) lives in the graph and needs no host.

- Core: `geojson.rs` turns GeoJSON into `Feature`s (`Element::Data`) in lon/lat: `properties` become tags (numbers written out, `null` dropped), and a point's third coordinate becomes the tag `geom:z` (a quake's depth). The runner projects them like the tiles; a missing dataset is a plan error.
- CLI: `read_datasets` in `main.rs`. URLs go through `Http::dataset` and are cached in `<cache>/data/<sha1>.geojson` for `DATA_MAX_AGE_S` (15 min, so live feeds stay current); `--refresh` re-downloads and `--offline` takes any age. Other sources are files relative to the profile.
- Web/WASM: `Job.datasets` lists the sources, `Job.addDataset` takes the text. The worker (`web/src/lib/datasets.js`) fetches URLs (CORS needed) into Cache Storage with the same 15 min freshness; any other source must be a file dropped on the page (see [web.md](web.md)).
- Web mercator clamps latitude to ±85.05°, so a world dataset (Antarctica) projects. World maps use a PROJ string (`+proj=moll`); proj4rs has no Equal Earth.

## Terrain tiles

Terrarium PNGs for elevation — terramask; web `terrain.js`, CLI/wasm `readTerrain` on `Job`. Consumed by `terrain.rs` / burin.

## Google fonts

CLI: `drawland-cli/src/google_fonts.rs`. Core: `google_fonts.rs`, `text.rs`. Web prefetches in `App.jsx` / `googleFonts.js` and passes bytes into the worker.

## Stroke fonts (labels / `lines.text`)

CLI: `drawland-cli/src/stroke_fonts.rs` fetches catalog or custom URLs from `stroke_font_keys_in_grammar`. Core: `stroke_font.rs`, `text.rs`. Web: `strokeFonts.js`, `strokeFontKeys` / `addStrokeFont` on `Job` (see [web.md](web.md)).

## Cache layout

Default `cache/overpass/` for Overpass bodies; geocoding under cache root. Web uses Cache Storage with similar coverage rules (see `web/README.md`).

## No I/O in core

`drawland-core` accepts in-memory features, tile bytes, and font bytes. Any new data source should either feed those buffers or extend `tiles.rs` / `osm.rs`, not add HTTP to core.

## Views

A page with `views` (`view(...)` in a profile) is placeless unless the profile or command line gives a place. `map_v3` gathers the page's inputs and each view's (`gather`: Overpass, tiles, terrain, fonts, datasets for that view's output), each as its own `download <id>` row. The web app does the same in the worker (see [web.md](web.md)).
