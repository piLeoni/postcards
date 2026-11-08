import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// A worker, not a script: Vite serves the pre-bundled `maplibre-gl` from
// `node_modules/.vite/deps`, where MapLibre's own `import.meta.url` probe
// finds no worker next door and renders nothing at all. `?worker&url` hands
// us a URL to a copy Vite builds for this, in dev and in `dist`. (MapLibre
// puts the pool together once, on the first style that loads.)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { groundWidthAt, outputBox, FIT_PAD, groundKm, hasLayout, lengthText, sheetsOf, sig3, zoomToFit } from '../lib/frame'
import { mapViewAtom, themeAtom } from '../lib/store'
import { defaultInkColor, mapColors } from '../lib/themes'
import OutputControls from './OutputControls'
import StylePresetPicker from './StylePresetPicker'
import SearchModal from './SearchModal'
import { PlaceSearchPanel } from './PlaceSearch'
import ShareModal from './ShareModal'
import DownloadModal from './DownloadModal'
import { angleModel, MAX_SCALE, MIN_SCALE, norm, PX_PER_DEG, PX_PER_STEP, scaleModel, terrainPair } from './controls'
import LoadCard from './LoadCard'
import DrawActionButton from './DrawActionButton'

setWorkerUrl(workerUrl)

/** The basemap: OpenFreeMap's Positron, the same OpenStreetMap data the output is drawn from. */
const STYLE = 'https://tiles.openfreemap.org/styles/positron'

/**
 * Positron is a warm, green-grey style and paints its labels and roads darker
 * than the paper the output is drawn on. Mapbox Light, which this map used to
 * use, left the drawing's own ink to carry the sheet; so this map is redrawn
 * from it, in the page's own greys.
 *
 * Every colour below is a CSS custom property, read from the page when the
 * style is loaded. That is the same palette the UI is set in (`#fff` through
 * `#888`), so the map and the app can only drift apart if the palette itself
 * changes; point them elsewhere — a dark or high-contrast set — and the map
 * follows, with no web map style to fork.
 */
/** One label layer, in the page's palette: soft grey with a wide halo. */
function placePaint(id, c) {
  if (!id.includes('label')) return null
  // Country and state names are a size up from a city's: a touch darker.
  const big = /country|state/.test(id)
  // Labels sit on a very light ground, so they can be lighter than the UI's
  // quiet text and still read; the halo does the work of separating them.
  return {
    'text-color': big ? c('hard') : c('faint'),
    'text-halo-color': c('paper'),
    'text-halo-width': 1.6,
    'text-opacity': big ? 0.9 : 0.8,
  }
}

/**
 * Positron's roads are white over a grey casing; that is what reads as the
 * black outline at a glance. In the page's greys the casing is a hair off the
 * paper, the road itself is barely there, and the black lines stay the output's.
 */
function roadPaint(id, c) {
  if (/casing/.test(id)) return { 'line-color': c('edge') }
  // Positron's railways: a wide grey line plus a lighter dashed overlay.
  if (/dashline/.test(id)) return { 'line-color': c('line') }
  if (/^railway/.test(id)) return { 'line-color': c('edge') }
  if (/_subtle/.test(id) || /tunnel/.test(id)) return { 'line-color': c('line') }
  return { 'line-color': c('line') }
}

/**
 * The layers Positron draws with a colour of its own: the paper, water, parks
 * and woodland, buildings, boundaries. Upstream tints each a few steps warm,
 * which a colour picker reads as a green-grey. They are mapped onto the page's
 * greys, chosen to sit close to the values Positron uses, so the basemap keeps
 * its lightness and only its hue changes.
 *
 * The `raster` source is Natural Earth's shaded relief: a hillshade, held at
 * low opacity so it stays a hint under the hillshade the output draws itself.
 */
const FILLS = {
  background: { 'background-color': 'paper' }, // the sheet
  park: { 'fill-color': 'botanical' },
  landcover_wood: { 'fill-color': 'botanical' },
  landcover_ice_shelf: { 'fill-color': 'paper' },
  landcover_glacier: { 'fill-color': 'paper' },
  landuse_residential: { 'fill-color': 'land' },
  water: { 'fill-color': 'wash' },
  waterway: { 'line-color': 'wash' },
  building: { 'fill-color': 'land', 'fill-outline-color': 'edge' },
  road_area_pier: { 'fill-color': 'paper' },
  road_pier: { 'line-color': 'paper' },
  'aeroway-area': { 'fill-color': 'paper' },
  'aeroway-runway': { 'line-color': 'paper' },
  'aeroway-runway-casing': { 'line-color': 'edge' },
  'aeroway-taxiway': { 'line-color': 'edge' },
  boundary_2: { 'line-color': 'edge' },
  boundary_3: { 'line-color': 'edge' },
  boundary_disputed: { 'line-color': 'edge' },
}

/**
 * The labels are drawn by MapLibre from SDF glyphs, not from the webfont the
 * page already loads, so a custom face means generating and serving a glyph
 * endpoint in the format MapLibre reads. We tried that (IBM Plex Mono) and it
 * cost more than it bought: every range we did not generate fell through to
 * the dev server's SPA fallback, which answers with HTML, and MapLibre tried
 * to decode that as protobuf (`Unimplemented type: 4`) for every label.
 *
 * So we let the style keep the fontstack OpenFreeMap serves, Noto Sans, and
 * do not touch `glyphs` or `text-font` at all. The basemap is a quiet ground
 * under the drawing; its labels do not need our face to do their job.
 */

/** Every Positron id this map restyles, so a rename upstream is visible. */
const POSITRON = [
  ...Object.keys(FILLS),
  'label_city',
  'label_town',
  'label_village',
  'label_state',
  'label_other',
  'label_country_1',
  'label_country_2',
  'label_country_3',
  'label_city_capital',
  'water_name_point_label',
  'water_name_line_label',
  'waterway_line_label',
  'highway-name-major',
  'highway-name-minor',
  'highway-name-path',
  'highway_major_casing',
  'highway_major_inner',
  'highway_motorway_casing',
  'highway_motorway_inner',
  'highway_minor',
  'highway_path',
  'highway_motorway_bridge_casing',
  'highway_motorway_bridge_inner',
  'highway_motorway_subtle',
  'highway_major_subtle',
  'tunnel_motorway_casing',
  'tunnel_motorway_inner',
  'road_shield_us',
  'highway-shield-us-interstate',
  'highway-shield-non-us',
  'railway',
  'railway_dashline',
  'railway_transit',
  'railway_transit_dashline',
  'railway_service',
  'railway_service_dashline',
]
function calm(map, themeId) {
  let layers
  try {
    layers = map.getStyle()?.layers
  } catch {
    return // The style went away before this ran (StrictMode's double mount).
  }
  const colors = mapColors(themeId)
  const c = (role) => colors[role]
  // Every id we style is Positron's, and we style by id. If upstream renames
  // or drops one the layer would quietly keep its warm tint rather than fail,
  // so say so, once, naming only what we meant to change.
  if (!layers?.length) return
  const ids = new Set(layers.map((l) => l.id))
  const missing = POSITRON.filter((id) => !ids.has(id))
  if (missing.length) console.warn('map: Positron no longer has', missing.join(', '), '— those keep their own colour')
  for (const { id, type, 'source-layer': source } of layers ?? []) {
    // Not Positron's, and not to be restyled: the tiles of the last download.
    if (id.startsWith(TILE_LAYER) || id.startsWith(TILE_LABELS)) continue
    const set = (name, value) => {
      try {
        map.setPaintProperty(id, name, value)
      } catch {
        // Every layer here is Positron's; a member outside the set is not
        // ours to style, and the map is all the better for skipping it.
      }
    }
    // The shields are the black-outlined numbers on the roads; the output needs
    // no route markers, and they are the darkest ink on the map. They are
    // matched by id: unlike every other Positron layer they carry no
    // `source-layer` of their own.
    if (/shield/.test(id)) {
      try {
        map.setLayoutProperty(id, 'visibility', 'none')
      } catch {
        // Not ours to touch; a visible shield is better than a broken style.
      }
      continue
    }
    const fill = FILLS[id]
    if (fill) {
      for (const [name, role] of Object.entries(fill)) set(name, c(role))
      continue
    }
    const place = placePaint(id, c)
    if (place) {
      for (const [name, value] of Object.entries(place)) set(name, value)
    } else if (type === 'symbol') {
      if (source === 'transportation') {
        // Road names take the quiet grey; the shields above are gone.
        set('text-color', c('faint'))
        set('text-halo-color', c('paper'))
        set('text-halo-width', 1.5)
      } else {
        // Buildings' and parks' names: barely there, like the app's disabled text.
        set('text-color', c('faint'))
        set('text-halo-color', c('paper'))
        set('text-halo-width', 1.5)
      }
    } else if (
      source === 'transportation' &&
      type === 'line' &&
      (/^(highway|tunnel|railway)/.test(id))
    ) {
      // Roads and railways: palette line/edge instead of Positron's white-grey pair.
      for (const [name, value] of Object.entries(roadPaint(id, c))) set(name, value)
    }
  }
}

/**
 * The download's tiles, marked on the map: while they arrive so the wait is
 * legible, and after the drawing as a faint trace of where its data came from.
 * The id prefix is here, above `calm`, which must leave these layers alone.
 */
const TILE_LAYER = 'download-tiles'
const TILE_LABELS = 'download-tiles-labels'
/** Below this map zoom, z/x/y labels on the tile grid are hidden (the grid stays). */
const TILE_LABEL_MIN_ZOOM = 11

const tileLabelLayout = {
  'text-field': ['get', 'label'],
  'text-size': 10,
  'text-font': ['Noto Sans Regular'],
  'text-anchor': 'top-left',
  'text-offset': [0.4, 0.2],
  'text-justify': 'left',
  // With the map turned to the output's bearing, labels stay on the tile's
  // north-west corner and turn with it instead of staying level on screen.
  'text-rotation-alignment': 'map',
  'text-pitch-alignment': 'map',
  'text-keep-upright': false,
  'text-allow-overlap': true,
  'text-ignore-placement': true,
}

function tileLabelPaintOf(c) {
  return {
    'text-color': c.hard,
    'text-opacity': ['match', ['get', 'state'], 0, 0.25, 3, 0.6, 0.5],
    'text-halo-color': c.paper,
    'text-halo-width': 1.5,
  }
}

/** Space between the output and the label above it or the tags below it, px. */
const GAP = 4
/** Space between postcard transform handle buttons, and from the card edge to the nearest handle, px. */
const HANDLE_GAP = GAP
/** Extra px before corner chrome on opposite sides of the card would meet. */
const CHROME_EDGE_PAD = 12
/** Pixels the tags keep from the map's edges. */
const EDGE = 8
/**
 * Space kept around the output when the map is brought to it on purpose — the
 * search, "map to selection" — as against the tighter `FIT_PAD` the automatic
 * fit hugs it with. Twice the air, so the selection reads as a frame with room
 * around it, not as something crammed to the edges.
 */
const FIT_AIR = 2 * FIT_PAD
/** The transform menu's opacity while one of its drags has the output under it. */
const MENU_FADE = 0.2
/** Pixels the output keeps from the map's edges while it is moved. */
const KEEP = 16
/** The band along the map's edges where the pointer moving the output pans the map, px. */
const ZONE = 40
/**
 * Pushed past an edge, the map pans to bring the output along: this many px a
 * second for each px the pointer is past where the output stopped, up to
 * `PUSH_MAX`. A little push creeps, a long one travels.
 */
const PUSH = 6
const PUSH_MAX = 1500
/** Animated pan when the selection should clear the floating panel (zoom unchanged). */
const FLOAT_RECENTER_MS = 480
/** What floats over the map: the output, its menu, the buttons in the corner. */
const RAISED = 'chrome-raised'

function outputClientRect(map, b) {
  const r = map.getContainer().getBoundingClientRect()
  return {
    left: r.left + b.x,
    top: r.top + b.y,
    right: r.left + b.x + b.w,
    bottom: r.top + b.y + b.h,
  }
}

function clientRectsOverlap(a, b) {
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom
}

function outputOverlapsEl(map, b, el) {
  if (!map || !b || !el) return false
  return clientRectsOverlap(outputClientRect(map, b), el.getBoundingClientRect())
}

/** Ease the map centre onto the selection; zoom and bearing stay as they are. */
function easeMapOntoSelection(map, output) {
  if (!map || !output) return
  map.easeTo({
    center: [output.lng, output.lat],
    duration: FLOAT_RECENTER_MS,
  })
}

/** MapLibre padding for chrome over the canvas (shifts the logical centre). */
function zeroPadding() {
  return { top: 0, bottom: 0, left: 0, right: 0 }
}

function paddingEqual(a, b) {
  return (
    (a.top ?? 0) === (b.top ?? 0) &&
    (a.bottom ?? 0) === (b.bottom ?? 0) &&
    (a.left ?? 0) === (b.left ?? 0) &&
    (a.right ?? 0) === (b.right ?? 0)
  )
}

/** `setPadding` recentres via `jumpTo`; skip persisting that move to `mapViewAtom`. */
function applyMapPadding(map, nextPad, skipViewPersistRef) {
  if (paddingEqual(map.getPadding(), nextPad)) return
  skipViewPersistRef.current = true
  map.setPadding(nextPad)
}

/**
 * Insets for MapLibre `setPadding`: the float card on the right, and room below
 * the postcard for the move / rotate / scale handles while dragging.
 */
function mapChromePadding(mapEl, floatEl, sidebarOpen, bottomPx) {
  const pad = { top: 0, bottom: Math.max(0, Math.round(bottomPx)), left: 0, right: 0 }
  if (!sidebarOpen && mapEl && floatEl) {
    const mr = mapEl.getBoundingClientRect()
    const pr = floatEl.getBoundingClientRect()
    if (pr.left < mr.right - 1) {
      pad.right = Math.round(Math.max(0, mr.right - pr.left))
    }
  }
  return pad
}

/** The marks on the map tags, the same plain glyphs the transform menu wears. */
const ICONS = {
  toMap: '✥',        // the move glyph: the selection goes onto the map
  toSelection: '⌖',  // a target: the map comes to the selection
  search: '⌕',
}

/**
 * Move / rotate / scale on the postcard: pointer-down stays highlighted until
 * release, even when the cursor leaves the button or passes over a sibling.
 */
const HANDLE_CURSOR = {
  grab: 'cursor-grab active:cursor-grabbing',
  ew: 'cursor-ew-resize',
  nwse: 'cursor-nwse-resize',
}

function TransformHandle({ icon, title, label, active, onPointerDown, cursor = 'grab' }) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      aria-label={label}
      data-active={active || undefined}
      className={`map-transform-handle map-chip chrome-border box-border inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center border p-0 font-mono select-none ${HANDLE_CURSOR[cursor] ?? HANDLE_CURSOR.grab} ${
        active ? 'map-transform-handle--active' : ''
      }`}
      onPointerDown={onPointerDown}
    >
      <span className="map-transform-handle__icon" aria-hidden>{icon}</span>
    </span>
  )
}

/** A small tag on the map that acts as a button; not a WebTUI key. */
function Tag({ title, onClick, icon, className = 'cursor-pointer', children, ...rest }) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      className={`map-chip inline-flex items-center gap-[0.75ch] px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap select-none ${className}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      {...rest}
    >
      {icon && <span aria-hidden className="w-[1.5ch] text-center">{icon}</span>}
      {children}
    </span>
  )
}

/** "6 × 4 in", or "6in × 40mm" when the two sides are written in different units. */
function paperText(output, units) {
  const [w, h] = [lengthText(output.width_mm, units.width), lengthText(output.height_mm, units.height)]
  return units.width === units.height ? `${w.replace(units.width, '')} × ${h.replace(units.height, '')} ${units.width}` : `${w} × ${h}`
}

/** "6 × 4 in · 1:8000 · 0.758 × 0.505 mi · 30° · 3 × 2 slices", each in the unit the document uses. */
function sizeText(output, units) {
  if (!groundKm(output)) return ''
  const turned = Math.abs(norm(output.bearing ?? 0)) > 0.05 ? ` · ${Math.round(norm(output.bearing) * 1000) / 1000}°` : ''
  const cut = (output.columns ?? 1) * (output.rows ?? 1) > 1 ? ` · ${output.columns} × ${output.rows} slices` : ''
  return `${paperText(output, units)} · 1:${sig3(output.scale)} · ${terrainPair(output, units.terrain)}${turned}${cut}`
}

/** Slice cuts (always) and dotted margin insets (only before the raster preview is ready). */
function Guides({ output, showMargins }) {
  if (!hasLayout(output)) return null
  const [w, h] = [output.width_mm, output.height_mm]
  const cols = Math.max(1, output.columns ?? 1)
  const rows = Math.max(1, output.rows ?? 1)
  const line = { vectorEffect: 'non-scaling-stroke', fill: 'none' }
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {showMargins &&
        sheetsOf(output).map((s, i) => {
          const [x0, y0, x1, y1] = s.inner
          const margin = s.inner.some((v, k) => Math.abs(v - s.at[k]) > 1e-6)
          return margin && x1 > x0 && y1 > y0 ? (
            <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} stroke="var(--chrome-divider)" strokeDasharray="1 3" strokeWidth={1} {...line} />
          ) : null
        })}
      {Array.from({ length: cols - 1 }, (_, i) => (w * (i + 1)) / cols).map((x) => (
        <line key={`c${x}`} x1={x} y1={0} x2={x} y2={h} stroke="var(--chrome-divider)" strokeWidth={1} {...line} />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (h * (i + 1)) / rows).map((y) => (
        <line key={`r${y}`} x1={0} y1={y} x2={w} y2={y} stroke="var(--chrome-divider)" strokeWidth={1} {...line} />
      ))}
    </svg>
  )
}

/**
 * The map, with the output drawn on top of it.
 *
 * The output is pinned to the ground: it has a lon/lat of its own and stays
 * there while you drag the map around underneath. Only the tools in its
 * `transform` menu change it: `move` moves it, `scale` changes its scale about
 * its centre (the paper stays the size the document says), `rotate` turns the
 * map under it, and the result is written into the document's `output:` block,
 * so scrolling the map never drags your output out of place.
 *
 * The output always faces you: a bearing turns the map, not the output. The map's
 * bearing is the output's, so the rectangle stays level on screen and the
 * drawing, turned the same way by the engine, lies on the map.
 *
 * The rectangle is a DOM overlay, so it has to be redrawn on the map's own
 * render tick, not on a React state change: React batches asynchronously and
 * lags the map by a frame, which is what makes overlays look like they are
 * stuttering. So we hook `render` and move the node directly.
 */
/** The folded card's label: what the draw it reports did or is doing. */
function statusWord(load) {
  if (load.board.running()) return 'drawing…'
  const { tree, logs } = load.board.layout(performance.now())
  const lines = [...tree, ...logs]
  const bad = lines.map((runs) => runs.map((r) => r.text).join('')).find((t) => t.trim().startsWith('✗'))
  if (bad) return `✗ ${bad.replace(/^✗\s*/, '').slice(0, 30)}`
  const steps = lines.filter((runs) => runs.length && runs.every((r) => r.text.includes('✓') || /^\s*$/.test(r.text))).length
  return steps ? `drawn · ${steps} steps` : 'drawn'
}

/** A web-mercator tile's corners, lon/lat, as a closed ring. */
function tileRing(z, x, y) {
  const n = 2 ** z
  const lon = (x) => (x / n) * 360 - 180
  const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  return [
    [lon(x), lat(y)],
    [lon(x + 1), lat(y)],
    [lon(x + 1), lat(y + 1)],
    [lon(x), lat(y + 1)],
    [lon(x), lat(y)],
  ]
}

/** North-west corner of a slippy-map tile, lon/lat (where the label sits). */
function tileNw(z, x, y) {
  const n = 2 ** z
  const lon = (x / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  return [lon, lat]
}

/**
 * The vector tiles of the download, as App keeps them: `ids` `[z, x, y, …]`,
 * `state` per tile (0 waiting, 1 read, 2 empty), `live` while they download,
 * `at` where they were read. They stay on the map after the drawing, a trace
 * of where its data came from, unless the output has moved since.
 *
 * A planned grid (`planned`, from `tilesPlan`) has `ids` but no `state`: the
 * tiles the output will read, shown before the draw. It wears state 3, a
 * fainter, dashed outline with no fill, so it reads as "these are the tiles
 * this output will ask for" and not as a download already read.
 */
function showTiles(map, tiles, themeId) {
  if (!map.isStyleLoaded()) return false
  const c = mapColors(themeId)
  const features = []
  const marks = []
  const states = tiles?.state
  for (let i = 0; tiles && i < tiles.ids.length / 3; i++) {
    const [z, x, y] = tiles.ids.slice(3 * i, 3 * i + 3)
    const state = states ? states[i] : 3
    const label = `${z}/${x}/${y}`
    features.push({
      type: 'Feature',
      properties: { state },
      geometry: { type: 'Polygon', coordinates: [tileRing(z, x, y)] },
    })
    marks.push({
      type: 'Feature',
      properties: { state, label },
      geometry: { type: 'Point', coordinates: tileNw(z, x, y) },
    })
  }
  const data = { type: 'FeatureCollection', features }
  const labels = { type: 'FeatureCollection', features: marks }
  if (!map.getSource(TILE_LAYER)) {
    map.addSource(TILE_LAYER, { type: 'geojson', data })
    map.addSource(TILE_LABELS, { type: 'geojson', data: labels })
  } else {
    map.getSource(TILE_LAYER).setData(data)
    if (map.getSource(TILE_LABELS)) map.getSource(TILE_LABELS).setData(labels)
    else map.addSource(TILE_LABELS, { type: 'geojson', data: labels })
  }
  // The paint is applied on every call, not only when the layer is first
  // added: a color or width changed here then takes effect at once, without
  // waiting for the layer to be torn down and built again.
  const tileFillPaint = { 'fill-color': c.ink, 'fill-opacity': ['match', ['get', 'state'], 1, 0.06, 0] }
  const tileLinePaint = {
    // A planned tile (3) is a continuous line, a hint on the map of what
    // the output will read until the draw lights its tiles up.
    'line-color': ['match', ['get', 'state'], 3, c.soft, c.hard],
    'line-width': ['match', ['get', 'state'], 3, 0.7, 0.5],
    'line-opacity': ['match', ['get', 'state'], 2, 0.22, 3, 0.75, 0.45],
    'line-dasharray': ['match', ['get', 'state'], 2, ['literal', [2, 2]], ['literal', [1, 0]]],
  }
  const tileLabelPaint = tileLabelPaintOf(c)
  if (!map.getLayer(`${TILE_LAYER}-fill`)) {
    map.addLayer({ id: `${TILE_LAYER}-fill`, type: 'fill', source: TILE_LAYER, paint: tileFillPaint })
  } else {
    for (const [k, v] of Object.entries(tileFillPaint)) map.setPaintProperty(`${TILE_LAYER}-fill`, k, v)
  }
  if (!map.getLayer(`${TILE_LAYER}-line`)) {
    map.addLayer({ id: `${TILE_LAYER}-line`, type: 'line', source: TILE_LAYER, paint: tileLinePaint })
  } else {
    for (const [k, v] of Object.entries(tileLinePaint)) map.setPaintProperty(`${TILE_LAYER}-line`, k, v)
  }
  if (!map.getLayer(`${TILE_LAYER}-label`)) {
    map.addLayer({
      id: `${TILE_LAYER}-label`,
      type: 'symbol',
      source: TILE_LABELS,
      minzoom: TILE_LABEL_MIN_ZOOM,
      layout: tileLabelLayout,
      paint: tileLabelPaint,
    })
  } else {
    map.setLayerZoomRange(`${TILE_LAYER}-label`, TILE_LABEL_MIN_ZOOM, 24)
    for (const [k, v] of Object.entries(tileLabelPaint)) map.setPaintProperty(`${TILE_LAYER}-label`, k, v)
    syncTileLabelLayout(map)
  }
  syncTileLabelLayout(map)
  return true
}

function tilesLayerVisible(map, on) {
  for (const id of [`${TILE_LAYER}-fill`, `${TILE_LAYER}-line`, `${TILE_LAYER}-label`]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
}

/** Label layout on an existing layer (e.g. after a hot reload). */
function syncTileLabelLayout(map) {
  const id = `${TILE_LAYER}-label`
  if (!map.getLayer(id)) return
  for (const [key, value] of Object.entries(tileLabelLayout)) {
    map.setLayoutProperty(id, key, value)
  }
}

export default function MapView({
  doc,
  appliedDoc,
  setDoc,
  output,
  units,
  drawing,
  onRequestViewport,
  apiRef,
  load,
  loadMin,
  onLoadMin,
  tiles,
  planned,
  onEditOutput,
  onDownload,
  onShare,
  onMoveOutput,
  onOutputKeys,
  onOutputToCentre,
  onCentreOnOutput,
  onPlaceMap,
  onDraw,
  onStop,
  search,
  onCloseSearch,
  onSearch,
  share,
  shareDoc,
  onShareClose,
  download,
  downloadDoc,
  onDownloadClose,
  sidebarOpen = false,
  sidebarColumnDrag = false,
  busy = false,
  appReady = true,
}) {
  const [mapBooted, setMapBooted] = useState(false)
  const [tilesOn] = useState(true)
  const [mapView, setMapView] = useAtom(mapViewAtom)
  const mapViewRef = useRef(mapView)
  mapViewRef.current = mapView
  const [themeId] = useAtom(themeAtom)
  const themeIdRef = useRef(themeId)
  themeIdRef.current = themeId
  // The map is built once, in an effect with no dependencies; this holds the
  // saved view so that effect can read it without depending on it.
  const savedViewRef = useRef(mapView)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const skipViewPersistRef = useRef(false)
  const overlayRef = useRef(null)
  const previewWrapRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const detailCanvasRef = useRef(null)
  const detailBitmapRef = useRef(null)
  const detailTimerRef = useRef(0)
  const chromeSizeRef = useRef({ style: 0, draw: 0, download: 0, handles: 0, handlesH: 0 })
  const floatPanelRef = useRef(null)
  const drawingRef = useRef(drawing)
  drawingRef.current = drawing
  const requestViewportRef = useRef(onRequestViewport)
  requestViewportRef.current = onRequestViewport
  const labelRef = useRef(null)
  const topRightRef = useRef(null)
  const bottomLeftRef = useRef(null)
  const tagsRef = useRef(null)
  const awayRef = useRef(null)
  const floatPanelWrapRef = useRef(null)
  const sidebarOpenRef = useRef(sidebarOpen)
  sidebarOpenRef.current = sidebarOpen
  const sidebarColumnDragRef = useRef(sidebarColumnDrag)
  sidebarColumnDragRef.current = sidebarColumnDrag
  const [activeTransform, setActiveTransform] = useState(null)
  const readyRef = useRef(false)
  const lastFitRef = useRef('')
  const initialFitDoneRef = useRef(false)
  const mapBootedRef = useRef(false)
  const revealMapRef = useRef(() => {})
  revealMapRef.current = () => {
    if (mapBootedRef.current) return
    mapBootedRef.current = true
    setMapBooted(true)
  }
  /** Once per visit: frame the stored selection like "map to selection". */
  const fitMapToOutputRef = useRef(() => {})
  fitMapToOutputRef.current = () => {
    if (initialFitDoneRef.current) return
    const map = mapRef.current
    const out = outputRef.current
    if (!map || !readyRef.current || !out) return
    initialFitDoneRef.current = true
    requestAnimationFrame(() => {
      const m = mapRef.current
      const o = outputRef.current
      if (!m || !o) {
        initialFitDoneRef.current = false
        return
      }
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        m.off('moveend', settle)
        m.off('idle', settle)
        revealMapRef.current()
      }
      m.once('moveend', settle)
      m.once('idle', settle)
      m.jumpTo({
        center: [o.lng, o.lat],
        zoom: m.getZoom() + zoomToFit(m, o, FIT_AIR),
        bearing: norm(o.bearing ?? 0),
      })
      // `jumpTo` with no camera change may skip `moveend` on some browsers.
      window.setTimeout(settle, 80)
    })
  }
  // While a drag is on, the output follows the pointer from here; the document
  // trails it by a frame.
  const editRef = useRef(null)
  const edit = editRef.current
  // Hold the edited output until the document comes back with it, or it would
  // snap to its old place for a frame.
  if (
    edit?.done &&
    output &&
    Math.abs(output.lat - edit.lat) < 1e-5 &&
    Math.abs(output.lng - edit.lng) < 1e-5 &&
    Math.abs(output.scale - edit.scale) < 1 &&
    Math.abs(norm(output.bearing ?? 0) - norm(edit.bearing ?? 0)) < 1e-4 &&
    Math.abs(output.width_mm - edit.width_mm) < 0.5 &&
    Math.abs(output.height_mm - edit.height_mm) < 0.5
  ) {
    editRef.current = null
  }
  const unitsRef = useRef(units)
  unitsRef.current = units ?? { width: 'mm', height: 'mm', terrain: 'km' }
  const outputRef = useRef(output)
  outputRef.current = editRef.current ? { ...output, ...editRef.current } : output
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  const plannedRef = useRef(planned)
  plannedRef.current = planned

  // The bearing last asked for by `setBearing` (a rotate drag, the field),
  // held until the compiled output has it: compiles trail the drag, and
  // turning the map back to each one as it lands makes it shake.
  const wantBearingRef = useRef(null)
  if (wantBearingRef.current !== null && output && Math.abs(norm(norm(output.bearing ?? 0) - wantBearingRef.current)) < 1e-4) {
    wantBearingRef.current = null
  }

  /** Turn the map to the output's bearing about its centre (see `applyOutputBearingRef`). */
  const applyOutputBearingRef = useRef(() => {})
  applyOutputBearingRef.current = () => {
    const map = mapRef.current
    if (!map || (editRef.current && !editRef.current.done)) return
    const c = outputRef.current
    if (!c) return
    const b = wantBearingRef.current ?? norm(c.bearing ?? 0)
    if (Math.abs(norm(map.getBearing() - b)) < 1e-6) return
    map.easeTo({ bearing: b, around: [c.lng, c.lat], duration: 0 })
  }

  // When the map starts moving/zooming, hide the zoomed-in detail layer so the
  // lightweight whole-card overview bitmap handles all 60fps frames; once the
  // map settles (`moveend`), ask the worker to rasterize the visible slice of
  // the vector SVG at native device-pixel resolution.
  const hideDetail = useCallback(() => {
    if (detailTimerRef.current) {
      clearTimeout(detailTimerRef.current)
      detailTimerRef.current = 0
    }
    if (detailCanvasRef.current) detailCanvasRef.current.style.display = 'none'
  }, [])

  const scheduleDetail = useCallback(() => {
    if (detailTimerRef.current) clearTimeout(detailTimerRef.current)
    detailTimerRef.current = setTimeout(() => {
      detailTimerRef.current = 0
      const map = mapRef.current
      const d = drawingRef.current
      const out = outputRef.current
      const req = requestViewportRef.current
      if (!map || !d?.preview || !d?.token || !out || !req) return
      const b = outputBox(map, out)
      if (!b || b.w < 4 || b.h < 4 || !(out.width_mm > 0 && out.height_mm > 0)) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      // If the overview bitmap already covers the full card at or above screen
      // device-pixel resolution, no separate detail slice is needed.
      if (b.w * dpr <= d.preview.width * 1.05 && b.h * dpr <= d.preview.height * 1.05) {
        if (detailCanvasRef.current) detailCanvasRef.current.style.display = 'none'
        return
      }
      const { clientWidth: W, clientHeight: H } = map.getContainer()
      const visX0 = Math.max(0, -b.x)
      const visY0 = Math.max(0, -b.y)
      const visX1 = Math.min(b.w, W - b.x)
      const visY1 = Math.min(b.h, H - b.y)
      if (visX1 <= visX0 + 1 || visY1 <= visY0 + 1) return
      const mmX0 = (visX0 / b.w) * out.width_mm
      const mmY0 = (visY0 / b.h) * out.height_mm
      const mmX1 = (visX1 / b.w) * out.width_mm
      const mmY1 = (visY1 / b.h) * out.height_mm
      const pxW = Math.round((visX1 - visX0) * dpr)
      const pxH = Math.round((visY1 - visY0) * dpr)
      let askSeq = 0
      askSeq = req(d.token, { mmX0, mmY0, mmX1, mmY1, pxW, pxH }, (msg) => {
        if (msg.seq !== askSeq || msg.token !== drawingRef.current?.token) {
          msg.bitmap?.close?.()
          return
        }
        detailBitmapRef.current?.close?.()
        detailBitmapRef.current = msg.bitmap
        const dc = detailCanvasRef.current
        if (!dc || !msg.bitmap) return
        const outNow = outputRef.current
        const bNow = outNow ? outputBox(mapRef.current, outNow) : null
        if (!bNow || !(outNow.width_mm > 0 && outNow.height_mm > 0)) return
        const sx = bNow.w / outNow.width_mm
        const sy = bNow.h / outNow.height_mm
        dc.width = msg.bitmap.width
        dc.height = msg.bitmap.height
        dc.style.left = `${msg.rect.mmX0 * sx}px`
        dc.style.top = `${msg.rect.mmY0 * sy}px`
        dc.style.width = `${(msg.rect.mmX1 - msg.rect.mmX0) * sx}px`
        dc.style.height = `${(msg.rect.mmY1 - msg.rect.mmY0) * sy}px`
        const ctx = dc.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, msg.bitmap.width, msg.bitmap.height)
          ctx.drawImage(msg.bitmap, 0, 0)
        }
        dc.style.display = ''
      })
    }, 120)
  }, [])
  const place = useCallback(() => {
    const map = mapRef.current
    const el = overlayRef.current
    if (!map || !el) return
    const mapEl = map.getContainer()
    const floatWrap = floatPanelWrapRef.current
    const handlesEl = tagsRef.current
    const sizes = chromeSizeRef.current
    if (handlesEl?.offsetHeight) sizes.handlesH = handlesEl.offsetHeight
    const handlesH = sizes.handlesH || handlesEl?.offsetHeight || 26
    const bottomPad = outputRef.current ? handlesH + HANDLE_GAP + KEEP : 0
    const nextPad = mapChromePadding(mapEl, floatWrap, sidebarOpenRef.current, bottomPad)
    applyMapPadding(map, nextPad, skipViewPersistRef)

    const b = outputRef.current ? outputBox(map, outputRef.current) : null
    const { clientWidth: W, clientHeight: H } = mapEl
    const away = !b || b.x > W || b.y > H || b.x + b.w < 0 || b.y + b.h < 0
    if (awayRef.current) awayRef.current.style.display = outputRef.current && away ? '' : 'none'
    if (away || b.w < 4 || b.h < 4) {
      el.style.display = 'none'
      if (floatWrap && !sidebarOpenRef.current) {
        floatWrap.style.opacity = sidebarColumnDragRef.current ? '0' : ''
        floatWrap.style.pointerEvents = sidebarColumnDragRef.current ? 'none' : ''
      }
      return
    }
    el.style.display = ''
    el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`
    el.style.width = `${b.w}px`
    el.style.height = `${b.h}px`
    const wrap = previewWrapRef.current
    const out = outputRef.current
    // Size the wrap to the card's screen pixels (no inner scale). Safari
    // rasterizes canvases inside a scaled layer at the pre-transform size,
    // which leaves the overview and detail bitmaps permanently soft.
    if (wrap && out && out.width_mm > 0 && out.height_mm > 0) {
      wrap.style.width = `${b.w}px`
      wrap.style.height = `${b.h}px`
      wrap.style.transform = ''
    }
    const styleEl = labelRef.current
    const drawEl = topRightRef.current
    const downloadEl = bottomLeftRef.current
    if (styleEl?.offsetWidth) sizes.style = styleEl.offsetWidth
    if (drawEl?.offsetWidth) sizes.draw = drawEl.offsetWidth
    if (downloadEl?.offsetWidth) sizes.download = downloadEl.offsetWidth
    if (handlesEl?.offsetWidth) sizes.handles = handlesEl.offsetWidth
    if (handlesEl?.offsetHeight) sizes.handlesH = handlesEl.offsetHeight
    const styleW = sizes.style || styleEl?.offsetWidth || 120
    const drawW = sizes.draw || drawEl?.offsetWidth || 80
    const downloadW = sizes.download || downloadEl?.offsetWidth || 100
    const handlesW = sizes.handles || handlesEl?.offsetWidth || 92
    const showTopChrome = b.w >= styleW + drawW + CHROME_EDGE_PAD
    const showDownload = b.w >= downloadW + handlesW + CHROME_EDGE_PAD
    const hide = (el, on) => {
      if (!el) return
      el.style.visibility = on ? '' : 'hidden'
      el.style.pointerEvents = on ? '' : 'none'
    }
    hide(styleEl, showTopChrome)
    hide(drawEl, showTopChrome)
    hide(downloadEl, showDownload)
    if (floatWrap && !sidebarOpenRef.current) {
      const under = b && outputOverlapsEl(map, b, floatWrap)
      if (sidebarColumnDragRef.current) {
        floatWrap.style.opacity = '0'
        floatWrap.style.pointerEvents = 'none'
      } else if (under) {
        floatWrap.style.opacity = String(MENU_FADE)
        floatWrap.style.pointerEvents = 'none'
      } else {
        floatWrap.style.opacity = ''
        floatWrap.style.pointerEvents = ''
      }
    }
  }, [])
  const placeRef = useRef(place)
  placeRef.current = place

  /**
   * A drag that starts in the menu fades it over the output until release (see
   * `place`). The wheel still zooms the map meanwhile: the label holding the
   * pointer, or the menu under it, would take the wheel instead, so it is sent
   * on to the map at the same spot.
   */
  const holdMenu = (e) => {
    if (!e.target.closest?.('[data-drag]')) return
    const wheel = (ev) => {
      const map = mapRef.current
      if (!map || map.getCanvasContainer().contains(ev.target)) return
      ev.preventDefault()
      ev.stopPropagation()
      const { clientX, clientY, screenX, screenY, deltaX, deltaY, deltaZ, deltaMode, ctrlKey, shiftKey, altKey, metaKey } = ev
      map.getCanvas().dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX, clientY, screenX, screenY, deltaX, deltaY, deltaZ, deltaMode, ctrlKey, shiftKey, altKey, metaKey }),
      )
    }
    const release = () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('wheel', wheel, { capture: true })
      place()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('wheel', wheel, { capture: true, passive: false })
    place()
  }

  useEffect(() => {
    const saved = savedViewRef.current
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: saved ? [saved.lng, saved.lat] : output ? [output.lng, output.lat] : [-122.256196, 37.8771145],
      bearing: output?.bearing ?? 0,
      zoom: saved?.zoom ?? 14,
      minZoom: 2,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      // MapLibre eases a bearing under 7° to north at the end of every drag,
      // pans included; the bearing is the output's, never snapped.
      bearingSnap: 0,
      renderWorldCopies: false,
      attributionControl: false,
    })
    mapRef.current = map
    // The bearing belongs to the output: only `rotate` turns the map.
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    map.on('error', (e) => {
      const err = e.error ?? {}
      console.error('maplibre:', err.status ?? '', err.message ?? String(err), err.url ?? '')
    })

    map.on('load', () => {
      map.resize()
      readyRef.current = true
      placeRef.current()
      fitMapToOutputRef.current()
    })

    const onZoomEnd = () => applyOutputBearingRef.current()
    map.on('zoomend', onZoomEnd)

    // Restyle the basemap on every load, so a `setStyle` swap keeps it too.
    map.on('style.load', () => {
      calm(map, themeIdRef.current)
      showTiles(map, tilesRef.current ?? plannedRef.current, themeIdRef.current)
    })

    // The only surface App gets on the map: where its centre is, and how to
    // move it there. Everything else flows through `output`.
    //
    // `fit` puts the map on a place *and* sizes it to the selection, a little
    // wider than the automatic fit: the same ground the output covers, with
    // `FIT_AIR` around it. It takes the new lon/lat because a move and a fit are
    // written together, and the output atom has not caught up yet.
    if (apiRef) {
      apiRef.current = {
        center: () => {
          const c = map.getCenter()
          return { lat: c.lat, lng: c.lng }
        },
        jumpTo: (lng, lat) => {
          const c = outputRef.current
          map.jumpTo({ center: [lng, lat], bearing: wantBearingRef.current ?? norm(c?.bearing ?? 0) })
        },
        fit: (lng, lat, bearing) => {
          const at = outputRef.current ? { ...outputRef.current, lat, lng } : null
          const zoom = at ? map.getZoom() + zoomToFit(map, at, FIT_AIR) : map.getZoom()
          const b = wantBearingRef.current ?? (Number.isFinite(bearing) ? norm(bearing) : norm(at?.bearing ?? 0))
          map.jumpTo({ center: [lng, lat], zoom, bearing: b })
        },
        setBearing: (bearing) => {
          const c = outputRef.current
          wantBearingRef.current = norm(bearing)
          map.easeTo({ bearing: wantBearingRef.current, around: c ? [c.lng, c.lat] : undefined, duration: 0 })
        },
        syncBearing: () => applyOutputBearingRef.current(),
        startDrag: (e, cursorEl) => startDragRef.current?.(e, cursorEl),
      }
    }

    // Where the map was last left is kept, so a reload comes back to it. Runs
    // on every settled move: a pan, a zoom, the wheel, not the drag between.
    const keep = () => {
      scheduleDetail()
      if (skipViewPersistRef.current) {
        skipViewPersistRef.current = false
        return
      }
      const next = {
        lng: +map.getCenter().lng.toFixed(6),
        lat: +map.getCenter().lat.toFixed(6),
        zoom: +map.getZoom().toFixed(3),
      }
      const prev = mapViewRef.current
      if (prev && prev.lng === next.lng && prev.lat === next.lat && prev.zoom === next.zoom) return
      savedViewRef.current = next
      setMapView(next)
    }
    map.on('movestart', hideDetail)
    map.on('moveend', keep)

    // The map's render loop drives the overlay, so the two never disagree.
    const onRender = () => placeRef.current()
    map.on('render', onRender)

    // The sidebar can be dragged wider: the canvas follows its container.
    // Resizing a canvas clears it, so it is drawn again at once, before the
    // browser paints, or each step of a drag flashes black. `redraw` does
    // nothing until the style is in, so ask for a frame instead.
    const resized = new ResizeObserver(() => {
      map.resize()
      if (map.style) map.redraw()
      else map.triggerRepaint()
      applyOutputBearingRef.current()
    })
    resized.observe(containerRef.current)

    return () => {
      resized.disconnect()
      map.off('render', onRender)
      map.off('movestart', hideDetail)
      map.off('moveend', keep)
      map.off('zoomend', onZoomEnd)
      if (detailTimerRef.current) clearTimeout(detailTimerRef.current)
      detailBitmapRef.current?.close?.()
      detailBitmapRef.current = null
      if (apiRef) apiRef.current = null
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The drawing is shown from the worker's raster `ImageBitmap` on a `<canvas>`
  // when available (falling back to an `<img>` Blob URL only if OffscreenCanvas
  // was unavailable): the main thread never parses or re-rasterizes a huge SVG
  // DOM of hundreds of thousands of `<polyline>` elements.
  const [svgUrl, setSvgUrl] = useState(null)
  useEffect(() => {
    if (!drawing?.svg || drawing?.preview) {
      setSvgUrl(null)
      return
    }
    const url = URL.createObjectURL(drawing.svg)
    setSvgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [drawing?.svg, drawing?.preview])

  useEffect(() => {
    hideDetail()
    detailBitmapRef.current?.close?.()
    detailBitmapRef.current = null
    const bmp = drawing?.preview
    const c = previewCanvasRef.current
    if (!bmp || !c) return
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, bmp.width, bmp.height)
      ctx.drawImage(bmp, 0, 0)
    }
    scheduleDetail()
  }, [drawing?.preview, hideDetail, scheduleDetail])

  // What the map draws for tiles: the live download (or its trace once done)
  // when there is one, else the grid planned from the graph — so the tiles an
  // output will read show before the draw, and the download takes over as it
  // starts. Both belong to the output's place; App drops either when it moves.
  const tilesToShow = () => tilesRef.current ?? plannedRef.current

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const paint = () => {
      showTiles(map, tilesToShow(), themeIdRef.current)
      tilesLayerVisible(map, tilesOn && Boolean(tilesToShow()))
    }
    if (paint()) return
    map.once('load', paint)
    return () => map.off('load', paint)
  }, [tiles, planned, tilesOn])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const restyle = () => {
      if (!map.getStyle()?.layers) return
      calm(map, themeId)
      showTiles(map, tilesToShow(), themeId)
    }
    const id = requestAnimationFrame(restyle)
    return () => cancelAnimationFrame(id)
  }, [themeId])

  useEffect(() => {
    place()
  }, [sidebarOpen, sidebarColumnDrag, place])

  // The script compiles after the map may already be up; fit once both exist.
  useEffect(() => {
    fitMapToOutputRef.current()
  }, [output])

  // Engine up but no output to frame (e.g. a compile error): show the map anyway.
  useEffect(() => {
    if (mapBootedRef.current || !appReady || output) return
    revealMapRef.current()
  }, [appReady, output])

  // A bearing written in the document turns the map about the output, so the
  // output stays where it is on screen. During a rotate the map already turns.
  // Read `outputRef`, not `output` alone: a drag can finish before compile
  // catches up, and syncing from stale props would snap the map back.
  const bearing = norm(output?.bearing ?? 0)
  useEffect(() => {
    applyOutputBearingRef.current()
  }, [bearing, output?.lat, output?.lng])

  // A finished draw swaps the SVG in; re-seat bearing in case the camera moved
  // while tiles were downloading (the document's bearing did not change).
  useEffect(() => {
    if (!drawing?.svg) return
    requestAnimationFrame(() => applyOutputBearingRef.current())
  }, [drawing?.svg])

  // When the output's ground size changes in the document, zoom out only if it
  // no longer fits the map: an output that still fits keeps the zoom, so a new
  // width reads as a wider output, not as the map moving. A resize on the map
  // is already where you want it.
  const ground = output ? groundKm(output) : null
  const groundKey = ground ? ground.map(sig3).join('x') : ''
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !output || !groundKey) return
    if (lastFitRef.current === groundKey) return
    lastFitRef.current = groundKey
    if (editRef.current) return
    const b = outputBox(map, output)
    const el = map.getContainer()
    const inset = map.getPadding()
    const innerW = el.clientWidth - (inset.left ?? 0) - (inset.right ?? 0)
    const innerH = el.clientHeight - (inset.top ?? 0) - (inset.bottom ?? 0)
    if (b && b.w <= innerW - 2 * FIT_PAD && b.h <= innerH - 2 * FIT_PAD) return
    map.jumpTo({
      center: [output.lng, output.lat],
      zoom: map.getZoom() + zoomToFit(map, output),
      bearing: norm(output.bearing ?? 0),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey])

  /**
   * Follow the pointer with `step(map, from, dx, dy, event)`, once a frame:
   * the output moves and `write` puts it in the document, and once more on
   * release. A step that returns `again: true` is run the next frame too, the
   * pointer still or not.
   */
  const follow = (e, step, write, cursorEl, onRelease, afterWrite) => {
    e.preventDefault()
    e.stopPropagation()
    const map = mapRef.current
    const from = outputRef.current
    if (!map || !from) {
      onRelease?.()
      return
    }
    if (cursorEl instanceof Element) {
      try {
        cursorEl.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic or released pointer.
      }
    }
    // A field being typed in would keep its text over the live value.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    const start = { x: e.clientX, y: e.clientY }
    let at = null
    let frame = 0
    const apply = () => {
      if (!at) return false
      const base = outputRef.current ?? from
      const { lat, lng, scale, bearing, width_mm, height_mm } = base
      const { again, ...to } = step(map, base, at.clientX - start.x, at.clientY - start.y, at)
      editRef.current = { lat, lng, scale, bearing, width_mm, height_mm, ...to }
      outputRef.current = { ...base, ...editRef.current }
      place()
      return again
    }
    const tick = () => {
      frame = 0
      const again = apply()
      write(editRef.current)
      if (again) frame = requestAnimationFrame(tick)
    }
    const move = (ev) => {
      // The drawing is of where the output was: it goes as soon as the output moves.
      if (!at) onEditOutput?.()
      at = ev
      if (!frame) frame = requestAnimationFrame(tick)
    }
    // The wheel zooms the map mid-drag; the output keeps to the pointer.
    const zoomed = () => {
      if (at && !frame) frame = requestAnimationFrame(tick)
    }
    map.on('zoom', zoomed)
    const up = () => {
      map.off('zoom', zoomed)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      if (cursorEl instanceof Element) {
        try {
          cursorEl.releasePointerCapture(e.pointerId)
        } catch {
          // Already released.
        }
      }
      if (frame) {
        cancelAnimationFrame(frame)
        apply()
      }
      const to = editRef.current
      if (at && to && !to.done) {
        to.done = true
        write(to)
      }
      onRelease?.()
      if (at && editRef.current) afterWrite?.(map, editRef.current)
    }
    const el = cursorEl instanceof Element ? cursorEl : e.currentTarget
    const grab = el instanceof Element ? getComputedStyle(el).cursor : ''
    document.body.style.cursor = grab && grab !== 'auto' ? grab : 'grabbing'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const releaseTransform = () => setActiveTransform(null)

  const beginTransform = (kind, e, run) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setActiveTransform(kind)
    if (!run()) setActiveTransform(null)
  }

  /**
   * Move the output with the pointer, kept `KEEP` px inside the map (its label
   * too). Pushed past an edge it stops there and the map pans under it instead,
   * faster the further the pointer goes, so it cannot be dragged off screen;
   * the pointer near an edge pans it too. The same as a marker's auto-pan in Leaflet. An output that starts out past
   * an edge may stay out there, and is held in once it comes in; one bigger
   * than the map is held covering it.
   */
  const startDragRef = useRef(null)
  const startDrag = (e, cursorEl) => {
    const map = mapRef.current
    const from = outputRef.current
    const b0 = map && from ? outputBox(map, from) : null
    if (!b0) return false
    const top = (labelRef.current?.offsetHeight ?? 0) + GAP
    const r0 = map.getContainer().getBoundingClientRect()
    const p0 = { x: e.clientX - r0.left, y: e.clientY - r0.top }
    // Where the box's top left, and the pointer, may go per axis: [lowest, highest].
    const fence = {}
    const zone = {}
    // Both widen to take in where they start, and narrow as they come in.
    const range = (seen, k, lo, hi, start, at) => {
      const f = seen[k] ?? [Math.min(lo, start), Math.max(hi, start)]
      seen[k] = [Math.max(f[0], Math.min(lo, at)), Math.min(f[1], Math.max(hi, at))]
      return f
    }
    let t = performance.now()
    let mapFollowedSelection = false
    follow(
      e,
      (map, from, dx, dy, ev) => {
        const now = performance.now()
        const dt = Math.min(now - t, 50) / 1000
        t = now
        const el = map.getContainer()
        const { clientWidth: W, clientHeight: H } = el
        const inset = map.getPadding()
        const padL = inset.left ?? 0
        const padR = inset.right ?? 0
        const padT = inset.top ?? 0
        const padB = inset.bottom ?? 0
        const r = el.getBoundingClientRect()
        const { w, h } = outputBox(map, outputRef.current) ?? b0
        // The box stops at the fence; the pointer it is pushed with may reach
        // the screen's edge first (the handle can sit far from the box's), so
        // the last `ZONE` px before the map's edge pan too.
        const hold = (k, want, size, view, near, start, p, p0, insetStart, insetEnd) => {
          const lo = Math.min(near + insetStart, view - KEEP - size - insetEnd)
          const hi = Math.max(near + insetStart, view - KEEP - size - insetEnd)
          const f = range(fence, k, lo, hi, start, want)
          const got = Math.min(Math.max(want, f[0]), f[1])
          const push = want - got
          const z = range(zone, k, ZONE + insetStart, view - ZONE - insetEnd, p0, p)
          const past = p < z[0] ? p - z[0] : p > z[1] ? p - z[1] : 0
          const speeds = [Math.min(Math.abs(push) * PUSH, PUSH_MAX), Math.min(Math.abs(past) / ZONE, 1) * PUSH_MAX]
          return { got, pan: Math.sign(push || past) * Math.max(...speeds) * dt }
        }
        const x = hold('x', b0.x + b0.w / 2 + dx - w / 2, w, W, KEEP, b0.x, ev.clientX - r.left, p0.x, padL, padR)
        const y = hold('y', b0.y + b0.h / 2 + dy - h / 2, h, H, KEEP + top, b0.y, ev.clientY - r.top, p0.y, padT, padB)
        const again = x.pan !== 0 || y.pan !== 0
        if (again) {
          mapFollowedSelection = true
          map.panBy([x.pan, y.pan], { animate: false })
        }
        const next = map.unproject([x.got + w / 2, y.got + h / 2])
        return { lat: next.lat, lng: next.lng, again }
      },
      (to) => onMoveOutput?.({ lat: to.lat, lng: to.lng }),
      cursorEl,
      () => {
        releaseTransform()
        place()
      },
      (map) => {
        if (!mapFollowedSelection) return
        const out = outputRef.current
        if (out) easeMapOntoSelection(map, out)
      },
    )
    return true
  }
  startDragRef.current = startDrag

  const scaleKey = (v) => `1:${Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)))}`

  /** Turn the map under the output; always whole degrees (menu ↻ still uses Shift for 15°). */
  const startRotate = (e, cursorEl) => {
    const from = outputRef.current
    if (!from) return false
    const start = norm(from.bearing ?? 0)
    follow(
      e,
      (map, from, dx) => {
        const n = Math.round(dx / PX_PER_DEG) * -1
        const bearing = angleModel.nudge(start, n, false)
        wantBearingRef.current = bearing
        map.easeTo({ bearing, around: [from.lng, from.lat], duration: 0 })
        return { bearing }
      },
      (to) => onOutputKeys?.({ bearing: to.bearing }),
      cursorEl,
      releaseTransform,
    )
    return true
  }

  /** Screen pixels along one axis → paper mm at the output's current scale. */
  const pxToPaperMm = (map, output, px) => {
    const kmPerPx = groundWidthAt(output.lat, map.getZoom(), 1)
    return (px * kmPerPx * 1e6) / output.scale
  }

  /**
   * Scale the selection: proportional from the centre (default); Shift changes
   * width and height separately about the centre; Alt (Option) keeps the
   * top-left corner fixed on the map while width and height follow dx/dy.
   */
  const startScale = (e, cursorEl) => {
    const map = mapRef.current
    const from = outputRef.current
    if (!from || !map) return false
    const b0 = outputBox(map, from)
    if (!b0) return false
    const u = unitsRef.current
    const anchor = map.unproject([b0.x, b0.y])
    const initialMode = e.altKey ? 'topleft' : e.shiftKey ? 'axis-center' : null
    const start = {
      scale: from.scale,
      width_mm: from.width_mm,
      height_mm: from.height_mm,
      lat: from.lat,
      lng: from.lng,
    }
    follow(
      e,
      (map, _from, dx, dy, ev) => {
        const mode = ev?.altKey ? 'topleft' : ev?.shiftKey ? 'axis-center' : (initialMode ?? 'proportional')
        const probe = { lat: start.lat, scale: start.scale }
        if (mode === 'proportional') {
          const drag = Math.abs(dx) >= Math.abs(dy) ? dx : dy
          const width_mm = Math.max(1, start.width_mm + pxToPaperMm(map, probe, drag))
          const ratio = width_mm / start.width_mm
          const height_mm = Math.max(1, start.height_mm * ratio)
          return { width_mm, height_mm, lat: start.lat, lng: start.lng }
        }
        const width_mm = Math.max(1, start.width_mm + pxToPaperMm(map, probe, dx))
        const height_mm = Math.max(1, start.height_mm + pxToPaperMm(map, probe, dy))
        if (mode === 'axis-center') {
          return { width_mm, height_mm, lat: start.lat, lng: start.lng }
        }
        const kmPerPx = groundWidthAt(start.lat, map.getZoom(), 1)
        const wPx = ((width_mm * start.scale) / 1e6) / kmPerPx
        const hPx = ((height_mm * start.scale) / 1e6) / kmPerPx
        const anchorScreen = map.project([anchor.lng, anchor.lat])
        const center = map.unproject([anchorScreen.x + wPx / 2, anchorScreen.y + hPx / 2])
        return { width_mm, height_mm, lat: center.lat, lng: center.lng }
      },
      (to) => {
        const patch = {}
        if (to.scale !== undefined) patch.scale = scaleKey(to.scale)
        if (to.width_mm !== undefined) patch.width = lengthText(to.width_mm, u.width)
        if (to.height_mm !== undefined) patch.height = lengthText(to.height_mm, u.height)
        if (to.lat !== undefined) patch.lat = to.lat
        if (to.lng !== undefined) patch.lng = to.lng
        onOutputKeys?.(patch)
      },
      cursorEl,
      releaseTransform,
    )
    return true
  }

  const showBootScreen = !appReady || !mapBooted

  const tilesLive = tiles?.live === true
  // First draw: let live tiles show through the in-flight SVG. Rerun: keep the last
  // raster on a solid sheet and dim it so the wait reads as “updating”, not a flash.
  const redrawing = busy && drawing?.preview
  const dimForTiles = tilesLive && !drawing?.preview
  const previewDim = redrawing ? 'opacity-45' : dimForTiles ? 'opacity-20' : ''
  const paperBg = drawing?.preview || (drawing?.svg && !tilesLive)

  const mapStatusTags = (
    <>
      {load && loadMin && (
        <Tag
          title="Bring back the progress and report of the last draw"
          className={`cursor-pointer ${RAISED}`}
          onClick={() => onLoadMin?.(false)}
        >
          ▸ {statusWord(load)}
        </Tag>
      )}
    </>
  )

  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <div ref={containerRef} className={`h-full w-full ${showBootScreen ? 'invisible' : ''}`} aria-hidden={showBootScreen} />

      {/*
        Positioned with a transform on the map's own render tick (see `place`),
        so it can never be a frame behind the ground it sits on. Its four corner
        bars live inside the same wrapper so they share the exact same subpixel
        transform and outer border edges without independent composite jitter.
      */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute left-0 top-0 z-[25]"
        style={{ display: 'none', willChange: 'transform' }}
      >
        <div
          className={`pointer-events-none absolute inset-0 overflow-hidden border border-[color:var(--chrome-divider)] ${RAISED} ${
            paperBg ? 'bg-[var(--background0)]' : 'bg-[color-mix(in_srgb,var(--background0)_20%,transparent)]'
          }`}
        >
          <div ref={previewWrapRef} className="relative h-full w-full origin-top-left">
            {drawing?.preview ? (
              <>
                <canvas
                  ref={previewCanvasRef}
                  className={`block h-full w-full select-none ${previewDim}`}
                />
                <canvas
                  ref={detailCanvasRef}
                  className={`pointer-events-none absolute bg-[var(--background0)] select-none ${previewDim}`}
                  style={{ display: 'none' }}
                />
              </>
            ) : drawing?.svg && svgUrl ? (
              <img
                className={`block h-full w-full select-none object-fill ${previewDim}`}
                src={svgUrl}
                alt=""
                draggable={false}
                decoding="async"
              />
            ) : null}
          </div>
          {output && <Guides output={output} showMargins={!drawing?.preview} />}
        </div>

        {/* Top-left of postcard: style preset dropdown */}
        {output && (
          <div
            ref={labelRef}
            className="pointer-events-auto absolute bottom-full left-0 z-[26] mb-[4px]"
          >
            <StylePresetPicker doc={doc} appliedDoc={appliedDoc} setDoc={setDoc} />
          </div>
        )}

        {/* Top-right of postcard: DRAW / REGEN / STOP */}
        {output && (
          <div
            ref={topRightRef}
            className="pointer-events-auto absolute right-0 bottom-full z-[26] mb-[4px] flex items-center gap-1"
          >
            <DrawActionButton busy={busy} drawing={drawing} onDraw={onDraw} onStop={onStop} />
          </div>
        )}

        {/* Bottom-left of postcard: Download button (when drawn) */}
        {output && (
          <div
            ref={bottomLeftRef}
            className="pointer-events-auto absolute top-full left-0 z-[25] mt-[4px] flex items-center gap-1"
          >
            {drawing?.svg && (
              <>
                <span
                  role="button"
                  tabIndex={0}
                  title="Export SVG, PNG, or G-code"
                  aria-label="Download the output"
                  onClick={onDownload}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onDownload?.()
                    }
                  }}
                  className={`map-chip-strong chrome-border box-border inline-flex h-[28px] cursor-pointer items-center justify-center gap-[0.6ch] border px-2 py-0 font-mono text-[11px] font-bold whitespace-nowrap select-none ${RAISED}`}
                >
                  ↓ download
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  title="Share the script: a link that carries it, or a short link to it"
                  aria-label="Share the script"
                  onClick={onShare}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onShare?.()
                    }
                  }}
                  className={`map-chip chrome-border box-border inline-flex h-[28px] cursor-pointer items-center justify-center gap-[0.6ch] border px-2 py-0 font-mono text-[11px] font-bold whitespace-nowrap select-none ${RAISED}`}
                >
                  share
                </span>
              </>
            )}
          </div>
        )}

        {/* Bottom-right of postcard: Move, Rotate, Scale drag handles */}
        {output && (
          <div
            ref={tagsRef}
            className="pointer-events-auto absolute top-full right-0 z-[25] mt-[4px]"
            style={{ '--handle-gap': `${HANDLE_GAP}px` }}
          >
            {output.computed ? (
              <Tag title="The script computes its output, so it is moved and resized in the script">
                output computed by the script
              </Tag>
            ) : (
              <div
                className="map-transform-handles flex items-center"
                data-dragging={activeTransform ? '' : undefined}
              >
                <TransformHandle
                  icon="✥"
                  label="Move selection"
                  title="Drag to move the selection across the map"
                  active={activeTransform === 'move'}
                  cursor="grab"
                  onPointerDown={(e) => beginTransform('move', e, () => startDrag(e, e.currentTarget))}
                />
                <TransformHandle
                  icon="↻"
                  label="Rotate selection"
                  title="Drag left or right to rotate the map under the selection (1° steps)"
                  active={activeTransform === 'rotate'}
                  cursor="ew"
                  onPointerDown={(e) => beginTransform('rotate', e, () => startRotate(e, e.currentTarget))}
                />
                <TransformHandle
                  icon="⤡"
                  label="Scale selection"
                  title="Drag to scale proportionally from centre · Shift+drag: width & height from centre · Alt/Option+drag: width & height from top-left"
                  active={activeTransform === 'scale'}
                  cursor="nwse"
                  onPointerDown={(e) => beginTransform('scale', e, () => startScale(e, e.currentTarget))}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {output && (
        <div className="absolute top-2 left-2 z-20 flex flex-wrap items-center gap-1.5">
          <span
            ref={awayRef}
            className="map-chip chrome-border inline-flex items-center gap-[0.35ch] border px-2 py-1 font-mono text-[10px] leading-normal whitespace-nowrap"
            style={{ display: 'none' }}
          >
            <span>The selection is out of view ·</span>
            <span
              role="button"
              tabIndex={0}
              className="cursor-pointer underline select-none"
              onClick={onCentreOnOutput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onCentreOnOutput?.()
                }
              }}
            >
              map to selection
            </span>
          </span>
        </div>
      )}

      <SearchModal open={search && sidebarOpen} onClose={onCloseSearch} onPick={onSearch} />

      {/* The share sheet is a panel over the map, the same sheet search and
          load wear, centred on the drawing rather than on the script column. */}
      <ShareModal open={share} onClose={onShareClose} doc={shareDoc} />
      <DownloadModal open={download} onClose={onDownloadClose} doc={downloadDoc} drawing={drawing} output={output} />

      {/* The draw, reported over the map: a separate output, not a frame drawn
          inside the output that is about to be replaced. It stays until the
          next draw, so a finished one can be read again; `—` puts it away. */}
      {load && !loadMin && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <LoadCard load={load} onMin={onLoadMin && (() => onLoadMin(true))} />
        </div>
      )}
      {/* Floating controls only when the script column is fully collapsed (not while dragging it open). */}
      {!sidebarOpen && output && (
        <div
          ref={floatPanelWrapRef}
          className="absolute top-1/2 right-10 z-30 flex -translate-y-1/2 flex-col items-end transition-opacity duration-200"
          onPointerDownCapture={holdMenu}
          aria-hidden={sidebarColumnDrag}
        >
          <div
            ref={floatPanelRef}
            className={`chrome-surface chrome-border flex max-h-[78vh] w-[40ch] min-h-0 flex-col overflow-hidden border p-2 font-mono text-[11px] ${RAISED}`}
          >
            <PlaceSearchPanel lockSizeRef={floatPanelRef} onPick={onSearch}>
              <div className="mb-1.5 flex flex-col gap-1">
                {!output.computed && (
                  <span
                    role="button"
                    tabIndex={0}
                    title="Move the selection to the middle of the map"
                    className="chrome-surface chrome-border flex w-full cursor-pointer items-center justify-center gap-[0.75ch] border px-1.5 py-0.5 select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)]"
                    onClick={onOutputToCentre}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOutputToCentre?.()
                      }
                    }}
                  >
                    <span aria-hidden>{ICONS.toMap}</span>
                    <span>selection to map</span>
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  title="Move the map so the selection is in the middle"
                  className="chrome-surface chrome-border flex w-full cursor-pointer items-center justify-center gap-[0.75ch] border px-1.5 py-0.5 select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)]"
                  onClick={onCentreOnOutput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onCentreOnOutput?.()
                    }
                  }}
                >
                  <span aria-hidden>{ICONS.toSelection}</span>
                  <span>map to selection</span>
                </span>
              </div>
              {!output.computed ? (
                <OutputControls output={output} units={units} onEdit={onOutputKeys} onMove={startDrag} />
              ) : (
                <p className="m-0 opacity-60">Output computed by the script.</p>
              )}
            </PlaceSearchPanel>
          </div>
        </div>
      )}

      {/* Draw report tag at bottom left */}
      <div
        className="map-chrome-bottom map-chrome-left absolute z-30 flex max-w-[calc(100%-2*var(--map-edge)-8rem)] flex-row flex-wrap items-center gap-1.5"
      >
        {mapStatusTags}
      </div>

      {showBootScreen && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-[1lh] bg-[var(--background0)]"
          aria-busy="true"
          aria-live="polite"
        >
          <div
            className="h-2 w-96 max-w-[90vw] overflow-hidden bg-[color-mix(in_srgb,var(--foreground0)_12%,transparent)]"
            role="status"
            aria-label="Loading"
          >
            <div className="map-boot-bar h-full w-1/4 bg-[var(--foreground0)]" />
          </div>
          <p className="m-0 font-mono text-[10px] opacity-60">Booting…</p>
        </div>
      )}
    </div>
  )
}
