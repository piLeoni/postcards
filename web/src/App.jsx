import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import { loadPostcards } from './lib/postcards'
import { DEFAULT_DOC } from './lib/presets'
import { setCardKeys } from './lib/doc'

export default function App() {
  const [engine, setEngine] = useState(null)
  const [engineError, setEngineError] = useState(null)
  const [doc, setDoc] = useState(DEFAULT_DOC)
  const [card, setCard] = useState(null)
  const [status, setStatus] = useState({ phase: 'loading' })
  const [drawing, setDrawing] = useState(null)
  const [load, setLoad] = useState(null)
  const [loadTitle, setLoadTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  // The sidebar is a column on a wide screen and a drawer on a narrow one.
  // Read the width, not just `matchMedia`: an emulated or resized viewport
  // does not always fire `change`, and the column would stay hidden.
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)
  useEffect(() => {
    const on = () => setIsDesktop(window.innerWidth >= 1024)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const drawTokenRef = useRef(0)
  // Handles into the map, for the two explicit centre actions. Nothing else
  // reads them: the map is otherwise free to scroll without touching the card.
  const mapApiRef = useRef(null)

  useEffect(() => {
    loadPostcards()
      .then(setEngine)
      .catch((e) => {
        setEngineError(e instanceof Error ? e.message : String(e))
        setStatus({ phase: 'error', detail: 'The WASM engine did not load.' })
      })
  }, [])

  // The document is the card: size, scale and where it sits all come from its
  // `card:` block, and moving the card rewrites that block. A document with
  // no position is placed on the map's centre rather than at (0,0).
  useEffect(() => {
    if (!engine || !doc) return
    try {
      const info = JSON.parse(JSON.stringify(engine.cardInfo(doc)))
      if (info.lat === 0 && info.lng === 0) {
        const c = mapApiRef.current?.center?.() ?? { lat: 37.8771145, lng: -122.256196 }
        setDoc((d) => setCardKeys(d, { lat: c.lat, lng: c.lng }))
        return
      }
      setCard(info)
      setStatus((s) => (s.phase === 'loading' || s.phase === 'error' ? { phase: 'ready' } : s))
    } catch (e) {
      setStatus({ phase: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }, [engine, doc])

  // The draw runs in a worker, download and engine both, and sends back the
  // same progress events the command line shows in the terminal. The page
  // applies them to the engine's `Board`, which decides what every row says,
  // and only paints its lines.
  const workerRef = useRef(null)
  const onWorkerRef = useRef(null)
  useEffect(() => () => workerRef.current?.terminate(), [])

  const draw = useCallback(() => {
    if (!engine || !doc || !card) return
    const token = ++drawTokenRef.current
    const { lat, lng } = card
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./lib/draw.worker.js', import.meta.url), { type: 'module' })
      workerRef.current.onmessage = ({ data }) => onWorkerRef.current?.(data)
    }

    setLoadTitle(`1:${Math.round(card.scale)} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
    // Mount the card at once, so the first paint is the card itself and not
    // a flash of the old drawing; it repaints at most once a frame.
    const board = new engine.Board()
    let version = 0
    let queued = false
    const changed = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        if (token === drawTokenRef.current) setLoad({ board, version: ++version })
      })
    }
    setLoad({ board, version })
    setStatus({ phase: 'working', detail: 'Downloading…' })

    onWorkerRef.current = (msg) => {
      if (msg.token !== token) return
      if (msg.type === 'event') {
        board.apply(msg.e, performance.now())
        changed()
        if (msg.e.kind === 'begin' && msg.e.id === 'draw') setStatus({ phase: 'working', detail: 'Drawing…' })
      } else if (msg.type === 'done') {
        setDrawing({ svg: msg.svg, groups: msg.groups, ms: msg.ms, bytes: msg.bytes })
        setStatus({ phase: 'ready' })
        // Let the finished tree be readable for a moment before it goes.
        setTimeout(() => {
          if (token === drawTokenRef.current) setLoad(null)
        }, 1500)
      } else if (msg.type === 'error') {
        board.failRunning(performance.now())
        changed()
        setStatus({ phase: 'error', detail: msg.message })
        setDrawing(null)
      }
    }
    workerRef.current.postMessage({ type: 'draw', token, doc, lat, lng })
  }, [engine, doc, card])

  const moveCard = useCallback(({ lat, lng }) => setDoc((d) => setCardKeys(d, { lat, lng })), [])
  const resizeCard = useCallback(({ scale }) => setDoc((d) => setCardKeys(d, { scale: `"1:${scale}"` })), [])

  /** Move the card onto the map's centre. */
  const centreCardOnMap = useCallback(() => {
    const c = mapApiRef.current?.center?.()
    if (c) moveCard(c)
  }, [moveCard])

  /** Move the map onto the card. */
  const centreMapOnCard = useCallback(() => {
    mapApiRef.current?.jumpTo?.(card?.lng, card?.lat)
  }, [card?.lat, card?.lng])

  const sidebar = useMemo(
    () => ({
      doc,
      setDoc,
      card,
      status,
      drawing,
      busy: status.phase === 'working',
      onDraw: draw,
    }),
    [doc, card, status, drawing, draw],
  )

  if (engineError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div box-="square" className="max-w-md p-[2ch]">
          <p className="font-bold">✗ the engine did not load</p>
          <p className="mt-[0.5lh] opacity-70">{engineError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col lg:flex-row">
      <main className="relative min-h-0 min-w-0 flex-1">
        <MapView
          card={card}
          drawing={drawing}
          apiRef={mapApiRef}
          load={load}
          loadTitle={loadTitle}
          onMoveCard={moveCard}
          onResizeCard={resizeCard}
          onCardToCentre={centreCardOnMap}
          onCentreOnCard={centreMapOnCard}
        />
        <button
          type="button"
          size-="small"
          variant-="background1"
          className="safe-fab absolute right-4 z-20 lg:hidden"
          onClick={() => setMenuOpen(true)}
        >
          controls
        </button>
      </main>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Close controls"
          className="absolute inset-0 z-30 h-full w-full bg-black/25 bg-none lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <Sidebar open={menuOpen || isDesktop} onClose={() => setMenuOpen(false)} {...sidebar} />
    </div>
  )
}
