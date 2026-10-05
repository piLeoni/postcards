import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import { loadDrawland } from './lib/drawland'
import { docAtom } from './lib/store'
import { outputComment, outputUnit, setOutputComment, setOutputKeys } from './lib/doc'
import { compile, literalOutputInfo } from './lib/graph'
import { inlineShare, sharedScript } from './lib/share'
import { terrainPair } from './components/controls'

/** Whether the page opened on a self-contained share, read before anything strips the fragment. */
const OPENED_INLINE = Boolean(inlineShare())

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

/** Download `svg`, a Blob, as `name`. */
function saveFile(name, svg) {
  const url = URL.createObjectURL(svg)
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
  // Which document `graph`/`output` were compiled from, so a draw asked for
  // right after an apply can wait for the right compile instead of racing it.
  const [compiledDoc, setCompiledDoc] = useState(null)
  const [status, setStatus] = useState({ phase: 'loading' })
  const [drawing, setDrawing] = useState(null)
  const [load, setLoad] = useState(null)
  // The progress card, put out of the way into the corner and back. It stays
  // until the next draw, so a finished draw's report can be read again.
  const [loadMin, setLoadMin] = useState(false)
  // The vector tiles of the download running, `{ ids, state }`, drawn on the
  // map until the drawing starts.
  const [tiles, setTiles] = useState(null)
  // The tiles the output will read, planned without a download (`tilesPlan`):
  // the grid of what the draw will ask for, shown before the draw and after
  // the output moves or its `tileZoom` changes. `{ ids, zoom, note, warn, at }`
  // or `null` when the output needs none. Kept apart from `tiles`, which is
  // the live download; `MapView` shows the plan until the download replaces
  // it, and the trace again once the download is done.
  const [planned, setPlanned] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The share sheet, a panel over the map rather than over the script column.
  const [sharing, setSharing] = useState(false)
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

  // A shared script is somewhere else than where this reader's map was left:
  // once it compiles, the map goes to its output. The self-contained form is
  // the document from the first render; a short link sets this when it lands.
  const fitSharedRef = useRef(OPENED_INLINE)
  const docRef = useRef(doc)
  docRef.current = doc
  const outputRef = useRef(output)
  outputRef.current = output

  // A short link (`#s=<id>`) carries the script in the store, not the URL, so
  // it is fetched once and applied. The self-contained `#js=`/`#py=` form was
  // already read at import, before the document existed. A dead store leaves
  // the stored document alone rather than emptying the page. Either way the
  // fragment then goes, or a reload would put the share back over later edits.
  useEffect(() => {
    if (!engine) return
    let live = true
    sharedScript().then((shared) => {
      if (!live) return
      if (location.hash) history.replaceState(null, '', location.pathname + location.search)
      if (!shared?.text || OPENED_INLINE) return
      if (shared.text === docRef.current) {
        // The same script as the one already open: nothing recompiles, so fit now.
        const o = outputRef.current
        if (o) mapApiRef.current?.fit?.(o.lng, o.lat)
        else fitSharedRef.current = true
        return
      }
      fitSharedRef.current = true
      setDoc(shared.text)
    })
    return () => {
      live = false
    }
  }, [engine, setDoc])

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
        setCompiledDoc(doc)
        setStatus((s) => (s.phase === 'loading' || s.phase === 'error' ? { phase: 'ready' } : s))
        if (fitSharedRef.current) {
          fitSharedRef.current = false
          // After the map has rendered the new output, so the fit sizes to it.
          requestAnimationFrame(() => mapApiRef.current?.fit?.(info.lng, info.lat))
        }
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

  // The tile plan runs in a worker of its own (see `plan.worker.js`), so
  // planning the grid never touches a draw in flight. Its token drops a reply
  // that a newer plan has already replaced; the worker is kept for the
  // session, one plan at a time.
  const planWorkerRef = useRef(null)
  const planTokenRef = useRef(0)
  // Where the output was when the plan was asked for, so a stale plan (an
  // output moved since) can be dropped rather than drawn over the new place.
  const planAtRef = useRef('')
  const planTiles = useCallback((graph, at) => {
    if (!graph) {
      setPlanned(null)
      return
    }
    planAtRef.current = at
    if (!planWorkerRef.current) {
      planWorkerRef.current = new Worker(new URL('./lib/plan.worker.js', import.meta.url), { type: 'module' })
      planWorkerRef.current.onmessage = ({ data }) => {
        if (data.token !== planTokenRef.current) return
        if (data.error || !data.ids?.length) {
          setPlanned(null)
          return
        }
        setPlanned({ ids: data.ids, zoom: data.zoom, note: data.note, warn: data.warn, at: planAtRef.current })
      }
    }
    planWorkerRef.current.postMessage({ type: 'plan', token: ++planTokenRef.current, graph, maxZoom: 14 })
  }, [])
  useEffect(() => () => planWorkerRef.current?.terminate(), [])

  const draw = useCallback(() => {
    if (!engine || !graph || !output) return
    const token = ++drawTokenRef.current
    const { lat, lng } = output
    const at = placeOf(output)
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./lib/draw.worker.js', import.meta.url), { type: 'module' })
      workerRef.current.onmessage = ({ data }) => onWorkerRef.current?.(data)
    }

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
    setLoadMin(false)
    setStatus({ phase: 'working', detail: 'Downloading…' })
    setTiles(null)
    let tileState = null
    let tilesQueued = false
    const tilesChanged = () => {
      if (tilesQueued) return
      tilesQueued = true
      requestAnimationFrame(() => {
        tilesQueued = false
        if (token === drawTokenRef.current && tileState) {
          setTiles({
            ids: tileState.ids,
            state: tileState.state,
            live: tileState.live !== false,
            at: tileState.at ?? at,
            zoom: tileState.zoom ?? tileState.ids[0],
          })
        }
      })
    }

    onWorkerRef.current = (msg) => {
      if (msg.token !== token) return
      if (msg.type === 'tiles') {
        if (msg.ids) {
          tileState = {
            ids: msg.ids,
            state: new Uint8Array(msg.ids.length / 3),
            live: true,
            at,
            zoom: msg.ids[0],
          }
        }
        else if (tileState) tileState.state[msg.i] = msg.state
        tilesChanged()
      } else if (msg.type === 'event') {
        board.apply(msg.e, performance.now())
        changed()
        if (msg.e.kind === 'begin' && msg.e.id === 'draw') {
          setStatus({ phase: 'working', detail: 'Drawing…' })
          // Keep the grid on the map: only stop treating it as a live download.
          if (tileState) {
            tileState.live = false
            setTiles({ ids: tileState.ids, state: tileState.state, live: false, at, zoom: tileState.zoom })
          }
        }
      } else if (msg.type === 'done') {
        setDrawing({ svg: msg.svg, groups: msg.groups, slices: msg.slices ?? [], ms: msg.ms, bytes: msg.bytes, at })
        setStatus({ phase: 'ready' })
        if (tileState) {
          setTiles({ ids: tileState.ids, state: tileState.state, live: false, at, zoom: tileState.zoom })
        }
        // The card stays, as the report of this draw; it goes on the next.
        if (token === drawTokenRef.current) setLoadMin(true)
      } else if (msg.type === 'error') {
        if (msg.fatal) {
          workerRef.current?.terminate()
          workerRef.current = null
        }
        board.failRunning(performance.now())
        changed()
        tileState = null
        setTiles(null)
        setStatus({ phase: 'error', detail: msg.message })
        setDrawing(null)
        // The failed row stays, put out of the way; the sidebar keeps the
        // error too, and the card goes on the next draw.
        if (token === drawTokenRef.current) setLoadMin(true)
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
    setLoadMin(true)
    setTiles(null)
    setStatus({ phase: 'ready' })
  }, [status.phase])

  // A drawing belongs to where the output was when it was drawn: once the output
  // moves or changes scale or size, it is stale and goes.
  const here = placeOf(output)
  const current = drawing && drawing.at === here ? drawing : null
  useEffect(() => {
    if (drawing && drawing.at !== here) setDrawing(null)
  }, [drawing, here])
  // The tile trace belongs to where it was read; a moved output drops it.
  useEffect(() => {
    setTiles((t) => (t?.at && t.at !== here ? null : t))
  }, [here])

  // Plan the grid the output will read: the same tiles `fetchTiles` will
  // download, from the graph alone, so the grid is on the map before the draw.
  // Re-planned when the output moves, resizes, turns, or changes `tileZoom`
  // (all of which give a new `here`), and when the script changes the
  // selectors (`graph`).
  useEffect(() => {
    if (!graph || !here) return
    planTiles(graph, here)
  }, [graph, here, planTiles])

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
   * The note's unit is the terrain unit from then on; `terrainUnit` is a new
   * one, typed into a terrain field. An output the script computes stays as
   * the script says.
   */
  const editOutput = useCallback(
    (patch, terrainUnit) =>
      setDoc((d) => {
        const text = setOutputKeys(d, patch)
        if (!engine || (text === d && !terrainUnit)) return text
        try {
          const c = literalOutputInfo(engine, text)
          return c ? setOutputComment(text, 'scale', `terrain ${terrainPair(c, terrainUnit ?? unitsOf(text).terrain)}`) : text
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

  // Run and rerun apply first: the sidebar applies the draft, then asks for a
  // draw. Compiling the document is asynchronous, so the draw waits until the
  // graph and output on screen were built from the very script just applied.
  const afterApplyRef = useRef(null)
  const drawAfterApply = useCallback((text) => {
    afterApplyRef.current = text
  }, [])
  useEffect(() => {
    if (!afterApplyRef.current || compiledDoc !== afterApplyRef.current || !output) return
    afterApplyRef.current = null
    draw()
  }, [compiledDoc, output, draw])

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
      onDrawAfterApply: drawAfterApply,
      onStop: stop,
      onShare: () => setSharing(true),
    }),
    [doc, check, output, status, current, draw, drawAfterApply, stop],
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
          loadMin={loadMin}
          onLoadMin={setLoadMin}
          tiles={tiles}
          planned={planned}
          onEditOutput={() => setDrawing(null)}
          onDownload={downloadSvg}
          onMoveOutput={moveOutput}
          onOutputKeys={editOutput}
          onOutputToCentre={centreOutputOnMap}
          onCentreOnOutput={centreMapOnOutput}
          onSearch={searchOutput}
          share={sharing}
          shareDoc={doc}
          onShareClose={() => setSharing(false)}
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
