/**
 * A draw, off the page's thread: the download (Overpass when the card asks
 * it anything, then the vector tiles), then the engine, the same steps as
 * `drawland map`. The page sends `{ type: 'draw', token, doc,
 * lat, lng }` and gets back every progress event as `{ type: 'event', token,
 * e }`, then `{ type: 'done', … }` or `{ type: 'error', … }`. Running here,
 * the engine's events reach the page while it works, so the bars move.
 */

import { loadDrawland } from './drawland'
import { fetchOverpass } from './overpass'
import { fetchTiles } from './tiles'
import { Task } from './progress'

let current = null

self.onmessage = ({ data }) => {
  if (data.type === 'cancel') current?.abort()
  if (data.type === 'draw') run(data)
}

async function run({ token, doc, lat, lng }) {
  current?.abort()
  const ac = new AbortController()
  current = ac
  const emit = (e) => self.postMessage({ type: 'event', token, e })
  try {
    const engine = await loadDrawland()
    const download = Task.begin(emit, 'download', null, 'download')
    download.log('info', `centre ${lat.toFixed(7)}, ${lng.toFixed(7)}`)
    const job = new engine.Job(doc, lat, lng)
    try {
      // Overpass only for a card that selects from it (`osm_select`).
      let bytes = 0
      if (job.needsOsm) {
        const req = JSON.parse(engine.osmRequest(doc, lat, lng))
        const json = await fetchOverpass(engine, req, ac.signal, download, engine.overpassPolicy())
        if (ac.signal.aborted) return
        job.read(json, emit)
        bytes = json.length
      }
      await fetchTiles(engine, job, ac.signal, download)
      if (ac.signal.aborted) return
      job.readTiles(emit)
      download.ok()
      const t0 = performance.now()
      const out = job.draw({}, emit)
      if (ac.signal.aborted) return
      self.postMessage({
        type: 'done',
        token,
        svg: out.svg,
        groups: out.groups,
        slices: out.slices,
        ms: Math.round(performance.now() - t0),
        bytes,
      })
    } finally {
      job.free()
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
    const message = e instanceof Error ? e.message : String(e)
    emit({ kind: 'log', level: 'error', text: message })
    self.postMessage({ type: 'error', token, message })
  }
}
