import { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import { searchAtom } from '../lib/store'

/** WebTUI button looks, the same key the update panel closes with. */
const KEY = { 'size-': 'small', 'variant-': 'background1' }

/**
 * Address search over Nominatim (OpenStreetMap's geocoder): type a place, pick
 * one of the matches, and the output moves there. The lookup is debounced, one
 * in flight at a time, and stopped on close; a request without results is a
 * place that is not on the map, not an error worth shouting about.
 *
 * The panel is the same element the script's own report wears: one white sheet
 * on a dimmed map, black hairline and all, so a dialog reads as the app's, not
 * as a browser's.
 */

/** Nominatim's usage policy asks for a real referrer and no more than a call a second. */
const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const DEBOUNCE_MS = 350
/** One screenful of matches; Nominatim takes a `limit` and the list scrolls. */
const LIMIT = 10

/** Capitalize a string's first letter — `search` → `Search`, but `usa` stays `usa`. */
const upfront = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * A Nominatim row as two lines: the place itself, and where it is.
 * `display_name` is `"Springfield, Sangamon County, Illinois, United States"`,
 * the same place name again with its county, state and country in order; the
 * place name is taken out of the address so the two lines do not repeat it,
 * and the address keeps Nominatim's own order, coarse to fine.
 */
function placeParts(p) {
  const segments = (p.display_name ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const title = p.name?.trim() || segments[0] || 'Unknown place'
  const rest = segments[0] === title ? segments.slice(1) : segments
  return { title, detail: rest.join(', ') }
}


export default function SearchModal({ open, onClose, onPick }) {
  const [saved, setSaved] = useAtom(searchAtom)
  const [query, setQuery] = useState(saved.query ?? '')
  const [rows, setRows] = useState([])
  const [state, setState] = useState('idle') // idle | looking | empty | failed
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  // Reopening shows the search as it was left, and the cursor already in the
  // field with it; the lookup below runs again from that text.
  useEffect(() => {
    if (!open) return
    setQuery(saved.query ?? '')
    setRows([])
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Escape closes from anywhere; the field is the only thing here to type in.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // One query, one request: the previous one is dropped as soon as the text
  // changes again, so a slow reply cannot overwrite a fresh one.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    abortRef.current?.abort()
    if (q.length < 3) {
      setRows([])
      setState('idle')
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const t = setTimeout(async () => {
      setState('looking')
      try {
        const url = `${ENDPOINT}?format=jsonv2&addressdetails=1&limit=${LIMIT}&q=${encodeURIComponent(q)}`
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`Nominatim answered ${res.status}`)
        const data = await res.json()
        setRows(Array.isArray(data) ? data : [])
        setState(Array.isArray(data) && data.length ? 'idle' : 'empty')
      } catch (e) {
        if (e?.name === 'AbortError') return
        setRows([])
        setState('failed')
      }
    }, DEBOUNCE_MS)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [open, query])

  if (!open) return null

  const pick = (p) => {
    const { title, detail } = placeParts(p)
    const text = detail ? `${title}, ${detail}` : title
    setSaved((s) => ({ ...s, query: query.trim(), place: { lat: Number(p.lat), lng: Number(p.lon), text } }))
    onPick?.({ lat: Number(p.lat), lng: Number(p.lon), text })
    onClose?.()
  }

  const message =
    state === 'empty' ? `No place matches “${query.trim()}”.`
      : state === 'failed' ? '✗ the search service did not answer'
        : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search an address"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/25 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      {/* One sheet, the shape the script's own report takes. */}
      <div
        className="flex max-h-[80vh] w-full max-w-[min(72ch,100%)] flex-col bg-white font-mono text-[11px]"
        style={{ boxShadow: '0 0 0 1px #000, 0 16px 44px rgb(0 0 0 / 0.3)' }}
      >
        <div className="flex shrink-0 items-center gap-[1ch] border-b border-black py-[0.25lh] pr-[1ch] pl-[2ch]">
          <span className="font-bold">Search</span>
          <span className="min-w-0 truncate opacity-60">an address or a place, through OpenStreetMap</span>
          <button type="button" {...KEY} className="ml-auto" aria-label="Close" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="flex shrink-0 items-center gap-[1ch] border-b border-black pr-[2ch] pl-[2ch] leading-[2.4]">
          <span aria-hidden className="w-[1.5ch] text-center">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Eiffel Tower, Central Park, 10 Downing Street…"
            aria-label="Search an address or a place"
            className="min-w-0 flex-1 appearance-none bg-transparent py-[0.25lh] outline-none placeholder:opacity-40 [&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => {
              setQuery(e.target.value)
              setSaved((s) => ({ ...s, query: e.target.value }))
            }}
          />
          {state === 'looking' && <span className="shrink-0 opacity-60">looking…</span>}
        </label>

        {message ? (
          <p className="px-[2ch] py-[0.5lh] opacity-60">{message}</p>
        ) : rows.length ? (
          <ul role="listbox" aria-label="Search results" className="m-0 list-none overflow-y-auto p-0">
            {rows.map((p) => {
              const { title, detail } = placeParts(p)
              return (
                <li
                  key={p.place_id ?? `${p.lat},${p.lon}`}
                  role="option"
                  tabIndex={0}
                  aria-selected="false"
                  title={p.display_name}
                  className="group cursor-pointer px-[2ch] py-[0.25lh] text-black select-none hover:bg-black hover:text-white"
                  onClick={() => pick(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p) }
                  }}
                >
                  <span className="block truncate font-bold">{upfront(title)}</span>
                  {detail && <span className="block truncate text-black/60 group-hover:text-white/60">{detail}</span>}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-[2ch] py-[0.5lh] opacity-40">Type a place name or an address…</p>
        )}

        <p className="shrink-0 border-t border-black py-[0.25lh] pr-[2ch] pl-[2ch] opacity-60">
          Search data © OpenStreetMap contributors, through Nominatim.
        </p>
      </div>
    </div>
  )
}
