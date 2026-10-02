/**
 * The vector tiles a card needs (`job.tiles`: what `tiles_select` picks, and
 * the sea), downloaded here and handed back one by one (`job.addTile`), as
 * the `vector tiles` row under `download`. The command line reads the same
 * tiles through terramask's fetcher.
 *
 * OpenFreeMap's tile URLs carry the build they come from and are served with
 * a ten-year max-age, so the browser's HTTP cache keeps them across sessions;
 * the map here only saves re-reading that cache within one.
 */

/** Tiles already downloaded this session, by URL, oldest first. */
const cache = new Map()
const CACHE_TILES = 256

/** Downloads at once. */
const PARALLEL = 8

export async function fetchTiles(engine, job, signal, download) {
  const tilejson = await (await fetch(engine.tileSource(), { signal })).json()
  const template = tilejson.tiles?.[0]
  if (!template) throw new Error('vector tiles: no tile URL in the TileJSON')
  const ids = job.tiles(tilejson.maxzoom ?? 14)
  const n = ids.length / 3
  if (n === 0) return
  const row = download.child('tiles', 'vector tiles', n, 'tiles')
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < n) {
      const i = next++
      const [z, x, y] = ids.slice(3 * i, 3 * i + 3)
      const bytes = await tile(template.replace('{z}', z).replace('{x}', x).replace('{y}', y), signal)
      // A tile the source leaves out has nothing in it.
      if (bytes) job.addTile(z, x, y, bytes)
      row.step(++done)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, n) }, worker))
  } catch (e) {
    row.fail(e?.name === 'AbortError' ? '' : 'download failed')
    throw e
  }
  row.ok(`zoom ${ids[0]}`)
}

async function tile(url, signal) {
  if (cache.has(url)) return cache.get(url)
  const r = await fetch(url, { signal })
  if (r.status === 404 || r.status === 204) return null
  if (!r.ok) throw new Error(`vector tiles: ${r.status} from ${new URL(url).host}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  cache.set(url, bytes)
  if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value)
  return bytes
}
