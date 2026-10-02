/**
 * Overpass, the way the command line asks it (`postcards-cli/src/osm_http.rs`):
 * the servers and the rounds come from the core (`overpassPolicy`), every try
 * is a row under `download` counting the bytes as they arrive, a wait between
 * rounds counts down on `download` itself, and a failed try is logged with
 * what happens next.
 *
 * Runs in the draw worker. `VITE_OVERPASS_URL` (comma separated) replaces the
 * servers, as `POSTCARDS_OVERPASS` does for the command line.
 */

const FROM_ENV = import.meta.env.VITE_OVERPASS_URL || ''

/** Replies already downloaded this session, by query: the page's cache. */
const cache = new Map()

/**
 * The Overpass JSON for `query`. `policy` is `overpassPolicy()` from the
 * engine; `download` the task the tries are rows of.
 */
export async function fetchOverpass(query, signal, download, policy) {
  const hit = cache.get(query)
  if (hit) {
    download.child('osm-cache', 'OSM from cache').ok(`${mbBare(hit.length)} MB`)
    download.log('info', 'cached reply, downloaded earlier in this session')
    return hit
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
        const text = await attempt(url, query, signal, row, download, policy.timeoutS)
        row.ok()
        cache.set(query, text)
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

function host(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
