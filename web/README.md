# postcards web

The card on a map: a Mapbox map underneath, the drawing on top of it, and the
profile in a sidebar you can edit and redraw. The drawing is the same
`postcards-core` the CLI uses, compiled to WebAssembly, so what you see is what
`postcards-rs map` writes.

```sh
# from the repo root, once (rebuild after any change in crates/)
./web/build-wasm.sh

cd web
cp .env.example .env.local        # put a Mapbox token in it
npm install
npm run dev
```

Open http://localhost:5173. The map starts on Berkeley; put the card where you
want it and press "generate card".

## How it works

- `crates/postcards-wasm` is the engine: `cardInfo`, `osmRequest` /
  `osmPick` / `osmEvict`, `overpassPolicy`, `tileSource`, a `Job` (read the
  Overpass reply when `needsOsm`, add the `tiles` it asks for, `readTiles`,
  draw) and a `Board` that lays out the progress. No filesystem, no network on
  that side.
- `src/lib/draw.worker.js` runs a draw off the page's thread: the download
  (Overpass only for a card with `osm_select`, then the vector tiles), then
  the engine. Its progress events go through the engine's `Board`, the
  same one that lays out the terminal for `postcards-rs map`, and
  `LoadCard.jsx` paints its lines.
- `src/lib/tiles.js` fetches the vector tiles the card needs (OpenFreeMap,
  read by terramask inside the engine): what `tiles_select` picks and the sea.
  A card is a handful of zoom-14 tiles; their URLs carry the build they come
  from and are cached by the browser for years, so a second draw nearby needs
  no network. The presets read everything from tiles; "Everything · Overpass"
  is the same card from Overpass, to compare.
- `src/lib/overpass.js` fetches the reply with the CLI's policy (servers,
  rounds, pauses, timeouts come from the engine). A browser cannot set
  `User-Agent` the way the CLI does, so the public mirrors sometimes answer a
  page with a 504. `VITE_OVERPASS_URL` points the app at a proxy of your own
  instead. Replies are kept in the browser's Cache Storage (up to 200 MB, 30
  days) and a card is drawn from any stored reply that covers it: each
  download asks for a quarter more ground on every side, so moving the card a
  little or zooming in does not download again. The rules are the engine's
  (`postcards_core::osm_cache`), the same the CLI follows in `cache/overpass/`.
- `src/components/MapView.jsx` puts the two together: the card rectangle is
  centred on the map, `width × height` at `1:N`, and the SVG is stretched to
  fill exactly that rectangle.
- `src/lib/presets.js` holds the card documents the app ships. They are the
  format the CLI reads, so anything you write there works in `postcards-rs map`
  too. `cargo run --example check_web_presets` parses each one, so a preset that
  stops parsing fails there rather than in a browser.
- "load" and "save" in the sidebar read and write the config; "download",
  in black in the map's corner once the card is drawn, saves the drawing as
  an SVG, one per sheet when the card is sliced. Beside it, "selection to
  map" brings the card to the middle of the map and "map to selection" the
  map to the card.
- "transform" on the card opens the `card:` block as controls
  (`src/components/CardControls.jsx`): the place (move with latitude and
  longitude, rotate, scale, the terrain the card covers) and the output (the
  paper's size, columns and rows, margin, gutter). The output only changes
  when edited: a new terrain is a new scale, a new scale a new terrain, and a
  new paper size takes in more or less terrain at the same scale.
  Every label drags its value sideways (Shift: 15° steps for the bearing,
  bigger steps elsewhere) and every field takes it typed, the arrows stepping
  it. Lengths take `mm`, `cm` or `in`, terrain `m`, `km`, `mi` or `ft`; a bare
  number keeps the unit the field had. Every change is written into the
  config as it happens; the drawing waits for "generate". The pieces live in
  `src/components/controls.jsx`, ready for a settings panel in the sidebar.
