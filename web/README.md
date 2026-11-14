# draw.land web

The card on a map: a MapLibre map underneath (OpenFreeMap's Positron style, no
token), the drawing on top of it, and the
profile in a sidebar you can edit and redraw. The drawing is the same
`drawland-core` the CLI uses, compiled to WebAssembly, so what you see is what
`drawland map` writes.

```sh
# from the repo root, once (rebuild after any change in crates/)
./web/build-wasm.sh

cd web
npm install
npm run dev
```

Open http://localhost:5173. The map opens on City Grain over San Francisco's
Marina; move the selection where you want it and press the draw button. The
docs are at http://localhost:5173/docs.

## How it works

- `crates/drawland-wasm` is the engine: `cardInfo`, `osmRequest` /
  `osmPick` / `osmEvict`, `overpassPolicy`, `tileSource`, a `Job` (read the
  Overpass reply when `needsOsm`, add the `tiles` it asks for, `readTiles`,
  draw) and a `Board` that lays out the progress. No filesystem, no network on
  that side.
- `src/lib/draw.worker.js` runs a draw off the page's thread: the download
  (Overpass only for a card with `osm_select`, then the vector tiles), then
  the engine. Its progress events go through the engine's `Board`, the
  same one that lays out the terminal for `drawland map`, and
  `LoadCard.jsx` paints its lines.
- `src/lib/tiles.js` fetches the vector tiles the card needs (OpenFreeMap,
  read by terramask inside the engine): what `tiles_select` picks and the sea.
  A card is a handful of zoom-14 tiles; their URLs carry the build they come
  from and are cached by the browser for years, so a second draw nearby needs
  no network. The presets read everything from tiles.
- `src/lib/overpass.js` fetches the reply with the CLI's policy (servers,
  rounds, pauses, timeouts come from the engine). A browser cannot set
  `User-Agent` the way the CLI does, so the public mirrors sometimes answer a
  page with a 504. `VITE_OVERPASS_URL` points the app at a proxy of your own
  instead. Replies are kept in the browser's Cache Storage (up to 200 MB, 30
  days) and a card is drawn from any stored reply that covers it: each
  download asks for a quarter more ground on every side, so moving the card a
  little or zooming in does not download again. The rules are the engine's
  (`drawland_core::osm_cache`), the same the CLI follows in `cache/overpass/`.
- `src/components/MapView.jsx` puts the two together: the card rectangle is
  centred on the map, `width × height` at `1:N`, and the SVG is stretched to
  fill exactly that rectangle.
- `src/lib/presets.js` holds the presets the app ships (`src/presets/*.js`).
  They are the format the CLI reads, so anything written there works in
  `drawland map` too. `cargo run --example check_web_presets` parses each one,
  and `npm test` type-checks each against `drawland.d.ts`, so a preset that
  stops parsing or type-checking fails there rather than in a browser.
- The **selection** is the card on the map: what will be drawn, at the
  profile's paper and scale. The style picker over the map (and the preset
  menu in the script column) loads a preset whole: its place, paper and scale,
  the map fitted to it, then drawn; the menu's second button keeps the map's
  place and paper and brings only the preset's layers. "selection to map"
  brings the selection to the middle of the map, "map to selection" the map to
  the selection.
- The **script column** holds the profile in an editor that autocompletes and
  type-checks against `drawland.d.ts`. "load" and "save" read and write it as a
  `.js` named after its `title(...)`. An edit is applied only once the engine
  takes it: "apply" (or ⌘/Ctrl+Enter) on a script with a mistake keeps it as a
  draft and opens the engine's message, underlining the spot it points to.
- The **output controls** (`src/components/OutputControls.jsx`, pieces in
  `controls.jsx`) sit in the script column, or over the map when the column is
  closed: a card at the right that fades while the output is under it. On a
  phone (`sm` and under) the map keeps only one key at the bottom, clear of
  the safe areas, the output fitted above it; the key opens the column as a
  sheet that scrolls, with the selection's controls and the script. A phone
  is also told, once a day after it closes the note (`DesktopNote` in
  `App.jsx`, the time in `localStorage`), that the page is made for a
  desktop. The controls edit
  the literal `output({...})` call: the place (latitude
  and longitude, bearing, scale, the terrain covered) and the paper (size,
  slices, padding, gutter, overlap, tile zoom). Every label drags its value
  sideways (Shift: bigger steps) and every field takes it typed; lengths take
  `mm`, `cm` or `in`, terrain `m`, `km`, `mi` or `ft`. Edits are written into
  the script as they happen; the drawing waits for the draw button. A set
  tile zoom follows the scale (`followScale` in `src/lib/doc.js`): a new scale
  resets it to the zoom whose tiles are about 4 cm on the paper, so a plate
  zoomed onto a town reads the town's buildings, not the plate's coarse tiles.
- **Download** (`DownloadModal.jsx`) saves the drawing as SVG, PNG, DXF or
  G-code (`GcodeConfig.jsx`, `src/lib/gcode.js`), whole or per sheet, and one
  file per layer (per pen) on request. **Share** (`ShareModal.jsx`) gives a
  link that carries the script in it, or a short link to a stored copy.
- `/docs` (`src/docs/`) is the documentation, opened over the page with the
  map and editor kept alive behind it. Its pictures are drawn by the CLI with
  `web/scripts/render-docs.sh` into `public/docs/`, its reference generated
  from `drawland.d.ts` by `web/scripts/build-reference.mjs`; every example on
  it opens on the map. The field atop its index (`/` or ⌘K) opens a search,
  in a sheet over the page, of the page's own headings and text (`DocSearch.jsx`, `src/lib/docSearch.js`).
