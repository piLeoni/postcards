import { useRef, useState } from 'react'
import { lengthText, MM_PER, sig3 } from '../lib/frame'

/**
 * Small controls for editing values in place: a text field that steps with
 * the arrows, and a label that steps it when dragged sideways. Both read
 * and write through a model, so a value looks and steps the same wherever
 * it is edited:
 *
 *   { text(v) → string, parse(s) → v | null, nudge(v, n, shift) → v, snap?(v) → v }
 *
 * `nudge` moves `n` steps (Shift: bigger ones); `snap`, when given, is what
 * Shift does while dragging instead.
 */

/** A field fills its grid cell; the columns decide the width. */
const FIELD = 'h-auto w-full min-w-0 border border-black bg-white px-1 text-right font-mono text-[10px] leading-[1.6]'

/** Pixels dragged per step of a label. */
const PX_PER_STEP = 4

/**
 * A short text field that writes as you type: what parses is written, the
 * arrows step it (Shift for bigger steps). Once left, it shows `value`.
 */
export function Field({ label, title, model, value, onChange, muted = false, className = '' }) {
  const ref = useRef(null)
  const [draft, setDraft] = useState(null)
  // What was typed shows only while the field has the focus.
  const shown = draft != null && ref.current && document.activeElement === ref.current ? draft : model.text(value)
  const put = (s) => {
    setDraft(s)
    const v = model.parse(s)
    if (v != null) onChange(v)
  }
  return (
    <input
      ref={ref}
      type="text"
      spellCheck={false}
      aria-label={label}
      title={title}
      value={shown}
      className={`${FIELD} ${muted ? 'text-black/45 focus:text-black' : ''} ${className}`}
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
        const next = model.nudge(model.parse(shown) ?? value, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
        setDraft(model.text(next))
        onChange(next)
      }}
    />
  )
}

/**
 * A label that edits its value when dragged sideways: one step every `px`
 * pixels, written at most once a frame, Shift for the model's snap (or its
 * bigger steps). `sign: -1` turns the drag around. `onPointerDown` replaces
 * the sideways drag with one of the caller's (moving the card on the map).
 */
export function Scrub({ icon, label, title, model, value, onChange, sign = 1, px = PX_PER_STEP, onPointerDown, children }) {
  // Held from press to release: the pointer outruns the label, and what it
  // passes over must not light up instead.
  const [held, setHeld] = useState(false)
  const hold = (e) => {
    // A pointer already gone (or a synthetic one) cannot be captured.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    setHeld(true)
    const release = () => {
      setHeld(false)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    ;(onPointerDown ?? scrub)(e)
  }
  const scrub = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    const x0 = e.clientX
    const from = value
    let last = 0
    let next = null
    let queued = false
    const move = (ev) => {
      const n = Math.round((ev.clientX - x0) / px) * sign
      if (n === last && !ev.shiftKey) return
      last = n
      next = ev.shiftKey && model.snap ? model.snap(model.nudge(from, n, false)) : model.nudge(from, n, ev.shiftKey)
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        onChange(next)
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const draggable = Boolean(onPointerDown || model)
  return (
    <span
      title={title}
      aria-label={label}
      className={`flex items-center gap-1 whitespace-nowrap px-1 select-none ${
        draggable ? `hover:bg-black hover:text-white ${onPointerDown ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize'}` : ''
      } ${held ? 'bg-black text-white' : ''}`}
      onPointerDown={draggable ? hold : undefined}
    >
      {icon && <span className="w-[1.5ch] text-center">{icon}</span>}
      <span>{label}</span>
      {children}
    </span>
  )
}

/** A titled group of rows on a grid of its own: `cols` is its Tailwind `grid-cols-*`. */
export function Section({ title, cols, first = false, children }) {
  return (
    <div className={first ? '' : 'mt-1 border-t border-black/20 pt-1'}>
      <div className="px-1 pb-0.5 text-[9px] uppercase tracking-wider opacity-50">{title}</div>
      <div className={`grid items-center gap-x-1.5 gap-y-1 ${cols}`}>{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/*  Models                                                          */
/* ---------------------------------------------------------------- */

const round3 = (v) => Math.round(v * 1000) / 1000

/** A bearing in (-180, 180], as Mapbox reports it. */
export const norm = (b) => {
  const r = ((((b + 180) % 360) + 360) % 360) - 180
  return r === -180 ? 180 : r
}

/** One arrow step of a paper length in its own unit. */
const LENGTH_STEP = { mm: 0.5, cm: 0.05, in: 0.05 }
const PAPER_UNITS = { mm: 'mm', cm: 'cm', in: 'in', inch: 'in', inches: 'in', '"': 'in' }

/** A paper length, `{ mm, unit }`: typed with mm, cm or in; a bare number keeps `unit`. */
export function lengthModel(unit, { min = 0 } = {}) {
  const parse = (s) => {
    const m = s.match(/^\s*(\d*\.?\d+)\s*([a-z"]+)?\s*$/i)
    const u = m && (m[2] ? PAPER_UNITS[m[2].toLowerCase()] : unit)
    if (!u) return null
    const mm = Number(m[1]) * MM_PER[u]
    return mm >= min ? { mm, unit: u } : null
  }
  return {
    text: (v) => lengthText(v.mm, v.unit),
    parse,
    nudge: (v, n, shift) => {
      const k = MM_PER[v.unit]
      const x = round3(v.mm / k + n * LENGTH_STEP[v.unit] * (shift ? 10 : 1))
      return { mm: Math.max(min, x * k), unit: v.unit }
    },
  }
}

/** Metres in each unit a terrain distance may be written in. */
export const M_PER = { m: 1, km: 1000, mi: 1609.344, ft: 0.3048 }
const TERRAIN_UNITS = { m: 'm', km: 'km', mi: 'mi', mile: 'mi', miles: 'mi', ft: 'ft', feet: 'ft' }

/** "1.22km": a distance on the terrain in metres, written in `unit`, three figures. */
export const terrainText = (m, unit = 'km') => `${sig3(m / M_PER[unit])}${unit}`

/** "1.22 × 0.813 km": the card's terrain, paper × scale, in one unit. */
export function terrainPair(card, unit = 'km') {
  const [w, h] = [card.width_mm, card.height_mm].map((v) => sig3(((v / 1000) * card.scale) / M_PER[unit]))
  return `${w} × ${h} ${unit}`
}

/** A terrain distance, `{ m, unit }`: m, km, mi or ft; each step is 2% (Shift 20%). */
export function terrainModel(unit) {
  return {
    text: (v) => terrainText(v.m, v.unit),
    parse: (s) => {
      const m = s.match(/^\s*(\d*\.?\d+)\s*([a-z]+)?\s*$/i)
      const u = m && (m[2] ? TERRAIN_UNITS[m[2].toLowerCase()] : unit)
      return u && Number(m[1]) > 0 ? { m: Number(m[1]) * M_PER[u], unit: u } : null
    },
    nudge: (v, n, shift) => ({ m: sig3(v.m / M_PER[v.unit] * (shift ? 1.2 : 1.02) ** n) * M_PER[v.unit], unit: v.unit }),
  }
}

/** Scales the scale reaches, `1:N`. */
export const MIN_SCALE = 500
export const MAX_SCALE = 2_000_000

/** A scale denominator: "1:8000" or "8000"; each step is 2% (Shift 20%). */
export const scaleModel = {
  text: (v) => `1:${Math.round(v)}`,
  parse: (s) => {
    const m = s.replace(/[_,\s]/g, '').match(/^(?:1:)?(\d*\.?\d+)$/)
    const v = m && Number(m[1])
    return v >= MIN_SCALE && v <= MAX_SCALE ? v : null
  },
  nudge: (v, n, shift) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, sig3(v * (shift ? 1.2 : 1.02) ** n))),
}

/** Whole numbers from 1; Shift steps by ten. */
export const countModel = {
  text: (v) => String(v),
  parse: (s) => (/^\s*\d+\s*$/.test(s) && Number(s) >= 1 ? Number(s) : null),
  nudge: (v, n, shift) => Math.max(1, v + n * (shift ? 10 : 1)),
}

/** The Shift step of a bearing, in degrees. */
export const SNAP_DEG = 15

/** Degrees in (-180, 180]: a whole degree a step, Shift a snap of 15. */
export const angleModel = {
  text: (v) => `${round3(v) || 0}°`,
  parse: (s) => {
    const m = s.match(/^\s*(-?\d*\.?\d+)\s*°?\s*$/)
    return m ? norm(Number(m[1])) : null
  },
  nudge: (v, n, shift) => norm(shift ? (Math.round(v / SNAP_DEG) + n) * SNAP_DEG : Math.round(v) + n),
  snap: (v) => norm(Math.round(v / SNAP_DEG) * SNAP_DEG),
}

/** Latitude or longitude, six decimals (about 10 cm); a step is about 10 m. */
export function degreesModel(limit) {
  return {
    text: (v) => v.toFixed(6),
    parse: (s) => {
      const v = Number(s.trim())
      return s.trim() && Number.isFinite(v) && Math.abs(v) <= limit ? v : null
    },
    nudge: (v, n, shift) => Math.max(-limit, Math.min(limit, v + n * (shift ? 0.001 : 0.0001))),
  }
}

/** Text taken as typed, when `accept` likes it; nothing to step. */
export function textModel(accept = () => true) {
  return {
    text: (v) => v,
    parse: (s) => (accept(s) ? s : null),
    nudge: (v) => v,
  }
}
