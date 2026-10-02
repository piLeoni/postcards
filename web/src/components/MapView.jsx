import { useCallback, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { cardBox, FIT_PAD, groundKm, paperName, sig3, zoomToFit } from '../lib/frame'
import LoadCard from './LoadCard'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

/** Scales the resize handle can reach, `1:N`. */
const MIN_SCALE = 500
const MAX_SCALE = 2_000_000

/** Space between the card and the label above it or the tags below it, px. */
const GAP = 4

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

/** "A6 · 148 × 105 mm · 1:8000 · 1.18 × 0.84 km". */
function sizeText(card) {
  const g = groundKm(card)
  if (!g) return ''
  const paper = paperName(card)
  return `${paper ? `${paper} · ` : ''}${sig3(card.width_mm)} × ${sig3(card.height_mm)} mm · 1:${sig3(card.scale)} · ${sig3(g[0])} × ${sig3(g[1])} km`
}

/**
 * The map, with the card drawn on top of it.
 *
 * The card is pinned to the ground: it has a lon/lat of its own and stays
 * there while you drag the map around underneath. Only the card's own handles
 * change it: `drag` moves it, `resize` changes its scale about its centre
 * (the paper stays the size the document says), and the result is written
 * into the document's `card:` block, so scrolling the map never drags your
 * card out of place.
 *
 * The rectangle is a DOM overlay, so it has to be redrawn on Mapbox's own
 * render tick, not on a React state change: React batches asynchronously and
 * lags the map by a frame, which is what makes overlays look like they are
 * stuttering. So we hook `render` and move the node directly.
 */
export default function MapView({
  card,
  drawing,
  apiRef,
  load,
  loadTitle,
  onMoveCard,
  onResizeCard,
  onCardToCentre,
  onCentreOnCard,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const labelRef = useRef(null)
  const tagsRef = useRef(null)
  const awayRef = useRef(null)
  const readyRef = useRef(false)
  const lastFitRef = useRef('')
  // While a drag or a resize is on, the card follows the pointer here and the
  // document is written once, on release.
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
    Math.abs(card.width_mm - edit.width_mm) < 0.01 &&
    Math.abs(card.height_mm - edit.height_mm) < 0.01
  ) {
    editRef.current = null
  }
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
    // The label over the top edge, the tags under the bottom one, flush right;
    // both outside, so the drawing is never covered, and `GAP` away from it.
    if (labelRef.current) {
      labelRef.current.textContent = sizeText(cardRef.current)
      labelRef.current.style.transform = `translate(${b.x}px, ${b.y - GAP}px) translateY(-100%)`
    }
    if (tagsRef.current) {
      tagsRef.current.style.transform = `translate(${b.x + b.w}px, ${b.y + b.h + GAP}px) translateX(-100%)`
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

  /** Follow the pointer with `step(map, from, dx, dy, event)`, then write it on release. */
  const follow = (e, step, done) => {
    e.preventDefault()
    e.stopPropagation()
    const map = mapRef.current
    const from = cardRef.current
    if (!map || !from) return
    const start = { x: e.clientX, y: e.clientY }
    const move = (ev) => {
      const { lat, lng, scale, width_mm, height_mm } = from
      editRef.current = { lat, lng, scale, width_mm, height_mm, ...step(map, from, ev.clientX - start.x, ev.clientY - start.y, ev) }
      cardRef.current = { ...from, ...editRef.current }
      place()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      const to = editRef.current
      if (!to) return
      to.done = true
      done(to)
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

  // The centre stays put and the corner follows the pointer along the
  // diagonal: the scale changes, the paper stays the size the document says.
  const startResize = (e) =>
    follow(
      e,
      (map, from, dx, dy) => {
        const b = cardBox(map, from)
        const [vx, vy] = [b.w / 2, b.h / 2]
        const f = Math.max(0.05, ((vx + dx) * vx + (vy + dy) * vy) / (vx * vx + vy * vy))
        return { scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, sig3(from.scale * f))) }
      },
      (to) => {
        const g = groundKm({ ...cardRef.current, scale: to.scale })
        if (g) lastFitRef.current = g.map(sig3).join('x')
        onResizeCard?.({ scale: to.scale })
      },
    )

  // The card has left the map view entirely; hide rather than clamp, so the
  // box never turns into a stray black sliver on an edge.
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
      </div>

      {card && (
        <span
          ref={labelRef}
          className="pointer-events-none absolute left-0 top-0 z-10 bg-white/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap"
          style={{ display: 'none' }}
        />
      )}

      {card && (
        <div ref={tagsRef} className="absolute left-0 top-0 z-20 flex gap-1" style={{ display: 'none', willChange: 'transform' }}>
          <Tag
            title="Drag the card across the map"
            aria-label="Drag the card"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={startDrag}
          >
            ⠿ drag
          </Tag>
          <Tag
            title="Drag to change the scale; the paper stays the same size"
            aria-label="Resize the card"
            className="cursor-nwse-resize"
            onPointerDown={startResize}
          >
            ⤡ resize
          </Tag>
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
