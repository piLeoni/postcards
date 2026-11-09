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
import sketchbook from '../presets/sketchbook.js?raw'
import saltAndStone from '../presets/salt-and-stone.js?raw'
import atlas from '../presets/atlas.js?raw'
import labelFontsDemo from '../presets/label-fonts-demo.js?raw'
import { styleOf, titleOf } from './doc'

export const PRESETS = [
  { id: 'city-grain', hint: 'burin ground, nature patterns, isoline-stack tree crowns', doc: cityGrain },
  { id: 'sketchbook', hint: 'hand-drawn: loose streets, hatched blocks, curling waves, doodled trees', doc: sketchbook },
  { id: 'salt-and-stone', hint: 'pure nature in burin: hand-drawn contours, a soft concentric coast, swirling currents', doc: saltAndStone },
  { id: 'atlas', hint: 'a classic coloured physical map: hypsometric tints, sea depths, relief shading, roads and names (for print, not the pen)', doc: atlas },
  { id: 'label-fonts-demo', hint: 'single-stroke fonts: futural, EMS, URL load', doc: labelFontsDemo },
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

const PRESET_STYLES = PRESETS.map((p) => [p, styleOf(p.doc)])

/**
 * Which preset a script is, for every place that names it (the card's style
 * picker and the script column's preset menu), so both always say the same:
 * the preset whose style it has, whether it no longer matches that preset
 * verbatim (`modified`), and the label to show (`Title` or `Title · mod`).
 */
export function presetState(doc) {
  const style = styleOf(doc ?? '')
  const preset = PRESET_STYLES.find(([, s]) => s === style)?.[0] ?? null
  const scriptTitle = titleOf(doc ?? '')
  const presetTitle = preset ? titleOf(preset.doc) : null
  const modified = !preset || (scriptTitle != null && presetTitle != null && scriptTitle !== presetTitle)
  const base = scriptTitle ?? preset?.name ?? 'style'
  return { preset, modified, label: modified ? `${base} · mod` : base, inUse: (p) => preset === p && !modified }
}
