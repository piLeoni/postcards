/**
 * The draw.land share store, on Cloudflare Workers + R2.
 *
 * Two routes, both by content id (see `web/src/lib/share.js`):
 *
 *   PUT  /_share/<id>   write the script, if it is not already there
 *   GET  /_share/<id>   read it back
 *
 * The id is the sha256 of the script, so the store has no ownership, no
 * listing, no accounts and nothing to edit — it is a blob endpoint, and the
 * only thing to protect is the write path. That is done with three cheap
 * guards: the id must look like one of ours, the body must be a plausible
 * script under `MAX_BYTES`, and writes are rate-limited per IP. Reads are
 * uncapped and cached, since a link is meant to be followed.
 */

const ID = /^[A-Za-z0-9_-]{16}$/

/** 400 for a malformed id: the store only ever addresses its own blobs. */
const badId = () => new Response('bad id\n', { status: 400 })

/** 404 for a blob that is not there. */
const missing = () => new Response('not found\n', { status: 404 })

/**
 * CORS for the app calling the store from another origin (a dev server, or a
 * site hosted elsewhere). The store is content-addressed and holds only
 * scripts that are already public to whoever has the link, so it is open to
 * any origin; the guards that matter are on the write path, not the origin.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

/** `res` with the CORS headers added, so every path answers a preflight. */
function withCors(res) {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/** A fixed-window write limiter, per IP per minute. In-memory, so it is a
 * speed bump per isolate rather than a hard quota; R2's own limits are the
 * real ceiling, and a script is at most `MAX_BYTES`. */
const hits = new Map()
function overLimit(ip, perMinute) {
  const now = Date.now()
  const minute = Math.floor(now / 60000)
  const seen = hits.get(ip)
  if (!seen || seen.minute !== minute) {
    hits.set(ip, { minute, n: 1 })
    return false
  }
  seen.n += 1
  // Housekeep: the map would otherwise grow with every distinct IP forever.
  if (hits.size > 4096) for (const [k, v] of hits) if (v.minute !== minute) hits.delete(k)
  return seen.n > perMinute
}

/** Whether `text` is a script this store will keep: valid UTF-8, printable,
 * and not a binary blob someone is trying to park here. */
function plausibleScript(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0)
    if (c === 9 || c === 10 || c === 13) continue
    if (c < 32 || c === 127) return false
  }
  return true
}

export default {
  async fetch(request, env) {
    // A preflight for the cross-origin writes the app makes: answer it here,
    // without touching the store.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    return withCors(await handle(request, env))
  },
}

async function handle(request, env) {
  const url = new URL(request.url)
  const m = url.pathname.match(/^\/_share\/([^/]+)\/?$/)
  if (!m) return env.ASSETS ? env.ASSETS.fetch(request) : missing()

  const id = m[1]
  if (!ID.test(id)) return badId()

  const key = `scripts/${id}`

  if (request.method === 'GET' || request.method === 'HEAD') {
    const head = request.method === 'HEAD'
    const object = await env.SHARE.get(key)
    if (!object) return missing()
    const headers = new Headers({
      'content-type': 'text/plain; charset=utf-8',
      // Immutable by construction: the name is the hash of the bytes.
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    })
    return new Response(head ? null : object.body, { headers })
  }

  if (request.method !== 'PUT') return new Response('method not allowed\n', { status: 405, headers: { allow: 'GET, HEAD, PUT, OPTIONS' } })

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (overLimit(ip, Number(env.WRITE_PER_MIN ?? 30))) return new Response('slow down\n', { status: 429 })

  const max = Number(env.MAX_BYTES ?? 65536)
  const declared = Number(request.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > max) return new Response('too big\n', { status: 413 })

  const text = await request.text()
  if (text.length > max) return new Response('too big\n', { status: 413 })
  if (!text.trim() || !plausibleScript(text)) return new Response('not a script\n', { status: 422 })

  // Content-addressed: an id that is already stored already holds these
  // bytes, so the write is a no-op and reports the same as a fresh one did.
  const existing = await env.SHARE.head(key)
  if (existing) return new Response(null, { status: 204 })

  await env.SHARE.put(key, text, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  })
  return new Response('stored\n', { status: 201 })
}
