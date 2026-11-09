/**
 * The terrain tiles an output needs (`job.terrainTiles`: the elevation under
 * the output, from AWS Open Data's Terrarium), downloaded here and handed back
 * one by one (`job.addTerrain`), as the `terrain` row under `download`. Only
 * read when a script draws terrain (`job.needsTerrain`); the command line reads
 * the same tiles through terramask's fetcher.
 *
 * Terrarium tiles are plain PNGs on S3, immutable per build, so the browser's
 * HTTP cache keeps them across sessions; the map here only saves re-reading it
 * within one.
 */

/** Tiles already downloaded this session, by URL, oldest first. */
const cache = new Map()
const CACHE_TILES = 256

/** Downloads at once. */
const PARALLEL = 8

/** The Terrarium template, as terramask names it. */
export const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

export async function fetchTerrain(job, signal, download) {
  if (!job.needsTerrain) return
  const ids = job.terrainTiles()
  const n = ids.length / 3
  const row = download.child('terrain', 'terrain', n, 'tiles')
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < n) {
      const i = next++
      const [z, x, y] = ids.slice(3 * i, 3 * i + 3)
      const bytes = await tile(TERRARIUM.replace('{z}', z).replace('{x}', x).replace('{y}', y), signal)
      if (bytes) job.addTerrain(z, x, y, bytes)
      row.step(++done)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, n) }, worker))
    // Deep tiles flatten the sea to 0 m: its floor comes from the zoom-10
    // tiles around it, as on the command line, so depth bands still show.
    const sea = job.terrainSeaTiles?.() ?? []
    for (let i = 0; i < sea.length; i += 3) {
      const [z, x, y] = sea.slice(i, i + 3)
      const bytes = await tile(TERRARIUM.replace('{z}', z).replace('{x}', x).replace('{y}', y), signal)
      if (bytes) job.addTerrainSea(z, x, y, bytes)
    }
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
  if (!r.ok) throw new Error(`terrain: ${r.status} from ${new URL(url).host}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  cache.set(url, bytes)
  if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value)
  return bytes
}
