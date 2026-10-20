import { useEffect, useLayoutEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { searchAtom } from '../lib/store'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const DEBOUNCE_MS = 350
const LIMIT = 10

const upfront = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export function placeParts(p) {
  const segments = (p.display_name ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const title = p.name?.trim() || segments[0] || 'Unknown place'
  const rest = segments[0] === title ? segments.slice(1) : segments
  return { title, detail: rest.join(', ') }
}

/** Nominatim lookup while `active`; session text and rows live in `searchAtom`. */
export function usePlaceSearch(active, onPick) {
  const [saved, setSaved] = useAtom(searchAtom)
  const { query, rows, state } = saved
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const searchedRef = useRef(null)

  useEffect(() => {
    if (!active) return
    const q = saved.query.trim()
    if (q === searchedRef.current) return
    searchedRef.current = q
    abortRef.current?.abort()
    if (q.length < 3) {
      setSaved((s) => ({ ...s, rows: [], state: 'idle' }))
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const t = setTimeout(async () => {
      setSaved((s) => ({ ...s, state: 'looking' }))
      try {
        const url = `${ENDPOINT}?format=jsonv2&addressdetails=1&limit=${LIMIT}&q=${encodeURIComponent(q)}`
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`Nominatim answered ${res.status}`)
        const data = await res.json()
        const list = Array.isArray(data) ? data : []
        setSaved((s) => (s.query.trim() === q ? { ...s, rows: list, state: list.length ? 'idle' : 'empty' } : s))
      } catch (e) {
        if (e?.name === 'AbortError') return
        setSaved((s) => (s.query.trim() === q ? { ...s, rows: [], state: 'failed' } : s))
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [active, saved.query, setSaved])

  const setQuery = (query) => setSaved((s) => ({ ...s, query }))

  const pick = (p) => {
    const { title, detail } = placeParts(p)
    const text = detail ? `${title}, ${detail}` : title
    setSaved((s) => ({ ...s, place: { lat: Number(p.lat), lng: Number(p.lon), text } }))
    onPick?.({ lat: Number(p.lat), lng: Number(p.lon), text })
  }

  const message =
    state === 'empty'
      ? `No place matches “${query.trim()}”.`
      : state === 'failed'
        ? '✗ the search service did not answer'
        : null

  return { query, rows, state, message, inputRef, setQuery, pick }
}

const RESULT_PAD = 'px-[1ch]'

export function PlaceSearchResults({ rows, message, query, onPick }) {
  if (message) return <p className={`m-0 py-[0.35lh] opacity-60 ${RESULT_PAD}`}>{message}</p>
  if (rows.length) {
    return (
      <ul
        role="listbox"
        aria-label="Search results"
        className="m-0 list-none divide-y divide-[color:var(--chrome-divider)] p-0"
      >
        {rows.map((p) => {
          const { title, detail } = placeParts(p)
          return (
            <li
              key={p.place_id ?? `${p.lat},${p.lon}`}
              role="option"
              tabIndex={0}
              title={p.display_name}
              className={`cursor-pointer py-[0.35lh] select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)] ${RESULT_PAD}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick(p)
                }
              }}
            >
              <span className="block truncate font-bold">{upfront(title)}</span>
              {detail && <span className="block truncate opacity-60">{detail}</span>}
            </li>
          )
        })}
      </ul>
    )
  }
  if (query.trim().length >= 3) return null
  return <p className={`m-0 py-[0.35lh] opacity-40 ${RESULT_PAD}`}>Type a place name or an address…</p>
}

/**
 * Search field fixed at the top of the floating panel; everything below swaps
 * between the panel body and results in the same card.
 */
export function PlaceSearchPanel({ onPick, lockSizeRef, children }) {
  const { query, rows, state, message, inputRef, setQuery, pick } = usePlaceSearch(true, onPick)
  const showResults = rows.length > 0
  const lockedHRef = useRef(0)

  useLayoutEffect(() => {
    const card = lockSizeRef?.current
    if (!card) return
    const apply = () => {
      if (showResults) return
      const h = card.offsetHeight
      if (h <= lockedHRef.current) return
      lockedHRef.current = h
      card.style.minHeight = `${h}px`
      card.style.height = `${h}px`
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(card)
    return () => ro.disconnect()
  }, [showResults, lockSizeRef, children])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (!query.trim() && !showResults) return
      setQuery('')
      inputRef.current?.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, showResults, inputRef, setQuery])

  const choose = (p) => {
    pick(p)
    setQuery('')
    inputRef.current?.blur()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <label
        className="chrome-field mb-1.5 flex shrink-0 items-center gap-[1ch] px-1.5 py-0.5"
        title="Find a place by address and move the selection there"
      >
        <span aria-hidden className="shrink-0 opacity-60">⌕</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="search a place…"
          aria-label="Search an address or a place"
          className="min-w-0 flex-1 appearance-none bg-transparent outline-none placeholder:opacity-50 [&::-webkit-search-cancel-button]:hidden"
          onChange={(e) => setQuery(e.target.value)}
        />
        {state === 'looking' && <span className="shrink-0 opacity-60">…</span>}
      </label>
      {showResults ? (
        <div className="editor-scroll -mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          <PlaceSearchResults rows={rows} message={message} query={query} onPick={choose} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      )}
    </div>
  )
}

/** Centred dialog: header, field, results, attribution. */
export default function PlaceSearch({ active = true, onClose, onPick }) {
  const { query, rows, state, message, inputRef, setQuery, pick } = usePlaceSearch(active, (place) => {
    onPick?.(place)
    onClose?.()
  })

  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(query.length, query.length)
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])

  return (
    <div className="flex min-h-0 flex-col font-mono text-[11px]">
      <div className="chrome-border flex shrink-0 items-center gap-[1ch] border-b py-[0.25lh] pr-[1ch] pl-[2ch]">
        <span className="font-bold">Search</span>
        <span className="min-w-0 truncate opacity-60">an address or a place, through OpenStreetMap</span>
        <button
          type="button"
          size-="small"
          variant-="background1"
          className="ml-auto"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <label className="chrome-border flex shrink-0 items-center gap-[1ch] border-b py-[0.25lh] pr-[2ch] pl-[2ch] leading-[2.4]">
        <span aria-hidden className="w-[1.5ch] shrink-0 text-center">⌕</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Eiffel Tower, Central Park…"
          aria-label="Search an address or a place"
          className="min-w-0 flex-1 appearance-none bg-transparent outline-none placeholder:opacity-40 [&::-webkit-search-cancel-button]:hidden"
          onChange={(e) => setQuery(e.target.value)}
        />
        {state === 'looking' && <span className="shrink-0 opacity-60">looking…</span>}
      </label>

      <div className="editor-scroll min-h-0 flex-1 overflow-y-auto">
        <PlaceSearchResults rows={rows} message={message} query={query} onPick={pick} />
      </div>

      <p className="chrome-border shrink-0 border-t py-[0.25lh] pr-[2ch] pl-[2ch] opacity-60">
        Search data © OpenStreetMap contributors, through Nominatim.
      </p>
    </div>
  )
}
