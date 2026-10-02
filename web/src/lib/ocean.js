/**
 * The sea under a card that shows a coast: the vector tiles the engine asks
 * for (`job.oceanTiles`), downloaded here and handed back one by one
 * (`job.addOceanTile`), as the `ocean tiles` row under `download`. The
 * command line reads the same tiles through terramask's fetcher.
 */

/** Tiles already downloaded this session, by URL. */
const cache = new Map()

/** Downloads at once. */
const PARALLEL = 8

export async function fetchOcean(engine, job, signal, download) {
  const tilejson = await (await fetch(engine.oceanSource(), { signal })).json()
  const template = tilejson.tiles?.[0]
  if (!template) throw new Error('ocean tiles: no tile URL in the TileJSON')
  const ids = job.oceanTiles(tilejson.maxzoom ?? 14)
  const n = ids.length / 3
  const row = download.child('ocean', 'ocean tiles', n, 'tiles')
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < n) {
      const i = next++
      const [z, x, y] = ids.slice(3 * i, 3 * i + 3)
      const bytes = await tile(template.replace('{z}', z).replace('{x}', x).replace('{y}', y), signal)
      // A tile the source leaves out has no sea in it.
      if (bytes) job.addOceanTile(z, x, y, bytes)
      row.step(++done)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, n) }, worker))
  } catch (e) {
    row.fail(e?.name === 'AbortError' ? '' : 'download failed')
    throw e
  }
  row.ok()
}

async function tile(url, signal) {
  if (cache.has(url)) return cache.get(url)
  const r = await fetch(url, { signal })
  if (r.status === 404 || r.status === 204) return null
  if (!r.ok) throw new Error(`ocean tiles: ${r.status} from ${new URL(url).host}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  cache.set(url, bytes)
  return bytes
}
