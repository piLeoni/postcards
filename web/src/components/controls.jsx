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

/** A field fills its grid cell; the columns decide the width, the host the type size. */
const FIELD = 'chrome-field h-auto w-full min-w-0 px-1 text-right font-mono text-[length:inherit] leading-[1.6]'

/** Pixels dragged per step of a label (scale scrub and transform tag). */
export const PX_PER_STEP = 4

/**
 * Dragging sideways to step `value` through `model`: one step every `px`
 * pixels, written at most once a frame, Shift for the model's snap (or its
 * bigger steps); `sign: -1` turns it around. `custom`, when given, is a drag
 * of the caller's instead. `held` is true from press to release: the pointer
 * outruns what it grabbed, and what it passes over must not light up instead.
 * What it is on carries `data-drag`, so a host can tell a drag from a click.
 */
function useDrag({ model, value, onChange, sign = 1, px = PX_PER_STEP, custom }) {
  const [held, setHeld] = useState(false)
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
  const onPointerDown = (e) => {
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
    ;(custom ?? scrub)(e)
  }
  return { held, onPointerDown }
}

/** What a draggable thing looks like: lit while hovered, and while held. */
const grabbed = (held) =>
  `hover:bg-[var(--foreground0)] hover:text-[var(--background0)] ${held ? 'bg-[var(--foreground0)] text-[var(--background0)]' : ''}`

/**
 * A short text field. What is typed is written when confirmed, with Enter or
 * by leaving the field, if it parses; Escape drops it. The arrows step the
 * value at once (Shift for bigger steps), and the ↔ on its left drags it
 * alone, live (`px`, `sign` as for `Scrub`).
 */
export function Field({ label, title, model, value, onChange, px, sign, muted = false, className = '' }) {
  const ref = useRef(null)
  const [draft, setDraft] = useState(null)
  const drag = useDrag({ model, value, onChange, px, sign })
  // What was typed shows only while the field has the focus.
  const shown = draft != null && ref.current && document.activeElement === ref.current ? draft : model.text(value)
  // Enter and Escape settle the draft themselves; the blur they cause must not again.
  const settledRef = useRef(false)
  const commit = () => {
    if (settledRef.current) {
      settledRef.current = false
      return
    }
    const v = draft != null ? model.parse(draft) : null
    if (v != null && model.text(v) !== model.text(value)) onChange(v)
    setDraft(null)
  }
  return (
    <span className="relative block min-w-0">
      <input
        ref={ref}
        type="text"
        spellCheck={false}
        aria-label={label}
        title={title}
        value={shown}
        className={`${FIELD} pl-[2.2ch] ${muted ? 'opacity-45 focus:opacity-100' : ''} ${className}`}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          settledRef.current = false
          setDraft(null)
          e.target.select()
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            settledRef.current = true
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setDraft(null)
            settledRef.current = true
            e.currentTarget.blur()
          }
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          const next = model.nudge(model.parse(shown) ?? value, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
          setDraft(null)
          onChange(next)
        }}
      />
      <span
        aria-hidden
        title={`Drag to change the ${label} alone`}
        data-drag
        className={`absolute inset-y-px left-px flex w-[1.8ch] cursor-ew-resize items-center justify-center opacity-35 select-none ${grabbed(drag.held)}`}
        onPointerDown={drag.onPointerDown}
      >
        ↔
      </span>
    </span>
  )
}

/**
 * A label that edits its value when dragged sideways (see `useDrag`).
 * `onPointerDown` replaces the sideways drag with one of the caller's
 * (moving the output on the map).
 */
export function Scrub({ icon, label, title, model, value, onChange, sign, px, onPointerDown, children }) {
  const drag = useDrag({ model, value, onChange, sign, px, custom: onPointerDown })
  const draggable = Boolean(onPointerDown || model)
  return (
    <span
      title={title}
      aria-label={label}
      data-drag={draggable || undefined}
      className={`flex items-center gap-1 whitespace-nowrap px-1 select-none ${
        draggable ? `${grabbed(drag.held)} ${onPointerDown ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize'}` : ''
      }`}
      onPointerDown={draggable ? drag.onPointerDown : undefined}
    >
      {icon && <span className="w-[1.5ch] text-center">{icon}</span>}
      <span>{label}</span>
      {children}
    </span>
  )
}

/**
 * One of a few options, side by side in a field's box; the chosen one is
 * inverted. `options` are `[value, text]`.
 */
export function Choice({ label, title, options, value, onChange, isOptionDisabled }) {
  return (
    <span role="radiogroup" aria-label={label} title={title} className="chrome-surface chrome-border flex min-w-0 border text-[0.9em] leading-[1.75] select-none">
      {options.map(([v, text], i) => {
        const off = isOptionDisabled?.(v)
        const on = v === value
        return (
          <span
            key={v}
            role="radio"
            aria-checked={on}
            aria-disabled={off || undefined}
            tabIndex={off ? -1 : on ? 0 : -1}
            className={`min-w-0 flex-1 text-center ${i ? 'border-l border-[color:var(--chrome-divider)]' : ''} ${
              off
                ? 'cursor-not-allowed opacity-45'
                : `cursor-pointer ${on ? 'bg-[var(--foreground0)] text-[var(--background0)]' : 'hover:bg-[color-mix(in_srgb,var(--foreground0)_12%,transparent)]'}`
            }`}
            onClick={() => !off && onChange(v)}
            onKeyDown={(e) => {
              if (off) return
              const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
              if (e.key === 'Enter' || e.key === ' ') onChange(v)
              else if (step) onChange(options[(i + step + options.length) % options.length][0])
              else return
              e.preventDefault()
            }}
          >
            {text}
          </span>
        )
      })}
    </span>
  )
}

/**
 * One line in a list of choices: ● when `selected`, ○ when not — same convention
 * as the preset list and the docs index. A WebTUI `small` button, left-aligned.
 */
export function Pick({ selected, disabled, title, onClick, children }) {
  return (
    <button
      type="button"
      size-="small"
      variant-={selected ? 'foreground0' : 'background1'}
      disabled={disabled}
      title={title}
      className="h-auto min-w-0 justify-start! text-left!"
      onClick={onClick}
    >
      {selected ? '● ' : '○ '}
      {children}
    </button>
  )
}

/** A titled group of rows on a grid of its own: `cols` is its Tailwind `grid-cols-*`. */
export function Section({ title, cols, first = false, children }) {
  return (
    <div className={first ? '' : 'mt-1 border-t border-[color:var(--chrome-divider)] pt-1'}>
      <div className="px-1 pb-0.5 text-[0.9em] uppercase tracking-wider opacity-50">{title}</div>
      <div className={`grid items-center gap-x-1.5 gap-y-1 ${cols}`}>{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/*  Models                                                          */
/* ---------------------------------------------------------------- */

const round3 = (v) => Math.round(v * 1000) / 1000

/** A bearing in (-180, 180], as the map reports it. */
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

/** "1.22 × 0.813 km": the output's terrain, paper × scale, in one unit. */
export function terrainPair(output, unit = 'km') {
  const [w, h] = [output.width_mm, output.height_mm].map((v) => sig3(((v / 1000) * output.scale) / M_PER[unit]))
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

/**
 * The tile zoom: a whole number from 0 to the source's deepest (14), or
 * automatic. The value is `{ z }`, `z` a number or `null` for automatic (so
 * `parse` never returns `null`, which the field reads as "drop what was
 * typed"): shown as `auto` when unset, and typing `auto` (or emptying the
 * field) goes back to automatic. Shift steps by ten.
 */
export const TILE_ZOOM_MAX = 14
const clampZoom = (z) => (z == null ? null : Math.max(0, Math.min(TILE_ZOOM_MAX, z)))
export const tileZoomModel = {
  text: (v) => (v?.z == null ? 'auto' : String(v.z)),
  parse: (s) => {
    const t = s.trim().toLowerCase()
    if (t === 'auto' || t === '') return { z: null }
    return /^\d+$/.test(t) && Number(t) <= TILE_ZOOM_MAX ? { z: Number(t) } : null
  },
  nudge: (v, n, shift) => ({ z: clampZoom((v?.z ?? TILE_ZOOM_MAX) + n * (shift ? 10 : 1)) }),
}

/** Pixels dragged per degree when scrubbing bearing (rotate label and map tag). */
export const PX_PER_DEG = 2.5

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
