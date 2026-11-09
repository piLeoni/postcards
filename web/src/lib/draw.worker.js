/**
 * A draw, off the page's thread: the download (Overpass when the output asks
 * it anything, then the vector tiles), then the engine, the same steps as
 * `drawland map`. The page sends `{ type: 'draw', token, graph,
 * lat, lng }` (the graph its script built, as JSON) and gets back every progress event as `{ type: 'event', token,
 * e }`, the vector tiles as they download as `{ type: 'tiles', token, ids }`
 * then `{ type: 'tiles', token, i, state }` (see `fetchTiles`), then
 * `{ type: 'done', … }` or `{ type: 'error', … }`. Running here,
 * the engine's events reach the page while it works, so the bars move.
 */

import { loadDrawland } from './drawland'
import { fetchOverpass } from './overpass'
import { fetchTiles } from './tiles'
import { fetchTerrain } from './terrain'
import { fetchGoogleFonts } from './googleFonts'
import { fetchStrokeFonts } from './strokeFonts'
import { fetchDatasets } from './datasets'
import { createPreviewPainter } from './preview'
import { Task } from './progress'

let current = null
let activePainter = null
let activeToken = 0

self.onmessage = ({ data }) => {
  if (data.type === 'cancel') current?.abort()
  if (data.type === 'draw') run(data)
  if (data.type === 'recolor') {
    if (data.token !== activeToken || !activePainter) return
    const preview = activePainter.renderOverview(data.defaultInk)
    if (!preview) return
    self.postMessage({ type: 'recolor', token: data.token, preview }, [preview])
  }
  if (data.type === 'viewport') {
    if (data.token !== activeToken || !activePainter) return
    const bitmap = activePainter.renderViewport(data.rect, data.defaultInk)
    if (!bitmap) return
    self.postMessage(
      {
        type: 'viewport',
        token: data.token,
        seq: data.seq,
        rect: data.rect,
        bitmap,
      },
      [bitmap],
    )
  }
}

async function run({ token, graph, lat, lng, googleFonts, strokeFonts, datasets, defaultInk }) {
  current?.abort()
  const ac = new AbortController()
  current = ac
  const emit = (e) => self.postMessage({ type: 'event', token, e: { ...e, at: performance.now() } })
  let engine = null
  // A trap leaves the job borrowed and the module's heap unusable: freeing
  // the job then throws "attempted to take ownership of Rust value while it
  // was borrowed", hiding the real error, and every later call is suspect.
  let trapped = false
  try {
    engine = await loadDrawland()
    const download = Task.begin(emit, 'download', null, 'download')
    download.log('info', `centre ${lat.toFixed(7)}, ${lng.toFixed(7)}`)
    const job = new engine.Job(graph, lat, lng)
    try {
      // How much room there is, so a fill that cannot fit is refused with a
      // message rather than trapping in the wasm allocator. `memory.buffer`
      // is an ArrayBuffer (no `.maximum`), so check `buffer.maxByteLength` or
      // default to the wasm32 4 GB address space ceiling.
      const buf = engine.memory?.buffer
      const cap = (buf?.maxByteLength && buf.maxByteLength > buf.byteLength ? buf.maxByteLength : 0) || 4 * 1024 * 1024 * 1024
      if (cap) job.memoryBudget = cap
      // Overpass only for an output that selects from it (`osm_select`).
      let bytes = 0
      if (job.needsOsm) {
        const req = JSON.parse(engine.osmRequest(graph, lat, lng))
        const json = await fetchOverpass(engine, req, ac.signal, download, engine.overpassPolicy())
        if (ac.signal.aborted) return
        job.read(json, emit)
        bytes = json.length
      }
      await fetchTiles(engine, job, ac.signal, download, (m) => self.postMessage({ type: 'tiles', token, ...m }))
      if (ac.signal.aborted) return
      job.readTiles(emit)
      await fetchTerrain(job, ac.signal, download)
      if (ac.signal.aborted) return
      job.readTerrain(emit)
      // GeoJSON for `features.geojson`: URLs fetched, dropped files as given.
      bytes += await fetchDatasets(job, ac.signal, download, datasets ?? {})
      if (ac.signal.aborted) return
      if (googleFonts && Object.keys(googleFonts).length) {
        const row = download.child('google-fonts', 'google-fonts', Object.keys(googleFonts).length, 'google fonts')
        let n = 0
        for (const [key, bytes] of Object.entries(googleFonts)) {
          job.addGoogleFont(key, bytes)
          n += 1
          row.step(n, key)
        }
        row.ok(`${n} font${n === 1 ? '' : 's'}`)
      } else {
        await fetchGoogleFonts(engine, graph, job, ac.signal, download)
      }
      if (strokeFonts && Object.keys(strokeFonts).length) {
        const row = download.child('stroke-fonts', 'stroke-fonts', Object.keys(strokeFonts).length, 'stroke fonts')
        let n = 0
        for (const [url, bytes] of Object.entries(strokeFonts)) {
          job.addStrokeFont(url, bytes)
          n += 1
          row.step(n, url)
        }
        row.ok(`${n} font${n === 1 ? '' : 's'}`)
      } else {
        await fetchStrokeFonts(engine, graph, job, ac.signal, download)
      }
      if (ac.signal.aborted) return
      download.ok()
      const t0 = performance.now()
      // The SVG arrives in pieces as it is written, part 0 the whole output
      // and part k the kth slice; a Blob keeps it out of the wasm heap and
      // past the length a single JS string may have.
      const parts = []
      const previewPainter = createPreviewPainter(defaultInk)
      const onText = (k, text) => {
        ;(parts[k] ??= []).push(text)
        if (k === 0) previewPainter?.feed(text)
      }
      const out = job.draw({}, emit, onText)
      if (ac.signal.aborted) return
      const preview = previewPainter?.finish() ?? null
      activePainter = previewPainter
      activeToken = token
      const blob = (k) => new Blob(parts[k] ?? [], { type: 'image/svg+xml' })
      self.postMessage(
        {
          type: 'done',
          token,
          svg: blob(0),
          preview,
          groups: out.groups,
          slices: out.slices.map((name, i) => [name, blob(i + 1)]),
          ms: Math.round(performance.now() - t0),
          bytes,
        },
        preview ? [preview] : [],
      )
      out.free()
    } catch (e) {
      trapped = e instanceof WebAssembly.RuntimeError
      throw e
    } finally {
      if (!trapped) job.free()
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
    const message = trapped ? trapMessage(engine, e) : e instanceof Error ? e.message : String(e)
    emit({ kind: 'log', level: 'error', text: message })
    self.postMessage({ type: 'error', token, message, fatal: trapped })
    // The page starts a fresh worker for the next draw.
    if (trapped) self.close()
  }
}

/** What a trap in the engine was: a panic's own message, or the heap full. */
function trapMessage(engine, e) {
  let panic = null
  try {
    panic = engine?.lastPanic?.()
  } catch {
    // The instance is broken enough that even this call traps.
  }
  if (panic) return `the engine crashed: ${panic}`
  const heap = engine?.memory?.buffer?.byteLength
  const gb = heap ? ` (${(heap / 2 ** 30).toFixed(2)} GB in use)` : ''
  return `the engine ran out of memory${gb}: ${e.message}. Widen the spacing, use a sparser pattern, shrink the output, or draw it with the command line.`
}
