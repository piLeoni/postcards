import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { cardBox, FIT_PAD, groundKm, hasLayout, lengthText, MM_PER, paperName, sheetsOf, sig3, zoomToFit } from '../lib/frame'
import LoadCard from './LoadCard'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

/** Scales the scale handle can reach, `1:N`. */
const MIN_SCALE = 500
const MAX_SCALE = 2_000_000

/** Degrees the map turns per pixel dragged sideways, and the Shift step. */
const DEG_PER_PX = 0.4
const SNAP_DEG = 15

/** A bearing in (-180, 180], as Mapbox reports it. */
const norm = (b) => {
  const r = ((((b + 180) % 360) + 360) % 360) - 180
  return r === -180 ? 180 : r
}

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

/** "A6 · 148 × 105 mm · 1:8000 · 1.18 × 0.84 km · 30° · 3 × 2 slices". */
function sizeText(card) {
  const g = groundKm(card)
  if (!g) return ''
  const paper = paperName(card)
  const turned = Math.abs(norm(card.bearing ?? 0)) > 0.05 ? ` · ${sig3(norm(card.bearing))}°` : ''
  const cut = (card.columns ?? 1) * (card.rows ?? 1) > 1 ? ` · ${card.columns} × ${card.rows} slices` : ''
  return `${paper ? `${paper} · ` : ''}${sig3(card.width_mm)} × ${sig3(card.height_mm)} mm · 1:${sig3(card.scale)} · ${sig3(g[0])} × ${sig3(g[1])} km${turned}${cut}`
}

/** Every field in the transform menu is this wide, so they line up. */
const FIELD = 'h-auto w-[8ch] min-w-0 border border-black bg-white px-1 text-right font-mono text-[10px] leading-[1.6]'

/**
 * A short text field in the transform menu that writes as you type. `parse`
 * turns the text into a value (or `null`, written nothing); the arrows call
 * `step(text, ±1, shift)` for the next text. Once left, it shows the document.
 */
function Field({ label, title, text, parse, step, onChange }) {
  const ref = useRef(null)
  const [draft, setDraft] = useState(null)
  // What was typed shows only while the field has the focus.
  const shown = draft != null && ref.current && document.activeElement === ref.current ? draft : text
  const put = (s) => {
    setDraft(s)
    const v = parse(s)
    if (v != null) onChange(v)
  }
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      aria-label={label}
      title={title}
      value={shown}
      className={FIELD}
      onChange={(e) => put(e.target.value)}
      onFocus={(e) => {
        setDraft(null)
        e.target.select()
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const next = step(shown, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
        if (next != null) put(next)
      }}
    />
  )
}

/** One arrow step of a length in its own unit. */
const LENGTH_STEP = { mm: 0.5, cm: 0.05, in: 0.05 }
const LENGTH = /^\s*(\d*\.?\d+)\s*(mm|cm|in|inch|inches|")?\s*$/i
const unitOf = (u) => ({ inch: 'in', inches: 'in', '"': 'in' })[u] ?? u

/** "0.25in" → `{ mm: 6.35, unit: 'in' }`; a bare number takes `unit`. */
function parseLength(s, unit) {
  const m = s.match(LENGTH)
  if (!m) return null
  const u = m[2] ? unitOf(m[2].toLowerCase()) : unit
  return { mm: Number(m[1]) * MM_PER[u], unit: u }
}

function stepLength(s, unit, dir, shift) {
  const v = parseLength(s, unit)
  if (!v) return null
  const n = v.mm / MM_PER[v.unit] + dir * LENGTH_STEP[v.unit] * (shift ? 10 : 1)
  return lengthText(Math.max(0, n) * MM_PER[v.unit], v.unit)
}

/** A length field: written with its unit, a bare number keeps the one it had. */
function LengthField({ label, title, mm, unit, onChange }) {
  return (
    <Field
      label={label}
      title={title}
      text={lengthText(mm, unit)}
      parse={(s) => parseLength(s, unit)}
      step={(s, dir, shift) => stepLength(s, unit, dir, shift)}
      onChange={onChange}
    />
  )
}

/** A whole number from 1 up; Shift steps by ten. */
function CountField({ label, title, value, onChange }) {
  const parse = (s) => (/^\s*\d+\s*$/.test(s) && Number(s) >= 1 ? Number(s) : null)
  return (
    <Field
      label={label}
      title={title}
      text={String(value)}
      parse={parse}
      step={(s, dir, shift) => String(Math.max(1, (parse(s) ?? value) + dir * (shift ? 10 : 1)))}
      onChange={onChange}
    />
  )
}

/** Degrees, in (-180, 180]; Shift steps by the snap. */
function AngleField({ value, onChange }) {
  const parse = (s) => {
    const m = s.match(/^\s*(-?\d*\.?\d+)\s*°?\s*$/)
    return m ? norm(Number(m[1])) : null
  }
  return (
    <Field
      label="bearing"
      title={`The map's turn under the card, in degrees clockwise; arrows step 1°, Shift ${SNAP_DEG}°`}
      text={`${Math.round(value * 1000) / 1000 || 0}°`}
      parse={parse}
      step={(s, dir, shift) => {
        const v = parse(s) ?? value
        const n = shift ? (Math.round(v / SNAP_DEG) + dir) * SNAP_DEG : Math.round(v) + dir
        return `${norm(n)}°`
      }}
      onChange={onChange}
    />
  )
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
  onResizeCard,
  onRotateCard,
  onLayoutCard,
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

  // Sideways drag turns the map about the card's centre, so the card stays
  // put and level; dragging right turns the map clockwise, like a dial under
  // your finger. Shift snaps to whole steps.
  const startRotate = (e) =>
    follow(
      e,
      (map, from, dx, _dy, ev) => {
        let b = (from.bearing ?? 0) - dx * DEG_PER_PX
        if (ev.shiftKey) b = Math.round(b / SNAP_DEG) * SNAP_DEG
        b = norm(Math.round(b))
        map.easeTo({ bearing: b, around: [from.lng, from.lat], duration: 0 })
        return { bearing: b }
      },
      (to) => onRotateCard?.({ bearing: to.bearing }),
    )

  const layout = {
    padding_mm: card?.padding_mm ?? 0,
    padding_unit: units?.padding ?? 'mm',
    columns: card?.columns ?? 1,
    rows: card?.rows ?? 1,
    slice_padding_mm: card?.slice_padding_mm ?? 0,
    slice_padding_unit: units?.gutter ?? 'mm',
  }
  const setLayout = (patch) => onLayoutCard?.({ ...layout, ...patch })
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
        <div ref={tagsRef} className="absolute left-0 top-0 z-20" style={{ display: 'none', willChange: 'transform' }}>
          <Tag
            title="Move, scale and rotate the card; cut it into slices"
            aria-label="Transform the card"
            aria-expanded={menu}
            className={`cursor-pointer ${menu ? 'bg-black! text-white!' : ''}`}
            onClick={() => setMenu((m) => !m)}
          >
            transform {menu ? '▴' : '▾'}
          </Tag>
          {menu && (
            <div className="absolute right-0 top-full mt-1 grid w-max grid-cols-[auto_auto_auto_auto] items-center gap-x-1.5 gap-y-1 bg-white/95 p-1.5 font-mono text-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
              <Tag
                title="Drag the card across the map"
                aria-label="Drag the card"
                className="col-span-2 cursor-grab active:cursor-grabbing"
                onPointerDown={startDrag}
              >
                ✥ move
              </Tag>
              <Tag
                title="Drag to change the scale; the paper stays the same size"
                aria-label="Resize the card"
                className="col-span-2 cursor-nwse-resize"
                onPointerDown={startResize}
              >
                ⤡ scale
              </Tag>
              <Tag
                title={`Drag left or right to turn the map under the card; hold Shift for ${SNAP_DEG}° steps`}
                aria-label="Rotate the card"
                className="col-span-3 cursor-ew-resize"
                onPointerDown={startRotate}
              >
                ↻ rotate
              </Tag>
              <AngleField value={bearing} onChange={(b) => onRotateCard?.({ bearing: b })} />
              <div className="col-span-4 my-0.5 border-t border-black/30" />
              <span className="opacity-70">columns</span>
              <CountField label="columns" title="Sheets across" value={layout.columns} onChange={(columns) => setLayout({ columns })} />
              <span className="opacity-70">rows</span>
              <CountField label="rows" title="Sheets down" value={layout.rows} onChange={(rows) => setLayout({ rows })} />
              <span className="opacity-70">gutter</span>
              <LengthField
                label="gutter"
                title="Blank margin inside every sheet; type mm, cm or in, a bare number keeps the unit"
                mm={layout.slice_padding_mm}
                unit={layout.slice_padding_unit}
                onChange={({ mm, unit }) => setLayout({ slice_padding_mm: mm, slice_padding_unit: unit })}
              />
              <span className="opacity-70">padding</span>
              <LengthField
                label="padding"
                title="Blank margin inside the paper's edge; type mm, cm or in, a bare number keeps the unit"
                mm={layout.padding_mm}
                unit={layout.padding_unit}
                onChange={({ mm, unit }) => setLayout({ padding_mm: mm, padding_unit: unit })}
              />
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
