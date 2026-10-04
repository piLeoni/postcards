/**
 * Overpass, the way the command line asks it (`drawland-cli/src/osm_http.rs`):
 * the servers and the rounds come from the core (`overpassPolicy`), every try
 * is a row under `download` counting the bytes as they arrive, a wait between
 * rounds counts down on `download` itself, and a failed try is logged with
 * what happens next.
 *
 * Replies are kept in the browser's Cache Storage, across reloads. Which one
 * serves an output, and which are deleted to stay in budget, the engine decides
 * (`osmPick`, `osmEvict`): the same rules the command line follows on disk.
 *
 * Runs in the draw worker. `VITE_OVERPASS_URL` (comma separated) replaces the
 * servers, as `DRAWLAND_OVERPASS` does for the command line.
 */

const FROM_ENV = import.meta.env.VITE_OVERPASS_URL || ''

/**
 * The Overpass JSON for `req` (`osmRequest()` from the engine): a stored
 * reply that covers the output, or a download of `req.query`. `policy` is
 * `overpassPolicy()`; `download` the task the tries are rows of.
 */
export async function fetchOverpass(engine, req, signal, download, policy) {
  const store = await openStore()
  const stored = await store.list()
  const now = Math.floor(Date.now() / 1000)
  const metas = JSON.stringify(stored.map((s) => s.meta))
  const i = engine.osmPick(metas, JSON.stringify(req.need), now)
  if (i >= 0) {
    const hit = await store.read(stored[i].key)
    if (hit) {
      download.child('osm-cache', 'OSM from cache').ok(`${mbBare(hit.length)} MB · ${ageWords(now - stored[i].meta.fetched)}`)
      return hit
    }
  }
  const text = await download_(engine, req.query, signal, download, policy)
  const meta = { ...req.fetch, fetched: now, bytes: text.length }
  const key = await store.write(meta, text)
  const all = [...stored.filter((s) => !sameGround(s.meta, meta)), { key, meta }]
  for (const j of engine.osmEvict(JSON.stringify(all.map((s) => s.meta)), now)) await store.remove(all[j].key)
  return text
}

/** Tries every server in rounds until one answers. */
async function download_(engine, query, signal, download, policy) {
  const once = async (url, row) => {
    const text = await attempt(url, query, signal, row, download, policy.timeoutS)
    // Out of time or memory, Overpass still answers 200, cut short.
    const cut = engine.overpassError(text)
    if (cut) throw new Error(`cut short: ${cut}`)
    return text
  }
  // Out of slots: the server says when one frees up; sit it out once if
  // that is soon, rather than spend the next server.
  const tryServer = async (url, row) => {
    try {
      return await once(url, row)
    } catch (e) {
      if (signal.aborted || !/^429/.test(e?.message ?? '')) throw e
      const wait = await slotWait(engine, url, signal)
      if (wait < 0 || wait > policy.maxSlotWaitS) throw e
      for (let left = wait; left > 0; left--) {
        row.note(`429 · a slot frees in ${left} s`)
        await sleep(1000, signal)
      }
      return await once(url, row)
    }
  }
  const endpoints = FROM_ENV ? FROM_ENV.split(',').map((s) => s.trim()) : policy.endpoints
  const pauses = policy.pauses
  const rounds = pauses.length
  for (let round = 0; round < rounds; round++) {
    for (let left = pauses[round]; left > 0; left--) {
      download.note(`round ${round + 1} of ${rounds} in ${left} s`)
      await sleep(1000, signal)
    }
    for (let i = 0; i < endpoints.length; i++) {
      const url = endpoints[i]
      const row = download.child(`try-${round}-${i}`, `OSM from ${host(url)}`, 0, 'bytes')
      try {
        const text = await tryServer(url, row)
        row.ok()
        return text
      } catch (e) {
        // The draw was cancelled: stop, do not try the next server.
        if (signal.aborted) throw e
        const why = e?.message ?? String(e)
        const next =
          i + 1 < endpoints.length
            ? `trying ${host(endpoints[i + 1])}`
            : round + 1 < rounds
              ? `round ${round + 2} of ${rounds} in ${pauses[round + 1]} s`
              : 'no servers left'
        download.log('warn', `${host(url)} ${why} · ${next}`)
        row.fail(why)
      }
    }
  }
  download.note(`no server answered in ${rounds} rounds`)
  throw new Error(`no Overpass server answered in ${rounds} rounds; try again later`)
}

/** One POST to one server, counting the reply's bytes as they arrive. */
async function attempt(url, query, signal, row, download, timeoutS) {
  // The draw's cancel plus a clock for the first byte, whichever comes first.
  const clock = new AbortController()
  let timer = setTimeout(() => clock.abort(), timeoutS * 1000)
  const onAbort = () => clock.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    row.note('waiting for the server')
    download.note('')
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: clock.signal,
      })
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      // A browser hides why a request failed: no such host, refused, or not
      // allowed from a page (CORS) all look the same.
      throw new Error('unreachable from the page')
    }
    clearTimeout(timer)
    timer = null
    if (!res.ok) throw new Error(statusWords(res.status))

    // Overpass streams its answer, usually without a length: only fill a bar
    // when the size is announced.
    const size = Number(res.headers.get('Content-Length')) || 0
    if (size) row.setTotal(size)
    const reader = res.body.getReader()
    const chunks = []
    let got = 0
    let first = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      first ||= performance.now()
      const since = (performance.now() - first) / 1000
      const perS = got / Math.max(since, 1e-3)
      const rate = since < 0.5 ? '' : perS >= 1e6 ? `${(perS / 1e6).toFixed(1)} MB/s` : `${Math.round(perS / 1e3)} kB/s`
      row.step(got, rate)
    }
    const text = new TextDecoder().decode(concat(chunks, got))
    // A server that is up but busy answers 200 with an HTML error page.
    if (!text.trimStart().startsWith('{')) throw new Error('answered, but not JSON')
    return text
  } catch (e) {
    if (e?.name === 'AbortError' && !signal.aborted) throw new Error(`no answer in ${timeoutS} s`)
    throw e
  } finally {
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Seconds until `url` has a free slot for this page, from its status page; -1 when unknown. */
async function slotWait(engine, url, signal) {
  try {
    const r = await fetch(engine.overpassStatusUrl(url), { signal })
    return r.ok ? engine.overpassSlotWait(await r.text()) : -1
  } catch (e) {
    if (signal.aborted) throw e
    return -1
  }
}

/** A failed status in a few words, as the command line words it. */
function statusWords(code) {
  return (
    { 406: '406 not acceptable', 429: '429 too many requests', 502: '502 bad gateway', 503: '503 unavailable', 504: '504 gateway timeout' }[code] ??
    `http ${code}`
  )
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function concat(chunks, length) {
  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

const mbBare = (bytes) => (bytes / 1e6).toFixed(1)

/** "fetched 3 days ago", as the command line words it. */
function ageWords(s) {
  if (s < 120) return 'fetched just now'
  if (s < 7200) return `fetched ${Math.floor(s / 60)} min ago`
  if (s < 2 * 86400) return `fetched ${Math.floor(s / 3600)} h ago`
  return `fetched ${Math.floor(s / 86400)} days ago`
}

const CACHE_NAME = 'drawland-overpass-v1'
const ORIGIN = 'https://drawland.invalid/overpass/'
const OLD_CACHE_NAME = 'postcards-overpass-v1'
const OLD_ORIGIN = 'https://postcards.invalid/overpass/'

/** Replies kept before the app was renamed from postcards, moved over once. */
async function adoptOldCache(cache) {
  if (!(await caches.has(OLD_CACHE_NAME))) return
  const old = await caches.open(OLD_CACHE_NAME)
  for (const r of await old.keys()) {
    const reply = await old.match(r)
    if (reply && r.url.startsWith(OLD_ORIGIN)) await cache.put(ORIGIN + r.url.slice(OLD_ORIGIN.length), reply)
  }
  await caches.delete(OLD_CACHE_NAME)
}

/**
 * Where replies are kept: Cache Storage, each under a made-up URL that
 * carries its meta (`{ bbox, keys, fetched, bytes }`), so listing them needs
 * no reads. Without Cache Storage (a page served over plain http) a Map, for
 * this session only.
 */
async function openStore() {
  const keyOf = (meta) => `${ORIGIN}${meta.bbox.map((v) => v.toFixed(4)).join('_')}?m=${encodeURIComponent(JSON.stringify(meta))}`
  const metaOf = (url) => {
    try {
      return JSON.parse(new URL(url).searchParams.get('m'))
    } catch {
      return null
    }
  }
  if (typeof caches === 'undefined') return memoryStore(keyOf, metaOf)
  const cache = await caches.open(CACHE_NAME)
  await adoptOldCache(cache)
  return {
    list: async () => (await cache.keys()).map((r) => ({ key: r.url, meta: metaOf(r.url) })).filter((s) => s.meta),
    read: async (key) => (await cache.match(key))?.text() ?? null,
    write: async (meta, text) => {
      const key = keyOf(meta)
      // A reply for the same ground replaces the old one.
      for (const r of await cache.keys()) if (sameGround(metaOf(r.url), meta) && r.url !== key) await cache.delete(r)
      await cache.put(key, new Response(text, { headers: { 'Content-Type': 'application/json' } }))
      return key
    },
    remove: (key) => cache.delete(key),
  }
}

const sameGround = (a, b) => !!a && a.bbox.join() === b.bbox.join() && a.keys.join() === b.keys.join()

const memory = new Map()
function memoryStore(keyOf, metaOf) {
  return {
    list: async () => [...memory.keys()].map((key) => ({ key, meta: metaOf(key) })),
    read: async (key) => memory.get(key) ?? null,
    write: async (meta, text) => {
      const key = keyOf(meta)
      memory.set(key, text)
      return key
    },
    remove: async (key) => memory.delete(key),
  }
}

function host(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
