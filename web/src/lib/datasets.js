/**
 * GeoJSON datasets for `features.geojson(source)`: what the job lists in
 * `job.datasets`, handed over with `job.addDataset`.
 *
 * - A URL is fetched (it must allow CORS) and kept in Cache Storage for
 *   `DATA_MAX_AGE_MS`, the CLI's 15 minutes, so a live feed stays current.
 * - Any other source is a file the page was given: dropped on the map, read
 *   into `importedDatasets` by name, and posted to the worker with the draw.
 */

export const DATA_MAX_AGE_MS = 15 * 60 * 1000
const CACHE = 'drawland-datasets-v1'
const FETCHED = 'x-drawland-fetched'

/** Files dropped on the page this session, by file name → GeoJSON text. */
export const importedDatasets = new Map()

const isUrl = (s) => /^https?:\/\//i.test(s)

/** Every dataset the job reads, fetched or taken from `files`, as a row under `task`. */
export async function fetchDatasets(job, signal, task, files = {}) {
  const sources = [...job.datasets]
  if (!sources.length) return 0
  const row = task.child('datasets', 'datasets', sources.length, 'datasets')
  let bytes = 0
  for (const [i, src] of sources.entries()) {
    let text = files[src]
    if (text == null) {
      if (!isUrl(src)) {
        const e = new Error(`dataset "${src}" is not loaded: drop the file on the map, or use a URL`)
        row.fail?.(e.message)
        throw e
      }
      text = await fetchUrl(src, signal)
    }
    job.addDataset(src, text)
    bytes += text.length
    row.step(i + 1, short(src))
  }
  row.ok(`${sources.length} dataset${sources.length === 1 ? '' : 's'} · ${(bytes / 1e6).toFixed(1)} MB`)
  return bytes
}

async function fetchUrl(url, signal) {
  const cache = await openCache()
  try {
    const hit = await cache?.match(url)
    if (hit && Date.now() - Number(hit.headers.get(FETCHED) ?? 0) < DATA_MAX_AGE_MS) return await hit.text()
  } catch {
    // A broken cache entry: download again.
  }
  let res
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error(`${url}: could not be fetched (offline, or the server does not allow other sites to read it)`)
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  try {
    await cache?.put(url, new Response(text, { headers: { 'content-type': 'application/geo+json', [FETCHED]: String(Date.now()) } }))
  } catch {
    // Quota or private mode: the draw does not need the cache.
  }
  return text
}

async function openCache() {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE)
  } catch {
    return null
  }
}

function short(src) {
  return src.replace(/\/+$/, '').split('/').pop() || src
}

/** `[west, south, east, north]` of every position in a GeoJSON object, or null. */
export function geojsonBounds(gj) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (c) => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      b[0] = Math.min(b[0], c[0])
      b[1] = Math.min(b[1], c[1])
      b[2] = Math.max(b[2], c[0])
      b[3] = Math.max(b[3], c[1])
      return
    }
    c.forEach(walk)
  }
  const visit = (o) => {
    if (!o || typeof o !== 'object') return
    if (o.type === 'FeatureCollection') (o.features ?? []).forEach(visit)
    else if (o.type === 'Feature') visit(o.geometry)
    else if (o.type === 'GeometryCollection') (o.geometries ?? []).forEach(visit)
    else walk(o.coordinates)
  }
  visit(gj)
  return Number.isFinite(b[0]) ? b : null
}

/**
 * The output that shows `bounds` on a page `widthMm` × `heightMm` (inside its
 * padding), in web mercator: centre, a rounded scale, and a tile zoom that
 * reads a handful of tiles across.
 */
export function frameBounds([w, s, e, n], widthMm, heightMm) {
  const lat = (s + n) / 2
  const lng = (w + e) / 2
  const k = Math.cos((lat * Math.PI) / 180)
  const M_PER_DEG = 111_320
  // Web mercator stretches north–south by 1/cos(lat) as east–west; at the
  // centre both read the same ground metres per page millimetre.
  const groundW = Math.max((e - w) * M_PER_DEG * k, 200)
  const groundH = Math.max((n - s) * M_PER_DEG, 200)
  const raw = Math.max(groundW / (widthMm / 1000), groundH / (heightMm / 1000)) * 1.12
  const mag = 10 ** Math.floor(Math.log10(raw))
  const scale = Math.ceil(raw / (mag / 2)) * (mag / 2)
  const tileZoom = Math.max(0, Math.min(14, Math.floor(Math.log2((40_075_016 * k) / (groundW / 4)))))
  return { lat: +lat.toFixed(5), lng: +lng.toFixed(5), scale: `1:${scale}`, tileZoom }
}
