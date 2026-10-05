/**
 * The tile grid an output will read, off the page's thread and without
 * downloading anything: `tilesPlan` builds the same plan `draw.worker.js`
 * downloads, from the graph alone, so the grid of the tiles can be drawn on
 * the map before a draw — and again whenever the output moves or its
 * `tileZoom` changes. The page sends `{ type: 'plan', token, graph, maxZoom }`
 * and gets back `{ type: 'plan', token, ids, zoom, note, warn }` (`ids` as
 * `[z, x, y, …]`, empty when the output needs no tiles).
 *
 * A worker of its own, so a plan while a draw is running never touches the
 * draw's own `Job`: `tilesPlan` borrows nothing and returns at once.
 */

import { loadDrawland } from './drawland'

self.onmessage = async ({ data }) => {
  if (data.type !== 'plan') return
  const { token, graph, maxZoom } = data
  try {
    const engine = await loadDrawland()
    const p = engine.tilesPlan(graph, maxZoom ?? 14)
    self.postMessage({
      type: 'plan',
      token,
      ids: Array.from(p.ids),
      zoom: p.zoom,
      note: p.note,
      warn: p.warn,
    })
  } catch (e) {
    self.postMessage({ type: 'plan', token, ids: [], error: e instanceof Error ? e.message : String(e) })
  }
}
