import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { cardBox, FIT_PAD, groundKm, hasLayout, lengthText, sheetsOf, sig3, zoomToFit } from '../lib/frame'
import CardControls from './CardControls'
import { norm, terrainPair } from './controls'
import LoadCard from './LoadCard'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

/** Space between the card and the label above it or the tags below it, px. */
const GAP = 4
/** Pixels the tags keep from the map's edges. */
const EDGE = 8

/** A small tag on the map that acts as a button; not a WebTUI key. */
function Tag({ title, onClick, className = 'cursor-pointer', children, ...rest }) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      className={`bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap select-none hover:bg-black hover:text-white ${className}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      {...rest}
    >
      {children}
    </span>
  )
}

/** "6 × 4 in", or "6in × 40mm" when the two sides are written in different units. */
function paperText(card, units) {
  const [w, h] = [lengthText(card.width_mm, units.width), lengthText(card.height_mm, units.height)]
  return units.width === units.height ? `${w.replace(units.width, '')} × ${h.replace(units.height, '')} ${units.width}` : `${w} × ${h}`
}

/** "6 × 4 in · 1:8000 · 0.758 × 0.505 mi · 30° · 3 × 2 slices", each in the unit the document uses. */
function sizeText(card, units) {
  if (!groundKm(card)) return ''
  const turned = Math.abs(norm(card.bearing ?? 0)) > 0.05 ? ` · ${Math.round(norm(card.bearing) * 1000) / 1000}°` : ''
  const cut = (card.columns ?? 1) * (card.rows ?? 1) > 1 ? ` · ${card.columns} × ${card.rows} slices` : ''
  return `${paperText(card, units)} · 1:${sig3(card.scale)} · ${terrainPair(card, units.terrain)}${turned}${cut}`
}

/** The lines where the card is cut, like its outline, and the dotted margins drawn on. */
function Guides({ card }) {
  if (!hasLayout(card)) return null
  const [w, h] = [card.width_mm, card.height_mm]
  const cols = Math.max(1, card.columns ?? 1)
  const rows = Math.max(1, card.rows ?? 1)
  const line = { vectorEffect: 'non-scaling-stroke', fill: 'none' }
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {sheetsOf(card).map((s, i) => {
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
 * The map, with the card drawn on top of it.
 *
 * The card is pinned to the ground: it has a lon/lat of its own and stays
 * there while you drag the map around underneath. Only the tools in its
 * `transform` menu change it: `move` moves it, `scale` changes its scale about
 * its centre (the paper stays the size the document says), `rotate` turns the
 * map under it, and the result is written into the document's `card:` block,
 * so scrolling the map never drags your card out of place.
 *
 * The card always faces you: a bearing turns the map, not the card. The map's
 * bearing is the card's, so the rectangle stays level on screen and the
 * drawing, turned the same way by the engine, lies on the map.
 *
 * The rectangle is a DOM overlay, so it has to be redrawn on Mapbox's own
 * render tick, not on a React state change: React batches asynchronously and
 * lags the map by a frame, which is what makes overlays look like they are
 * stuttering. So we hook `render` and move the node directly.
 */
export default function MapView({
  card,
  units,
  drawing,
  apiRef,
  load,
  loadTitle,
  onEditCard,
  onDownload,
  onMoveCard,
  onCardKeys,
  onCardToCentre,
  onCentreOnCard,
}) {
  const [menu, setMenu] = useState(false)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const labelRef = useRef(null)
  const tagsRef = useRef(null)
  const downloadRef = useRef(null)
  const awayRef = useRef(null)
  const readyRef = useRef(false)
  const lastFitRef = useRef('')
  // While a drag is on, the card follows the pointer from here; the document
  // trails it by a frame.
  const editRef = useRef(null)
  const edit = editRef.current
  // Hold the edited card until the document comes back with it, or it would
  // snap to its old place for a frame.
  if (
    edit?.done &&
    card &&
    Math.abs(card.lat - edit.lat) < 1e-6 &&
    Math.abs(card.lng - edit.lng) < 1e-6 &&
    Math.abs(card.scale - edit.scale) < 0.5 &&
    Math.abs(norm(card.bearing ?? 0) - norm(edit.bearing ?? 0)) < 1e-6 &&
    Math.abs(card.width_mm - edit.width_mm) < 0.01 &&
    Math.abs(card.height_mm - edit.height_mm) < 0.01
  ) {
    editRef.current = null
  }
  const unitsRef = useRef(units)
  unitsRef.current = units ?? { width: 'mm', height: 'mm', terrain: 'km' }
  const cardRef = useRef(card)
  cardRef.current = editRef.current ? { ...card, ...editRef.current } : card

  // The overlay's screen box, computed and applied outside React so it can be
  // set from inside Mapbox's render callback without a re-render per frame.
  const place = useCallback(() => {
    const map = mapRef.current
    const el = overlayRef.current
    if (!map || !el) return
    const b = cardRef.current ? cardBox(map, cardRef.current) : null
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    const away = !b || b.x > W || b.y > H || b.x + b.w < 0 || b.y + b.h < 0
    if (awayRef.current) awayRef.current.style.display = cardRef.current && away ? '' : 'none'
    const parts = [labelRef, tagsRef, downloadRef]
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
    // The label over the top edge, the tags under the bottom one, `download`
    // flush left and the handles flush right; all outside, so the drawing is
    // never covered, and `GAP` away from it.
    if (downloadRef.current) downloadRef.current.style.transform = `translate(${b.x}px, ${b.y + b.h + GAP}px)`
    if (labelRef.current) {
      labelRef.current.textContent = sizeText(cardRef.current, unitsRef.current)
      labelRef.current.style.transform = `translate(${b.x}px, ${b.y - GAP}px) translateY(-100%)`
    }
    // The tags, and the menu open under them, stay on the map: past its right
    // or bottom edge they wait in that corner, so the card can be worked on
    // zoomed in on any part of it.
    if (tagsRef.current) {
      const t = tagsRef.current
      const x = Math.max(Math.min(b.x + b.w, W - EDGE), t.offsetWidth + EDGE)
      const y = Math.max(Math.min(b.y + b.h + GAP, H - t.offsetHeight - EDGE), EDGE)
      t.style.transform = `translate(${x}px, ${y}px) translateX(-100%)`
    }
  }, [])

  // Mapbox wants a token before anything else; bail early if there is none.
  useEffect(() => {
    if (!MAPBOX_TOKEN) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: card ? [card.lng, card.lat] : [-122.256196, 37.8771145],
      bearing: card?.bearing ?? 0,
      zoom: 14,
      minZoom: 2,
      projection: 'mercator',
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      attributionControl: false,
    })
    mapRef.current = map
    // The bearing belongs to the card: only `rotate` turns the map.
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    map.on('error', (e) => {
      const err = e.error ?? {}
      const url = String(err.url ?? '').replace(/access_token=[^&]+/, 'access_token=…')
      console.error('mapbox:', err.status ?? '', err.message ?? String(err), url)
    })

    map.on('load', () => {
      map.resize()
      readyRef.current = true
      place()
    })

    // The only surface App gets on the map: where its centre is, and how to
    // move it there. Everything else flows through `card`.
    if (apiRef) {
      apiRef.current = {
        center: () => {
          const c = map.getCenter()
          return { lat: c.lat, lng: c.lng }
        },
        jumpTo: (lng, lat) => map.jumpTo({ center: [lng, lat] }),
      }
    }

    // Mapbox's render loop drives the overlay, so the two never disagree.
    map.on('render', place)

    // The sidebar can be dragged wider: the canvas follows its container.
    // Resizing a canvas clears it, so it is drawn again at once, before the
    // browser paints, or each step of a drag flashes black. Mapbox v3 has no
    // public synchronous redraw; `_render` is the one `redraw()` used to call.
    const resized = new ResizeObserver(() => {
      map.resize()
      if (typeof map._render === 'function') map._render(performance.now())
      else map.triggerRepaint()
    })
    resized.observe(containerRef.current)

    return () => {
      resized.disconnect()
      map.off('render', place)
      if (apiRef) apiRef.current = null
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The rectangle lives on Mapbox's render tick; recompute once after any
  // change that does not itself trigger a map render (sidebar edits, resize).
  useEffect(() => {
    place()
  })

  // A bearing written in the document turns the map about the card, so the
  // card stays where it is on screen. During a rotate the map already turns.
  const bearing = norm(card?.bearing ?? 0)
  useEffect(() => {
    const map = mapRef.current
    const c = cardRef.current
    if (!map || (editRef.current && !editRef.current.done)) return
    if (Math.abs(norm(map.getBearing() - bearing)) < 1e-6) return
    map.easeTo({ bearing, around: c ? [c.lng, c.lat] : undefined, duration: 0 })
  }, [bearing])

  // When the card's ground size changes in the document, zoom out only if it
  // no longer fits the map: a card that still fits keeps the zoom, so a new
  // width reads as a wider card, not as the map moving. A resize on the map
  // is already where you want it.
  const ground = card ? groundKm(card) : null
  const groundKey = ground ? ground.map(sig3).join('x') : ''
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !card || !groundKey) return
    if (lastFitRef.current === groundKey) return
    lastFitRef.current = groundKey
    const b = cardBox(map, card)
    const el = map.getContainer()
    if (b && b.w <= el.clientWidth - 2 * FIT_PAD && b.h <= el.clientHeight - 2 * FIT_PAD) return
    map.jumpTo({ zoom: map.getZoom() + zoomToFit(map, card) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey])

  /**
   * Follow the pointer with `step(map, from, dx, dy, event)`. The card moves
   * on every pointer event; `write` puts it in the document at most once a
   * frame while the drag lasts, and once more on release.
   */
  const follow = (e, step, write) => {
    e.preventDefault()
    e.stopPropagation()
    const map = mapRef.current
    const from = cardRef.current
    if (!map || !from) return
    // A field being typed in would keep its text over the live value.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    let queued = false
    const move = (ev) => {
      // The drawing is of where the card was: it goes as soon as the card moves.
      if (!moved) onEditCard?.()
      moved = true
      const { lat, lng, scale, bearing, width_mm, height_mm } = from
      editRef.current = { lat, lng, scale, bearing, width_mm, height_mm, ...step(map, from, ev.clientX - start.x, ev.clientY - start.y, ev) }
      cardRef.current = { ...from, ...editRef.current }
      place()
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        const to = editRef.current
        if (to && !to.done) write(to)
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      const to = editRef.current
      if (!to || to.done) return
      to.done = true
      write(to)
    }
    document.body.style.cursor = getComputedStyle(e.currentTarget).cursor
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startDrag = (e) =>
    follow(
      e,
      (map, from, dx, dy) => {
        const pt = map.project([from.lng, from.lat])
        const next = map.unproject([pt.x + dx, pt.y + dy])
        return { lat: next.lat, lng: next.lng }
      },
      (to) => onMoveCard?.({ lat: to.lat, lng: to.lng }),
    )

  const slices = drawing?.slices?.length ?? 0

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--background1)] p-8">
        <div box-="square" className="max-w-lg p-[2ch]">
          <p className="font-bold">Mapbox token required</p>
          <p className="mt-[0.5lh] opacity-70">
            Create one at{' '}
            <a className="underline" href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer">
              account.mapbox.com
            </a>
            , then put it in <code>web/.env.local</code>:
          </p>
          <pre className="mt-[0.5lh] bg-[var(--background1)] px-[1ch]">VITE_MAPBOX_TOKEN=pk.…</pre>
          <p className="mt-[0.5lh] opacity-70">Restart <code>npm run dev</code> after saving.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

      {/*
        Positioned with a transform on Mapbox's own render tick (see `place`),
        so it can never be a frame behind the ground it sits on. Before the
        first draw it is a see-through frame, so the map it covers stays
        readable; once drawn it is a sheet of paper.
      */}
      <div
        ref={overlayRef}
        className={`pointer-events-none absolute left-0 top-0 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.18)] ${
          drawing?.svg ? 'bg-white' : 'border border-black bg-white/20'
        }`}
        style={{ display: 'none', willChange: 'transform' }}
      >
        {drawing?.svg ? (
          <div
            className="card-svg h-full w-full"
            dangerouslySetInnerHTML={{ __html: drawing.svg }}
          />
        ) : null}
        {card && <Guides card={card} />}
      </div>

      {card && (
        <span
          ref={labelRef}
          className="pointer-events-none absolute left-0 top-0 z-10 bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap"
          style={{ display: 'none' }}
        />
      )}

      {card && drawing?.svg && (
        <div ref={downloadRef} className="absolute left-0 top-0 z-20 flex" style={{ display: 'none', willChange: 'transform' }}>
          <Tag
            title={slices ? `Save each of the ${slices} slices as its own SVG` : 'Save the drawing as an SVG'}
            aria-label="Download the card"
            onClick={onDownload}
          >
            {slices ? `↓ download ${slices} slices` : '↓ download'}
          </Tag>
        </div>
      )}

      {card && (
        <div ref={tagsRef} className="absolute left-0 top-0 z-[25] flex flex-col items-end" style={{ display: 'none', willChange: 'transform' }}>
          <Tag
            title="Move, rotate and scale the card; its paper, slices and margins"
            aria-label="Transform the card"
            aria-expanded={menu}
            className={`cursor-pointer ${menu ? 'bg-black! text-white!' : ''}`}
            onClick={() => setMenu((m) => !m)}
          >
            transform {menu ? '▴' : '▾'}
          </Tag>
          {menu && (
            <div className="mt-1 max-h-[70vh] overflow-y-auto bg-white/95 p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
              <CardControls card={card} units={units} onEdit={onCardKeys} onMove={startDrag} />
            </div>
          )}
        </div>
      )}

      {card && (
        <div className="absolute top-2 right-2 z-20 flex gap-1">
          <span ref={awayRef} className="bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap opacity-60" style={{ display: 'none' }}>
            The card is out of view
          </span>
          <Tag title="Move the card to the middle of the map" onClick={onCardToCentre}>card to centre</Tag>
          <Tag title="Move the map so the card is in the middle" onClick={onCentreOnCard}>centre on card</Tag>
        </div>
      )}

      {/* The draw, reported over the map: a separate card, not a frame drawn
          inside the card that is about to be replaced. */}
      {load && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-6">
          <LoadCard title={loadTitle} load={load} />
        </div>
      )}
    </div>
  )
}
