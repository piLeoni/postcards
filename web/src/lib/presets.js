/**
 * The profiles this app ships: the scripts in `src/presets`, each with the
 * graph it builds, pre-run by `cargo run --example check_web_presets -- --write`
 * into `graphs.json`. With the graph at hand, drawing a preset does not need
 * the script interpreter; editing the script does.
 *
 * `examples/check_web_presets.rs` fails when a preset stops running or its
 * graph is stale; `examples/wasm_render.rs` renders one without a browser.
 */
import graphs from '../presets/graphs.json'
import full from '../presets/full.js?raw'
import mixed from '../presets/mixed.js?raw'
import overpass from '../presets/overpass.js?raw'
import parks from '../presets/parks.js?raw'
import buildings from '../presets/buildings.js?raw'
import goldenGate from '../presets/golden-gate.js?raw'
import engravedSea from '../presets/engraved-sea.js?raw'
import showcaseColorThickness from '../presets/showcase-color-thickness.js?raw'
import showcaseVariableThickness from '../presets/showcase-variable-thickness.js?raw'
import { titleOf } from './doc'

export const PRESETS = [
  { id: 'full', hint: 'roads, trails, parks, water, buildings; all from OpenFreeMap', doc: full },
  { id: 'mixed', hint: 'the same output; only the roads asked of Overpass', doc: mixed },
  { id: 'overpass', hint: 'the same output, all from Overpass', doc: overpass },
  { id: 'parks', hint: 'green, water, buildings', doc: parks },
  { id: 'buildings', hint: 'the fastest draw', doc: buildings },
  { id: 'golden-gate', hint: 'burin land and sea, at the Golden Gate', doc: goldenGate },
  { id: 'engraved-sea', hint: 'burin hills, coast concentrics and waving currents', doc: engravedSea },
  { id: 'showcase-color-thickness', hint: 'demonstrates color and thickness variation', doc: showcaseColorThickness },
  { id: 'showcase-variable-thickness', hint: 'shows hierarchical road styling', doc: showcaseVariableThickness },
].map((p) => ({ ...p, name: titleOf(p.doc) ?? p.id, graph: graphs[p.id] }))

/** The output the app opens on. */
export const START_DOC = PRESETS.find((p) => p.id === 'parks').doc
