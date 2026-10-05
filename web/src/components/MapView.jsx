import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { AttributionControl, MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// A worker, not a script: Vite serves the pre-bundled `maplibre-gl` from
// `node_modules/.vite/deps`, where MapLibre's own `import.meta.url` probe
// finds no worker next door and renders nothing at all. `?worker&url` hands
// us a URL to a copy Vite builds for this, in dev and in `dist`. (MapLibre
// puts the pool together once, on the first style that loads.)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { outputBox, FIT_PAD, groundKm, hasLayout, lengthText, sheetsOf, sig3, zoomToFit } from '../lib/frame'
import { mapViewAtom } from '../lib/store'
import OutputControls from './OutputControls'
import SearchModal from './SearchModal'
import { norm, terrainPair } from './controls'
import LoadCard from './LoadCard'

setWorkerUrl(workerUrl)

/** The basemap: OpenFreeMap's Positron, the same OpenStreetMap data the output is drawn from. */
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
/** The style carries no attribution of its own; the ODbL needs this one shown. */
const CREDIT =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · ' +
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>'

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
const ROLES = {
  ink: 'var(--foreground0)', // black: nothing on the basemap should reach this
  hard: 'var(--foreground1)', // #444: letters and lines that have to be read
  soft: 'var(--foreground2)', // #888: labels, the way the app sets quiet text
  faint: 'var(--background3)', // #a3a3a3: minor names and road shields
  edge: 'var(--background2)', // #d4d4d4: casing under the paper-white roads
  line: 'var(--background1)', // #ebebeb: the roads themselves
  paper: 'var(--background0)', // #fff: the sheet, and the halo behind a label
  // The basemap sits *under* the drawing, so it has to stay lighter and
  // quieter than the UI chrome: the app's own greys are the ink, not the
  // ground. These shades are the map's alone, tuned a step or two off paper
  // so the output's lines remain the darkest thing on screen.
  land: '#f7f7f7', // the ground, barely off the sheet
  wash: '#e6e6e6', // where Positron paints water: sea, lakes, streams
  botanical: '#f0f0f0', // where Positron paints parks and woodland
}

/**
 * The engine's SVG carries a `<style>` with a bare `* { fill: none; ... }`,
 * right for a file on its own. Inlined in the page, a `<style>` is global, so
 * that rule reached every element in the app (the run button's icon turned
 * into a hairline outline). Scope it to the drawing.
 */
function scopeStyle(svg) {
  return svg.replace('<style>\n* {', '<style>\n.output-svg svg, .output-svg svg * {')
}

/**
 * Fold the `ROLES` into a map of `role -> resolved colour`. A role is either a
 * custom property, read from the page so the map follows the palette, or a
 * literal shade like `#c8c8c8`, used as-is.
 */
function palette(el) {
  const style = getComputedStyle(el)
  const read = new Map()
  for (const [role, token] of Object.entries(ROLES)) {
    if (token.startsWith('var(--')) read.set(role, style.getPropertyValue(token.slice(4, -1)).trim() || '#888')
    else read.set(role, token)
  }
  return { color: (role) => read.get(role) }
}

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
  if (/_subtle/.test(id) || /tunnel/.test(id)) return { 'line-color': c('line') }
  return { 'line-color': c('paper') }
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
]
function calm(map) {
  let layers
  try {
    layers = map.getStyle()?.layers
  } catch {
    return // The style went away before this ran (StrictMode's double mount).
  }
  const c = palette(map.getContainer()).color
  // Every id we style is Positron's, and we style by id. If upstream renames
  // or drops one the layer would quietly keep its warm tint rather than fail,
  // so say so, once, naming only what we meant to change.
  const ids = new Set(layers.map((l) => l.id))
  const missing = POSITRON.filter((id) => !ids.has(id))
  if (missing.length) console.warn('map: Positron no longer has', missing.join(', '), '— those keep their own colour')
  for (const { id, type, 'source-layer': source } of layers ?? []) {
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
    } else if (source === 'transportation' && type === 'line' && /^(highway|tunnel)/.test(id)) {
      // The roads: paper over a hairline of grey, in the app's palette.
      for (const [name, value] of Object.entries(roadPaint(id, c))) set(name, value)
    }
  }
}

/** Space between the output and the label above it or the tags below it, px. */
const GAP = 4
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
/** What floats over the map: the output, its menu, the buttons in the corner. */
const RAISED = 'shadow-[0_2px_8px_rgba(0,0,0,0.18)]'

/** The marks on the map tags, the same plain glyphs the transform menu wears. */
const ICONS = {
  toMap: '✥',        // the move glyph: the selection goes onto the map
  toSelection: '⌖',  // a target: the map comes to the selection
  search: '⌕',
}

/** A small tag on the map that acts as a button; not a WebTUI key. */
function Tag({ title, onClick, icon, className = 'cursor-pointer', children, ...rest }) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      className={`inline-flex items-center gap-[0.75ch] bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap select-none hover:bg-black hover:text-white ${className}`}
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

/** The lines where the output is cut, like its outline, and the dotted margins drawn on. */
function Guides({ output }) {
  if (!hasLayout(output)) return null
  const [w, h] = [output.width_mm, output.height_mm]
  const cols = Math.max(1, output.columns ?? 1)
  const rows = Math.max(1, output.rows ?? 1)
  const line = { vectorEffect: 'non-scaling-stroke', fill: 'none' }
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {sheetsOf(output).map((s, i) => {
        const [x0, y0, x1, y1] = s.inner
        const margin = s.inner.some((v, k) => Math.abs(v - s.at[k]) > 1e-6)
        return margin && x1 > x0 && y1 > y0 ? (
          <rect key={i} x={x0} y={y0} width={x1 - x0} height={y1 - y0} stroke="#888" strokeDasharray="1 3" strokeWidth={1} {...line} />
        ) : null
      })}
      {Array.from({ length: cols - 1 }, (_, i) => (w * (i + 1)) / cols).map((x) => (
        <line key={`c${x}`} x1={x} y1={0} x2={x} y2={h} stroke="#000" strokeWidth={1} {...line} />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (h * (i + 1)) / rows).map((y) => (
        <line key={`r${y}`} x1={0} y1={y} x2={w} y2={y} stroke="#000" strokeWidth={1} {...line} />
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
export default function MapView({
  output,
  units,
  drawing,
  apiRef,
  load,
  loadTitle,
  onEditOutput,
  onDownload,
  onMoveOutput,
  onOutputKeys,
  onOutputToCentre,
  onCentreOnOutput,
  onSearch,
}) {
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const [mapView, setMapView] = useAtom(mapViewAtom)
  // The map is built once, in an effect with no dependencies; this holds the
  // saved view so that effect can read it without depending on it.
  const savedViewRef = useRef(mapView)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const labelRef = useRef(null)
  const tagsRef = useRef(null)
  const awayRef = useRef(null)
  const menuDragRef = useRef(false)
  const readyRef = useRef(false)
  const lastFitRef = useRef('')
  // While a drag is on, the output follows the pointer from here; the document
  // trails it by a frame.
  const editRef = useRef(null)
  const edit = editRef.current
  // Hold the edited output until the document comes back with it, or it would
  // snap to its old place for a frame.
  if (
    edit?.done &&
    output &&
    Math.abs(output.lat - edit.lat) < 1e-6 &&
    Math.abs(output.lng - edit.lng) < 1e-6 &&
    Math.abs(output.scale - edit.scale) < 0.5 &&
    Math.abs(norm(output.bearing ?? 0) - norm(edit.bearing ?? 0)) < 1e-6 &&
    Math.abs(output.width_mm - edit.width_mm) < 0.01 &&
    Math.abs(output.height_mm - edit.height_mm) < 0.01
  ) {
    editRef.current = null
  }
  const unitsRef = useRef(units)
  unitsRef.current = units ?? { width: 'mm', height: 'mm', terrain: 'km' }
  const outputRef = useRef(output)
  outputRef.current = editRef.current ? { ...output, ...editRef.current } : output

  // The overlay's screen box, computed and applied outside React so it can be
  // set from inside the map's render callback without a re-render per frame.
  const place = useCallback(() => {
    const map = mapRef.current
    const el = overlayRef.current
    if (!map || !el) return
    const b = outputRef.current ? outputBox(map, outputRef.current) : null
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    const away = !b || b.x > W || b.y > H || b.x + b.w < 0 || b.y + b.h < 0
    if (awayRef.current) awayRef.current.style.display = outputRef.current && away ? '' : 'none'
    const parts = [labelRef, tagsRef]
    if (away || b.w < 4 || b.h < 4) {
      el.style.display = 'none'
      for (const r of parts) if (r.current) r.current.style.display = 'none'
      return
    }
    for (const r of parts) if (r.current) r.current.style.display = ''
    el.style.display = ''
    el.style.transform = `translate(${b.x}px, ${b.y}px)`
    el.style.width = `${b.w}px`
    el.style.height = `${b.h}px`
    // Written here rather than by React, so a resize reads live.
    // The label over the top edge and the tags under the bottom one, flush
    // right; both outside, so the drawing is never covered, and `GAP` away.
    if (labelRef.current) {
      labelRef.current.textContent = sizeText(outputRef.current, unitsRef.current)
      labelRef.current.style.transform = `translate(${b.x}px, ${b.y - GAP}px) translateY(-100%)`
    }
    // The tags, and the menu open under them, stay on the map: past its right
    // or bottom edge they wait in that corner, so the output can be worked on
    // zoomed in on any part of it.
    if (tagsRef.current) {
      const t = tagsRef.current
      const x = Math.max(Math.min(b.x + b.w, W - EDGE), t.offsetWidth + EDGE)
      const y = Math.max(Math.min(b.y + b.h + GAP, H - t.offsetHeight - EDGE), EDGE)
      t.style.transform = `translate(${x}px, ${y}px) translateX(-100%)`
      // Waiting in the corner, the menu can cover the output it is moving.
      const under = menuDragRef.current && b.x < x && b.x + b.w > x - t.offsetWidth && b.y < y + t.offsetHeight && b.y + b.h > y
      t.style.opacity = under ? MENU_FADE : ''
    }
  }, [])

  /**
   * A drag that starts in the menu fades it over the output until release (see
   * `place`). The wheel still zooms the map meanwhile: the label holding the
   * pointer, or the menu under it, would take the wheel instead, so it is sent
   * on to the map at the same spot.
   */
  const holdMenu = (e) => {
    if (!e.target.closest?.('[data-drag]')) return
    menuDragRef.current = true
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
      menuDragRef.current = false
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
      renderWorldCopies: false,
      attributionControl: false,
    })
    mapRef.current = map
    // Bottom left: the output's tags wait in the bottom right corner and would cover it.
    map.addControl(new AttributionControl({ compact: true, customAttribution: CREDIT }), 'bottom-left')
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
      place()
    })

    // Restyle the basemap on every load, so a `setStyle` swap keeps it too.
    map.on('style.load', () => {
      calm(map)
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
        jumpTo: (lng, lat) => map.jumpTo({ center: [lng, lat] }),
        fit: (lng, lat) => {
          const at = outputRef.current ? { ...outputRef.current, lat, lng } : null
          const zoom = at ? map.getZoom() + zoomToFit(map, at, FIT_AIR) : map.getZoom()
          map.jumpTo({ center: [lng, lat], zoom })
        },
      }
    }

    // Where the map was last left is kept, so a reload comes back to it. Runs
    // on every settled move: a pan, a zoom, the wheel, not the drag between.
    const keep = () => setMapView({ lng: +map.getCenter().lng.toFixed(6), lat: +map.getCenter().lat.toFixed(6), zoom: +map.getZoom().toFixed(3) })
    map.on('moveend', keep)

    // The map's render loop drives the overlay, so the two never disagree.
    map.on('render', place)

    // The sidebar can be dragged wider: the canvas follows its container.
    // Resizing a canvas clears it, so it is drawn again at once, before the
    // browser paints, or each step of a drag flashes black. `redraw` does
    // nothing until the style is in, so ask for a frame instead.
    const resized = new ResizeObserver(() => {
      map.resize()
      if (map.style) map.redraw()
      else map.triggerRepaint()
    })
    resized.observe(containerRef.current)

    return () => {
      resized.disconnect()
      map.off('render', place)
      map.off('moveend', keep)
      if (apiRef) apiRef.current = null
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new drawing closes the transform menu, so it is seen whole. The same one
  // shown again (the output back where it was drawn) leaves the menu be.
  const shownRef = useRef(null)
  useEffect(() => {
    if (!drawing || drawing === shownRef.current) return
    shownRef.current = drawing
    setMenu(false)
  }, [drawing])

  // The rectangle lives on the map's render tick; recompute once after any
  // change that does not itself trigger a map render (sidebar edits, resize).
  useEffect(() => {
    place()
  })

  // A bearing written in the document turns the map about the output, so the
  // output stays where it is on screen. During a rotate the map already turns.
  const bearing = norm(output?.bearing ?? 0)
  useEffect(() => {
    const map = mapRef.current
    const c = outputRef.current
    if (!map || (editRef.current && !editRef.current.done)) return
    if (Math.abs(norm(map.getBearing() - bearing)) < 1e-6) return
    map.easeTo({ bearing, around: c ? [c.lng, c.lat] : undefined, duration: 0 })
  }, [bearing])

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
    const b = outputBox(map, output)
    const el = map.getContainer()
    if (b && b.w <= el.clientWidth - 2 * FIT_PAD && b.h <= el.clientHeight - 2 * FIT_PAD) return
    map.jumpTo({ zoom: map.getZoom() + zoomToFit(map, output) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey])

  /**
   * Follow the pointer with `step(map, from, dx, dy, event)`, once a frame:
   * the output moves and `write` puts it in the document, and once more on
   * release. A step that returns `again: true` is run the next frame too, the
   * pointer still or not.
   */
  const follow = (e, step, write) => {
    e.preventDefault()
    e.stopPropagation()
    const map = mapRef.current
    const from = outputRef.current
    if (!map || !from) return
    // A field being typed in would keep its text over the live value.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    const start = { x: e.clientX, y: e.clientY }
    let at = null
    let frame = 0
    const apply = () => {
      const { lat, lng, scale, bearing, width_mm, height_mm } = from
      const { again, ...to } = step(map, from, at.clientX - start.x, at.clientY - start.y, at)
      editRef.current = { lat, lng, scale, bearing, width_mm, height_mm, ...to }
      outputRef.current = { ...from, ...editRef.current }
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
      document.body.style.cursor = ''
      if (frame) {
        cancelAnimationFrame(frame)
        apply()
      }
      const to = editRef.current
      if (!at || !to || to.done) return
      to.done = true
      write(to)
    }
    document.body.style.cursor = getComputedStyle(e.currentTarget).cursor
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Move the output with the pointer, kept `KEEP` px inside the map (its label
   * too). Pushed past an edge it stops there and the map pans under it instead,
   * faster the further the pointer goes, so it cannot be dragged off screen;
   * the pointer near an edge pans it too. The same as a marker's auto-pan in Leaflet. An output that starts out past
   * an edge may stay out there, and is held in once it comes in; one bigger
   * than the map is held covering it.
   */
  const startDrag = (e) => {
    const map = mapRef.current
    const from = outputRef.current
    const b0 = map && from ? outputBox(map, from) : null
    if (!b0) return
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
    follow(
      e,
      (map, from, dx, dy, ev) => {
        const now = performance.now()
        const dt = Math.min(now - t, 50) / 1000
        t = now
        const el = map.getContainer()
        const { clientWidth: W, clientHeight: H } = el
        const r = el.getBoundingClientRect()
        const { w, h } = outputBox(map, outputRef.current) ?? b0
        // The box stops at the fence; the pointer it is pushed with may reach
        // the screen's edge first (the handle can sit far from the box's), so
        // the last `ZONE` px before the map's edge pan too.
        const hold = (k, want, size, view, near, start, p, p0) => {
          const lo = Math.min(near, view - KEEP - size)
          const hi = Math.max(near, view - KEEP - size)
          const f = range(fence, k, lo, hi, start, want)
          const got = Math.min(Math.max(want, f[0]), f[1])
          const push = want - got
          const z = range(zone, k, ZONE, view - ZONE, p0, p)
          const past = p < z[0] ? p - z[0] : p > z[1] ? p - z[1] : 0
          const speeds = [Math.min(Math.abs(push) * PUSH, PUSH_MAX), Math.min(Math.abs(past) / ZONE, 1) * PUSH_MAX]
          return { got, pan: Math.sign(push || past) * Math.max(...speeds) * dt }
        }
        const x = hold('x', b0.x + b0.w / 2 + dx - w / 2, w, W, KEEP, b0.x, ev.clientX - r.left, p0.x)
        const y = hold('y', b0.y + b0.h / 2 + dy - h / 2, h, H, KEEP + top, b0.y, ev.clientY - r.top, p0.y)
        const again = x.pan !== 0 || y.pan !== 0
        if (again) map.panBy([x.pan, y.pan], { animate: false })
        const next = map.unproject([x.got + w / 2, y.got + h / 2])
        return { lat: next.lat, lng: next.lng, again }
      },
      (to) => onMoveOutput?.({ lat: to.lat, lng: to.lng }),
    )
  }

  const slices = drawing?.slices?.length ?? 0

  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

      {/*
        Positioned with a transform on the map's own render tick (see `place`),
        so it can never be a frame behind the ground it sits on. Before the
        first draw it is a see-through frame, so the map it covers stays
        readable; once drawn it is a sheet of paper.
      */}
      <div
        ref={overlayRef}
        className={`pointer-events-none absolute left-0 top-0 overflow-hidden border border-black ${RAISED} ${
          drawing?.svg ? 'bg-white' : 'bg-white/20'
        }`}
        style={{ display: 'none', willChange: 'transform' }}
      >
        {drawing?.svg ? (
          <div
            className="output-svg h-full w-full"
            dangerouslySetInnerHTML={{ __html: scopeStyle(drawing.svg) }}
          />
        ) : null}
        {output && <Guides output={output} />}
      </div>

      {output && (
        <span
          ref={labelRef}
          className="pointer-events-none absolute left-0 top-0 z-10 bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap"
          style={{ display: 'none' }}
        />
      )}

      {output && (
        <div
          ref={tagsRef}
          className="absolute left-0 top-0 z-[25] flex flex-col items-end transition-opacity duration-150"
          style={{ display: 'none', willChange: 'transform' }}
        >
          {output.computed ? (
            <Tag title="The script computes its output, so it is moved and resized in the script">
              output computed by the script
            </Tag>
          ) : (
            <Tag
              title="Move, rotate and scale the output; its paper, slices and margins"
              aria-label="Transform the output"
              aria-expanded={menu}
              className={`cursor-pointer ${menu ? 'bg-black! text-white!' : ''}`}
              onClick={() => setMenu((m) => !m)}
            >
              transform {menu ? '▴' : '▾'}
            </Tag>
          )}
          {menu && !output.computed && (
            <div className={`mt-1 max-h-[70vh] overflow-y-auto bg-white/95 p-1.5 ${RAISED}`} onPointerDownCapture={holdMenu}>
              <OutputControls output={output} units={units} onEdit={onOutputKeys} onMove={startDrag} />
            </div>
          )}
        </div>
      )}

      {output && (
        <div className="absolute top-2 right-2 z-20 flex gap-1.5">
          <span ref={awayRef} className="bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap opacity-60" style={{ display: 'none' }}>
            The selection is out of view
          </span>
          {drawing?.svg && (
            <Tag
              title={slices ? `Save each of the ${slices} slices as its own SVG` : 'Save the drawing as an SVG'}
              aria-label="Download the output"
              className={`cursor-pointer bg-black! text-white! hover:underline ${RAISED}`}
              onClick={onDownload}
            >
              {slices ? `↓ download ${slices} slices` : '↓ download'}
            </Tag>
          )}
          {!output.computed && (
            <Tag icon={ICONS.toMap} title="Move the selection to the middle of the map" className={`cursor-pointer ${RAISED}`} onClick={onOutputToCentre}>
              selection to map
            </Tag>
          )}
          <Tag icon={ICONS.toSelection} title="Move the map so the selection is in the middle" className={`cursor-pointer ${RAISED}`} onClick={onCentreOnOutput}>
            map to selection
          </Tag>
          <Tag icon={ICONS.search} title="Find a place by address and move the selection there" className={`cursor-pointer ${RAISED}`} onClick={() => setSearch(true)}>
            search
          </Tag>
        </div>
      )}

      <SearchModal open={search} onClose={() => setSearch(false)} onPick={onSearch} />

      {/* The draw, reported over the map: a separate output, not a frame drawn
          inside the output that is about to be replaced. */}
      {load && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6">
          <LoadCard title={loadTitle} load={load} />
        </div>
      )}
    </div>
  )
}
