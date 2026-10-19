import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import ThemePicker from './components/ThemePicker'
import Docs from './docs/Docs'
import { loadDrawland } from './lib/drawland'
import { loadGoogleFontsForGraph } from './lib/googleFonts'
import { loadStrokeFontsForGraph } from './lib/strokeFonts'
import { applyTheme, defaultInkColor, normalizeThemeId } from './lib/themes'
import { docAtom, themeAtom } from './lib/store'
import { outputComment, outputUnit, setOutputComment, setOutputKeys } from './lib/doc'
import { compile, literalOutputInfo } from './lib/graph'
import { inlineShare, readFragment, sharedScript } from './lib/share'
import { terrainPair } from './components/controls'

/** Whether the page opened on a self-contained share, read before anything strips the fragment. */
const OPENED_INLINE = Boolean(inlineShare())
/** Whether the URL carried a share (`#js=`, `#py=`, or `#s=`) when the app loaded. */
const OPENED_SHARE = Boolean(readFragment(typeof location !== 'undefined' ? location.hash : ''))

/** The project on GitHub: the header and the sidebar both point here. */
export const REPO = 'https://github.com/piLeoni/postcards'

/** Whether the URL is the docs page, `/docs` (or `#docs` for a plain file server). */
const isDocs = () => /^\/docs\/?$/.test(location.pathname) || location.hash === '#docs'

/** A link that puts `path` in the URL without the page being asked to fetch it.
 *
 * The docs page is not a file the site is served with (a static host would 404
 * on a reload), and a link the router is not asked about keeps the map and the
 * editor alive behind it.
 */
function go(e, path) {
  e.preventDefault()
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Where the output is, how big, how it is cut and drawn: a drawing is only good for one of these. */
const placeOf = (c) =>
  c
    ? [c.lat, c.lng, c.width_mm, c.height_mm, c.scale, c.bearing, c.padding_x_mm, c.padding_y_mm, c.columns, c.rows, c.gutter_x_mm, c.gutter_y_mm, c.projection].join()
    : ''

/** `placeOf` without the bearing: the same ground, so the same tiles under it, turned or not. */
const groundOf = (at) => at.split(',').filter((_, i) => i !== 5).join()

/** How long the output must hold still before the tiles under it are planned again. */
const PLAN_SETTLE_MS = 250

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

export default function App() {
  const [themeId, setThemeId] = useAtom(themeAtom)
  const [engine, setEngine] = useState(null)
  const [engineError, setEngineError] = useState(null)
  const [doc, setDoc] = useAtom(docAtom)
  // Which page is on screen: the map and its editor, or the documentation.
  const [docs, setDocs] = useState(isDocs)
  // The graph the document builds, as the engine's JSON, and whether its
  // output is the script's own (then the page shows it but cannot move it).
  const [graph, setGraph] = useState(null)
  const [output, setOutput] = useState(null)
  // Which document `graph`/`output` were compiled from, so a draw asked for
  // right after an apply can wait for the right compile instead of racing it.
  const [compiledDoc, setCompiledDoc] = useState(null)
  const compiledDocRef = useRef(compiledDoc)
  compiledDocRef.current = compiledDoc
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // The share sheet, a panel over the map rather than over the script column.
  const [sharing, setSharing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const drawTokenRef = useRef(0)
  const drawAbortRef = useRef(null)
  // Handles into the map, for the two explicit centre actions. Nothing else
  // reads them: the map is otherwise free to scroll without touching the output.
  const mapApiRef = useRef(null)

  // The docs link is a real one (`/docs`), opened in place: the map, the editor
  // and the drawing are kept alive behind the page, so going back is instant.
  useEffect(() => {
    const onNav = () => setDocs(isDocs())
    window.addEventListener('popstate', onNav)
    return () => window.removeEventListener('popstate', onNav)
  }, [])

  const themeIdRef = useRef(themeId)
  themeIdRef.current = themeId
  useEffect(() => {
    const n = normalizeThemeId(themeId)
    if (n !== themeId) setThemeId(n)
  }, [themeId, setThemeId])
  useEffect(() => {
    applyTheme(themeId)
    const tok = drawing?.token
    if (workerRef.current && tok && tok === drawTokenRef.current) {
      workerRef.current.postMessage({
        type: 'recolor',
        token: tok,
        defaultInk: defaultInkColor(themeId),
      })
    }
  }, [themeId, drawing?.token])

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
  // A share link should render the drawing without asking for Run.
  const autoDrawSharedRef = useRef(OPENED_SHARE)
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
        if (o) mapApiRef.current?.fit?.(o.lng, o.lat, o.bearing)
        else fitSharedRef.current = true
        autoDrawSharedRef.current = true
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
        requestAnimationFrame(() => mapApiRef.current?.syncBearing?.())
        if (fitSharedRef.current) {
          fitSharedRef.current = false
          // After the map has rendered the new output, so the fit sizes to it.
          requestAnimationFrame(() => mapApiRef.current?.fit?.(info.lng, info.lat, info.bearing))
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
  const onViewportRef = useRef(null)
  const viewportSeqRef = useRef(0)
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
      if (msg.type === 'viewport') {
        onViewportRef.current?.(msg)
        return
      }
      if (msg.type === 'recolor') {
        if (msg.token !== drawTokenRef.current) {
          msg.preview?.close?.()
          return
        }
        setDrawing((d) => (d && d.token === msg.token ? { ...d, preview: msg.preview } : d))
        return
      }
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
        board.apply(msg.e, msg.e.at ?? performance.now())
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
        setDrawing({
          svg: msg.svg,
          preview: msg.preview ?? null,
          token,
          groups: msg.groups,
          slices: msg.slices ?? [],
          ms: msg.ms,
          bytes: msg.bytes,
          at,
        })
        setStatus({ phase: 'ready' })
        if (tileState) {
          setTiles({ ids: tileState.ids, state: tileState.state, live: false, at, zoom: tileState.zoom })
        }
        requestAnimationFrame(() => mapApiRef.current?.syncBearing?.())
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
    drawAbortRef.current?.abort()
    const ac = new AbortController()
    drawAbortRef.current = ac
    Promise.all([
      loadGoogleFontsForGraph(engine, graph, ac.signal),
      loadStrokeFontsForGraph(engine, graph, ac.signal),
    ])
      .then(([googleFonts, strokeFonts]) => {
        if (token !== drawTokenRef.current || ac.signal.aborted) return
        workerRef.current.postMessage({
          type: 'draw',
          token,
          graph,
          lat,
          lng,
          googleFonts,
          strokeFonts,
          defaultInk: defaultInkColor(themeIdRef.current),
        })
      })
      .catch((e) => {
        if (token !== drawTokenRef.current || e?.name === 'AbortError') return
        onWorkerRef.current?.({ type: 'error', token, message: e?.message ?? String(e), fatal: false })
      })
  }, [engine, graph, output])

  /**
   * Stop the draw that is running: its token no longer matches, so its events
   * fall through `onWorkerRef`, the half-drawn card goes, and the status reads
   * ready again. The worker itself keeps its own copy of the script, so the
   * next play starts a fresh job rather than resuming this one.
   */
  const stop = useCallback(() => {
    if (status.phase !== 'working') return
    drawAbortRef.current?.abort()
    drawTokenRef.current++
    setLoadMin(true)
    setTiles(null)
    setStatus({ phase: 'ready' })
  }, [status.phase])

  // While the script and the compiled graph disagree, tile overlays stay hidden:
  // a preset or an apply moves the map at once, but `output`/`here` trail until
  // compile finishes, and the old grid would sit on the wrong ground.
  // A turn alone (`turnedDocRef`) keeps the output on the same ground.
  const turnedDocRef = useRef(null)
  const compileStale = Boolean(doc && compiledDoc && doc !== compiledDoc && doc !== turnedDocRef.current)

  // A drawing belongs to where the output was when it was drawn: once the output
  // moves or changes scale or size, it is stale and goes.
  const here = placeOf(output)
  const current = drawing && drawing.at === here ? drawing : null
  useEffect(() => {
    if (drawing && drawing.at !== here) setDrawing(null)
  }, [drawing, here])
  const prevPreviewRef = useRef(null)
  useEffect(() => {
    const prev = prevPreviewRef.current
    const next = drawing?.preview ?? null
    if (prev && prev !== next) prev.close?.()
    prevPreviewRef.current = next
  }, [drawing])
  useEffect(() => () => prevPreviewRef.current?.close?.(), [])
  // The tile trace belongs to where it was read; a moved output drops it.
  useEffect(() => {
    setTiles((t) => (t?.at && t.at !== here ? null : t))
  }, [here])

  // Plan the grid the output will read: the same tiles `fetchTiles` will
  // download, from the graph alone, so the grid is on the map before the draw.
  // Re-planned when the output moves, resizes, turns, or changes `tileZoom`
  // (all of which give a new `here`), and when the script changes the
  // selectors (`graph`).
  // A drag (move, rotate, scale) changes `here` every frame: plan once it stops.
  useEffect(() => {
    if (!graph || !here) return
    const t = setTimeout(() => planTiles(graph, here), PLAN_SETTLE_MS)
    return () => clearTimeout(t)
  }, [graph, here, planTiles])

  /**
   * Write keys of the output, then note beside the scale the terrain that
   * paper × scale comes to: `scale: "1:8000",   // terrain 1.22 × 0.813 km`.
   * The note's unit is the terrain unit from then on; `terrainUnit` is a new
   * one, typed into a terrain field. An output the script computes stays as
   * the script says.
   */
  const editOutput = useCallback(
    (patch, terrainUnit) => {
      if (patch.bearing !== undefined) mapApiRef.current?.setBearing?.(patch.bearing)
      const turnOnly = Object.keys(patch).every((k) => k === 'bearing')
      setDoc((d) => {
        let text = setOutputKeys(d, patch)
        if (engine && (text !== d || terrainUnit)) {
          try {
            const c = literalOutputInfo(engine, text)
            if (c) text = setOutputComment(text, 'scale', `terrain ${terrainPair(c, terrainUnit ?? unitsOf(text).terrain)}`)
          } catch {
            // The text as `setOutputKeys` left it.
          }
        }
        if (turnOnly && (d === compiledDocRef.current || d === turnedDocRef.current)) turnedDocRef.current = text
        return text
      })
    },
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
    if (output) mapApiRef.current?.fit?.(output.lng, output.lat, output.bearing)
  }, [output?.lat, output?.lng, output?.bearing])

  /** A place the search found: put the output there, and the map on it, sized to the selection. */
  const searchOutput = useCallback(
    ({ lat, lng }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      moveOutput({ lat, lng })
      mapApiRef.current?.fit?.(lng, lat, outputRef.current?.bearing)
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

  useEffect(() => {
    if (!autoDrawSharedRef.current || !output || compiledDoc !== doc) return
    autoDrawSharedRef.current = false
    draw()
  }, [compiledDoc, output, draw, doc])

  const placeMap = useCallback(({ lat, lng, bearing }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    mapApiRef.current?.fit?.(lng, lat, bearing)
  }, [])

  const requestViewport = useCallback((token, rect, cb) => {
    if (!workerRef.current || !token) return 0
    const seq = ++viewportSeqRef.current
    onViewportRef.current = cb
    workerRef.current.postMessage({
      type: 'viewport',
      token,
      seq,
      rect,
      defaultInk: defaultInkColor(themeIdRef.current),
    })
    return seq
  }, [])

  const tilesOnMap = compileStale ? null : tiles?.at === here ? tiles : null
  // While the output turns the old plan stays: the map turns under it, and the
  // tiles are on the same ground until the new plan says otherwise.
  const plannedOnMap = compileStale ? null : planned?.at && here && groundOf(planned.at) === groundOf(here) ? planned : null

  const startSidebarMoveDrag = useCallback((e) => {
    mapApiRef.current?.startDrag?.(e, e.currentTarget)
  }, [])

  const sidebar = useMemo(
    () => ({
      doc,
      setDoc,
      check,
      output,
      units,
      status,
      drawing: current,
      busy: status.phase === 'working',
      onDraw: draw,
      onDrawAfterApply: drawAfterApply,
      onStop: stop,
      onShare: () => setSharing(true),
      onPlaceMap: placeMap,
      onOutputKeys: editOutput,
      onOutputToCentre: centreOutputOnMap,
      onCentreOnOutput: centreMapOnOutput,
      onOpenSearch: () => setSearchOpen(true),
      onMoveDrag: startSidebarMoveDrag,
    }),
    [doc, check, output, units, status, current, draw, drawAfterApply, stop, placeMap, editOutput, centreOutputOnMap, centreMapOnOutput, startSidebarMoveDrag],
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
    <div className="flex h-full min-h-0 w-full flex-col">
      <SiteHeader docs={docs} themeId={themeId} onTheme={setThemeId} />
      <div className="relative flex min-h-0 w-full flex-1 flex-col sm:flex-row">
        <main className="relative min-h-0 min-w-0 flex-1">
        <MapView
          doc={doc}
          appliedDoc={compiledDoc ?? doc}
          setDoc={setDoc}
          output={output}
          units={units}
          drawing={current}
          busy={status.phase === 'working'}
          appReady={status.phase !== 'loading'}
          onRequestViewport={requestViewport}
          apiRef={mapApiRef}
          load={load}
          loadMin={loadMin}
          onLoadMin={setLoadMin}
          tiles={tilesOnMap}
          planned={plannedOnMap}
          onEditOutput={() => setDrawing(null)}
          onDownload={() => setDownloading(true)}
          onMoveOutput={moveOutput}
          onOutputKeys={editOutput}
          onOutputToCentre={centreOutputOnMap}
          onCentreOnOutput={centreMapOnOutput}
          onPlaceMap={placeMap}
          onDraw={draw}
          onStop={stop}
          search={searchOpen}
          onOpenSearch={() => setSearchOpen(true)}
          onCloseSearch={() => setSearchOpen(false)}
          onSearch={searchOutput}
          share={sharing}
          shareDoc={doc}
          onShareClose={() => setSharing(false)}
          download={downloading}
          downloadDoc={doc}
          onDownloadClose={() => setDownloading(false)}
          sidebarOpen={sidebarOpen}
          onOpenControls={() => setSidebarOpen(true)}
        />
      </main>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close controls"
          className="absolute inset-0 z-30 h-full w-full bg-[var(--overlay-scrim)] bg-none sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} {...sidebar} />
      </div>

      {/* The documentation, over the page. Kept mounted behind, not unmounted:
          the map, the editor and the drawing are as they were on the way back. */}
      {docs ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background0)]">
          <SiteHeader docs={docs} over themeId={themeId} onTheme={setThemeId} />
          <Docs />
        </div>
      ) : null}
    </div>
  )
}

/** The links that belong to the site rather than to the drawing. */
function SiteHeader({ docs, over = false, themeId, onTheme }) {
  return (
    <header
      className={`z-40 flex shrink-0 items-center gap-[1ch] border-b border-[color:var(--chrome-divider)] px-[1ch] py-[0.25lh] ${over ? '' : 'bg-[var(--background0)]'}`}
    >
      <a
        is-="button"
        size-="small"
        variant-="background0"
        href="/"
        onClick={(e) => go(e, '/')}
        aria-current={docs ? undefined : 'page'}
      >
        map
      </a>
      <a
        is-="button"
        size-="small"
        variant-="background0"
        href="/docs"
        onClick={(e) => go(e, '/docs')}
        aria-current={docs ? 'page' : undefined}
      >
        docs
      </a>
      <span className="ml-auto flex items-center gap-[1ch]">
        {onTheme ? <ThemePicker value={themeId} onChange={onTheme} /> : null}
        <a
          is-="button"
          size-="small"
          variant-="background1"
          href={REPO}
          target="_blank"
          rel="noreferrer"
          title={REPO}
        >
          GitHub ↗
        </a>
      </span>
    </header>
  )
}
