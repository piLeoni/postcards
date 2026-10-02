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

- `crates/postcards-wasm` is the engine: `cardInfo`, `overpassQuery`,
  `overpassPolicy`, `oceanSource`, a `Job` (read the Overpass reply, add the
  ocean tiles, draw) and a `Board` that lays out the progress. No filesystem,
  no network on that side.
- `src/lib/draw.worker.js` runs a draw off the page's thread: the download,
  then the engine. Its progress events go through the engine's `Board`, the
  same one that lays out the terminal for `postcards-rs map`, and
  `LoadCard.jsx` paints its lines.
- `src/lib/overpass.js` fetches the reply with the CLI's policy (servers,
  rounds, pauses, timeouts come from the engine). A browser cannot set
  `User-Agent` the way the CLI does, so the public mirrors sometimes answer a
  page with a 504. `VITE_OVERPASS_URL` points the app at a proxy of your own
  instead.
- `src/lib/ocean.js` fetches the vector tiles with the sea when the card shows
  a coast (OpenFreeMap, read by terramask inside the engine), as the CLI does.
- `src/components/MapView.jsx` puts the two together: the card rectangle is
  centred on the map, `width × height` at `1:N`, and the SVG is stretched to
  fill exactly that rectangle.
- `src/lib/presets.js` holds the card documents the app ships. They are the
  format the CLI reads, so anything you write there works in `postcards-rs map`
  too. `cargo run --example check_web_presets` parses each one, so a preset that
  stops parsing fails there rather than in a browser.

## Not done yet

- No SVG export yet: "download" saves the document, the CLI writes the drawing.
