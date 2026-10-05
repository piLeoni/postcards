// The share store's behaviour, against a fake R2 binding: content-addressed,
// write-once, and guarded on the write path only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.js'

/** A stand-in R2 bucket: `{ store: Map<key, string> }`. */
function bucket(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    async head(key) {
      return store.has(key) ? { httpEtag: 'etag' } : null
    },
    async get(key) {
      if (!store.has(key)) return null
      const text = store.get(key)
      return { body: text, httpEtag: 'etag' }
    },
    async put(key, text) {
      store.set(key, text)
    },
  }
}

const env = (over = {}) => ({ SHARE: bucket(), MAX_BYTES: '65536', WRITE_PER_MIN: '30', ...over })

const put = (path, body, headers = {}, e = env()) =>
  worker.fetch(new Request(`https://draw.land${path}`, { method: 'PUT', body, headers }), e)
const get = (path, e = env()) => worker.fetch(new Request(`https://draw.land${path}`), e)

const ID = 'abcdef0123456789'

test('a script is stored once and read back unchanged', async () => {
  const e = env()
  const stored = await put(`/_share/${ID}`, 'title("A")\ndraw()\n', {}, e)
  assert.equal(stored.status, 201)
  assert.equal(e.SHARE.store.get(`scripts/${ID}`), 'title("A")\ndraw()\n')

  const read = await get(`/_share/${ID}`, e)
  assert.equal(read.status, 200)
  assert.equal(await read.text(), 'title("A")\ndraw()\n')
  assert.match(read.headers.get('cache-control'), /immutable/)
})

test('writing an id that is already stored changes nothing', async () => {
  const e = env({ SHARE: bucket({ [`scripts/${ID}`]: 'first\n' }) })
  const again = await put(`/_share/${ID}`, 'second\n', {}, e)
  assert.equal(again.status, 204)
  assert.equal(e.SHARE.store.get(`scripts/${ID}`), 'first\n')   // content-addressed: never overwritten
})

test('a malformed id is refused, a missing blob is a plain 404', async () => {
  assert.equal((await put('/_share/short', 'x')).status, 400)
  assert.equal((await get('/_share/has spaces')).status, 400)
  assert.equal((await get('/_share/aaaaaaaaaaaaaaaa')).status, 404)
})

test('the write guards hold: size, emptiness, and a script-shaped body', async () => {
  assert.equal((await put(`/_share/${ID}`, 'x'.repeat(70000), {}, env({ MAX_BYTES: '65536' }))).status, 413)
  assert.equal((await put(`/_share/${ID}`, '   ')).status, 422)
  assert.equal((await put(`/_share/${ID}`, 'has\u0000null')).status, 422)
})

test('only writes are rate-limited', async () => {
  // Start this IP at the limit, then one more write is refused; a read still is not.
  const e = env({ WRITE_PER_MIN: '1' })
  const headers = { 'cf-connecting-ip': '203.0.113.7' }
  assert.equal((await put(`/_share/${ID}`, 'draw()\n', headers, e)).status, 201)
  assert.equal((await put(`/_share/bbbbbbbbbbbbbbbb`, 'draw()\n', headers, e)).status, 429)
  assert.equal((await get(`/_share/${ID}`, e)).status, 200)
})

test('a path that is not a share goes to the static site when there is one', async () => {
  const assets = { fetch: async () => new Response('index', { status: 200 }) }
  const e = env({ ASSETS: assets })
  const res = await worker.fetch(new Request('https://draw.land/app'), e)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'index')
})

test('a path that is not a share is a 404 with no site to fall back to', async () => {
  assert.equal((await worker.fetch(new Request('https://draw.land/nope'), env())).status, 404)
})

test('every answer carries CORS, and a preflight is answered without the store', async () => {
  const pre = await worker.fetch(new Request('https://draw.land/_share/abcdef0123456789', { method: 'OPTIONS' }), env())
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), '*')
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/)

  const read = await get('/_share/abcdef0123456789', env({ SHARE: bucket({ 'scripts/abcdef0123456789': 'draw()\n' }) }))
  assert.equal(read.headers.get('access-control-allow-origin'), '*')
})
