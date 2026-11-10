/**
 * The profiles this app ships: the scripts in `src/presets`. Each also carries
 * the graph from `graphs.json` (built by `check_web_presets --write`) for CI
 * and `wasm_render` only — the browser always re-runs the script in WASM.
 */
import graphs from '../presets/graphs.json'
import cityGrain from '../presets/city-grain.js?raw'
import sketchbook from '../presets/sketchbook.js?raw'
import saltAndStone from '../presets/salt-and-stone.js?raw'
import atlas from '../presets/atlas.js?raw'
import brutalist from '../presets/brutalist.js?raw'
import earthquakes from '../presets/earthquakes.js?raw'
import geojsonOverlay from '../presets/geojson-overlay.js?raw'
import stateCut from '../presets/state-cut.js?raw'
import postcardFrance from '../presets/postcard-france.js?raw'
import bostonLive from '../presets/boston-live.js?raw'
import { styleOf, titleOf } from './doc'

export const PRESETS = [
  { id: 'city-grain', hint: 'burin ground, nature patterns, isoline-stack tree crowns', doc: cityGrain },
  { id: 'brutalist', hint: 'heavy nib: parallel-line streets, frayed swells, stipple and growth trees, dotted building masses', doc: brutalist },
  { id: 'sketchbook', hint: 'hand-drawn: loose streets, hatched blocks, curling waves, doodled trees', doc: sketchbook },
  { id: 'salt-and-stone', hint: 'pure nature in burin: hand-drawn contours, a soft concentric coast, swirling currents', doc: saltAndStone },
  { id: 'atlas', hint: 'a classic coloured physical map: hypsometric tints, sea depths, relief shading, roads and names (for print, not the pen)', doc: atlas },
  // `ownPlace`: the preset's place and paper are part of it (a world map, a
  // dataset's city), so choosing it loads it whole rather than at the map's place.
  { id: 'earthquakes', hint: 'live data: the last 30 days of quakes (USGS) on a world map, sized by magnitude, inked by depth', doc: earthquakes, ownPlace: true },
  { id: 'boston-live', hint: 'live data: the T as a transit map (lines from CTPS GeoJSON), every train on it right now (MBTA API, plain JSON)', doc: bostonLive, ownPlace: true },
  { id: 'geojson-overlay', hint: 'a GeoJSON over a quiet base map; drop your own .geojson on the page', doc: geojsonOverlay, ownPlace: true },
  { id: 'state-cut', hint: 'a state\'s silhouette as a 4×6 die-cut card: one ink, one hatch, closer with height, each level outlined', doc: stateCut, ownPlace: true },
  { id: 'postcard-france', hint: 'a postcard of France in four views — Paris, Mont-Saint-Michel, Versailles, Mont Blanc — in City Grain, the name across them', doc: postcardFrance, ownPlace: true },
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
