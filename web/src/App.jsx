import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import { loadDrawland } from './lib/drawland'
import { docAtom } from './lib/store'
import { outputComment, outputUnit, setOutputComment, setOutputKeys } from './lib/doc'
import { compile, literalOutputInfo } from './lib/graph'
import { terrainPair } from './components/controls'

/** Where the output is, how big, how it is cut and drawn: a drawing is only good for one of these. */
const placeOf = (c) =>
  c
    ? [c.lat, c.lng, c.width_mm, c.height_mm, c.scale, c.bearing, c.padding_x_mm, c.padding_y_mm, c.columns, c.rows, c.gutter_x_mm, c.gutter_y_mm, c.projection].join()
    : ''

/**
 * The unit each length of the output is written in. One not written takes the
 * paper's; the terrain keeps the unit noted beside the scale, or takes km
 * beside metric paper and mi beside inches.
 */
function unitsOf(doc) {
  const width = outputUnit(doc, 'width') ?? 'mm'
  const paper = ['mm', 'cm', 'in'].includes(width) ? width : 'mm'
  return {
    width: paper,
    height: outputUnit(doc, 'height') ?? paper,
    padding: outputUnit(doc, 'padding') ?? paper,
    gutter: outputUnit(doc, 'slices.gutter') ?? paper,
    terrain: outputComment(doc, 'scale')?.match(/^terrain [\d.]+ × [\d.]+ (m|km|mi|ft)\b/)?.[1] ?? (paper === 'in' ? 'mi' : 'km'),
  }
}

function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [engine, setEngine] = useState(null)
  const [engineError, setEngineError] = useState(null)
  const [doc, setDoc] = useAtom(docAtom)
  // The graph the document builds, as the engine's JSON, and whether its
  // output is the script's own (then the page shows it but cannot move it).
  const [graph, setGraph] = useState(null)
  const [output, setOutput] = useState(null)
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
  // reads them: the map is otherwise free to scroll without touching the output.
  const mapApiRef = useRef(null)

  useEffect(() => {
    loadDrawland()
      .then(setEngine)
      .catch((e) => {
        setEngineError(e instanceof Error ? e.message : String(e))
        setStatus({ phase: 'error', detail: 'The WASM engine did not load.' })
      })
  }, [])

  // The document is the output: size, scale and where it sits all come from its
  // `output({…})`, and moving the output rewrites that call. A document with
  // no position is placed on the map's centre rather than at (0,0).
  useEffect(() => {
    if (!engine || !doc) return
    let live = true
    compile(doc)
      .then((c) => {
        if (!live) return
        const info = JSON.parse(JSON.stringify(engine.outputInfo(c.json)))
        if (info.lat === 0 && info.lng === 0 && !c.computed) {
          const at = mapApiRef.current?.center?.() ?? { lat: 37.8771145, lng: -122.256196 }
          setDoc((d) => setOutputKeys(d, { lat: at.lat, lng: at.lng }))
          return
        }
        setGraph(c.json)
        setOutput({ ...info, computed: c.computed })
        setStatus((s) => (s.phase === 'loading' || s.phase === 'error' ? { phase: 'ready' } : s))
      })
      .catch((e) => {
        if (live) setStatus({ phase: 'error', detail: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      live = false
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
    if (!engine || !graph || !output) return
    const token = ++drawTokenRef.current
    const { lat, lng } = output
    const at = placeOf(output)
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./lib/draw.worker.js', import.meta.url), { type: 'module' })
      workerRef.current.onmessage = ({ data }) => onWorkerRef.current?.(data)
    }

    setLoadTitle(`1:${Math.round(output.scale)} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
    // Mount the output at once, so the first paint is the output itself and not
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
        setDrawing({ svg: msg.svg, groups: msg.groups, slices: msg.slices ?? [], ms: msg.ms, bytes: msg.bytes, at })
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
        // The failed row reads for a moment, then the map is back; the
        // sidebar keeps the error.
        setTimeout(() => {
          if (token === drawTokenRef.current) setLoad(null)
        }, 2500)
      }
    }
    workerRef.current.postMessage({ type: 'draw', token, graph, lat, lng })
  }, [engine, graph, output])

  /**
   * Stop the draw that is running: its token no longer matches, so its events
   * fall through `onWorkerRef`, the half-drawn card goes, and the status reads
   * ready again. The worker itself keeps its own copy of the script, so the
   * next play starts a fresh job rather than resuming this one.
   */
  const stop = useCallback(() => {
    if (status.phase !== 'working') return
    drawTokenRef.current++
    setLoad(null)
    setStatus({ phase: 'ready' })
  }, [status.phase])

  // A drawing belongs to where the output was when it was drawn: once the output
  // moves or changes scale or size, it is stale and goes.
  const here = placeOf(output)
  const current = drawing && drawing.at === here ? drawing : null
  useEffect(() => {
    if (drawing && drawing.at !== here) setDrawing(null)
  }, [drawing, here])

  // A cut output downloads one file per sheet, a moment apart: browsers drop
  // downloads fired in the same instant.
  const downloadSvg = useCallback(async () => {
    if (!current || !output) return
    const base = `drawland_${output.lat.toFixed(4)}_${output.lng.toFixed(4)}_1-${Math.round(output.scale)}`
    const files = current.slices?.length ? current.slices.map(([name, svg]) => [`${base}_${name}.svg`, svg]) : [[`${base}.svg`, current.svg]]
    for (const [i, [name, svg]] of files.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 300))
      saveFile(name, svg)
    }
  }, [current, output])

  /**
   * Write keys of the output, then note beside the scale the terrain that
   * paper × scale comes to: `scale: "1:8000",   // terrain 1.22 × 0.813 km`.
   * An output the script computes stays as the script says.
   */
  const editOutput = useCallback(
    (patch) =>
      setDoc((d) => {
        const text = setOutputKeys(d, patch)
        if (!engine || text === d) return text
        try {
          const c = literalOutputInfo(engine, text)
          return c ? setOutputComment(text, 'scale', `terrain ${terrainPair(c, unitsOf(text).terrain)}`) : text
        } catch {
          return text
        }
      }),
    [engine],
  )
  const moveOutput = useCallback(({ lat, lng }) => editOutput({ lat, lng }), [editOutput])

  const units = useMemo(() => unitsOf(doc), [doc])

  /** Move the output onto the map's centre. */
  const centreOutputOnMap = useCallback(() => {
    const c = mapApiRef.current?.center?.()
    if (c) moveOutput(c)
  }, [moveOutput])

  /** Move the map onto the output, sized to it: the whole selection in view. */
  const centreMapOnOutput = useCallback(() => {
    if (output) mapApiRef.current?.fit?.(output.lng, output.lat)
  }, [output?.lat, output?.lng])

  /** A place the search found: put the output there, and the map on it, sized to the selection. */
  const searchOutput = useCallback(
    ({ lat, lng }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      moveOutput({ lat, lng })
      mapApiRef.current?.fit?.(lng, lat)
    },
    [moveOutput],
  )

  /** What is wrong with `text` as a profile, in the engine's words; `null` when nothing. */
  const check = useCallback(
    async (text) => {
      if (!engine) return null
      try {
        engine.outputInfo((await compile(text)).json)
        return null
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
    [engine],
  )

  const sidebar = useMemo(
    () => ({
      doc,
      setDoc,
      check,
      output,
      status,
      drawing: current,
      busy: status.phase === 'working',
      onDraw: draw,
      onStop: stop,
    }),
    [doc, check, output, status, current, draw, stop],
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
          output={output}
          units={units}
          drawing={current}
          apiRef={mapApiRef}
          load={load}
          loadTitle={loadTitle}
          onEditOutput={() => setDrawing(null)}
          onDownload={downloadSvg}
          onMoveOutput={moveOutput}
          onOutputKeys={editOutput}
          onOutputToCentre={centreOutputOnMap}
          onCentreOnOutput={centreMapOnOutput}
          onSearch={searchOutput}
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
