/**
 * The profiles this app ships: the scripts in `src/presets`. Each also carries
 * the graph from `graphs.json` (built by `check_web_presets --write`) for CI
 * and `wasm_render` only — the browser always re-runs the script in WASM.
 */
import graphs from '../presets/graphs.json'
import full from '../presets/full.js?raw'
import mixed from '../presets/mixed.js?raw'
import overpass from '../presets/overpass.js?raw'
import parks from '../presets/parks.js?raw'
import buildings from '../presets/buildings.js?raw'
import goldenGate from '../presets/golden-gate.js?raw'
import engravedSea from '../presets/engraved-sea.js?raw'
import inkByHeight from '../presets/ink-by-height.js?raw'
import inkByRiver from '../presets/ink-by-river.js?raw'
import inkByElevation from '../presets/ink-by-elevation.js?raw'
import flatColor from '../presets/flat-color.js?raw'
import cityGrain from '../presets/city-grain.js?raw'
import cityGrainFoliageIsoline from '../presets/city-grain-foliage-isoline.js?raw'
import cityGrainFoliageGrowth from '../presets/city-grain-foliage-growth.js?raw'
import cityGrainRoundCard from '../presets/city-grain-round-card.js?raw'
import { titleOf } from './doc'

export const PRESETS = [
  { id: 'city-grain', hint: 'same drawing as Everything · vector tiles — use inject here to try it elsewhere', doc: cityGrain },
  { id: 'city-grain-foliage-isoline', hint: '3D canopy: isoline-stack crowns, lit from one side', doc: cityGrainFoliageIsoline },
  { id: 'city-grain-foliage-growth', hint: 'dendritic veins over the wood: the growth pattern', doc: cityGrainFoliageGrowth },
  { id: 'city-grain-round-card', hint: 'MIT medallion: dotted card, round map, crosshair, placed title', doc: cityGrainRoundCard },
  { id: 'flat-color', hint: 'solid fills for water, parks and buildings (screen-style)', doc: flatColor },
  { id: 'full', hint: 'roads, trails, parks, water, buildings; all from OpenFreeMap', doc: full },
  { id: 'mixed', hint: 'the same output; only the roads asked of Overpass', doc: mixed },
  { id: 'overpass', hint: 'the same output, all from Overpass', doc: overpass },
  { id: 'parks', hint: 'green, water, buildings', doc: parks },
  { id: 'buildings', hint: 'the fastest draw', doc: buildings },
  { id: 'golden-gate', hint: 'burin land and sea, at the Golden Gate', doc: goldenGate },
  { id: 'engraved-sea', hint: 'burin hills, coast concentrics and waving currents', doc: engravedSea },
  { id: 'ink-by-height', hint: 'each building inked by its height', doc: inkByHeight },
  { id: 'ink-by-river', hint: 'buildings inked by their distance from the water, roads by class', doc: inkByRiver },
  { id: 'ink-by-elevation', hint: 'contours tinted and weighted by their height', doc: inkByElevation },
].map((p) => ({ ...p, name: titleOf(p.doc) ?? p.id, graph: graphs[p.id] }))

/** The output the app opens on. */
export const START_DOC = PRESETS.find((p) => p.id === 'city-grain').doc
