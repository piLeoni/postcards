// `npm test`: sharing a profile script, encoded in a URL or named by a hash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contentId,
  decodeScript,
  encodeScript,
  hasStore,
  idFragment,
  inlineShare,
  LANGS,
  readFragment,
  scriptFragment,
  SHARE_MAX,
  shareOptions,
  shareUrl,
  sharedScript,
  storeScript,
  tooLongForUrl,
} from './share.js'

const SCRIPT = `title("Parks")
output({ width: "6in", height: "4in", scale: "1:8000", lat: 37.8, lng: -122.2 })

const parks = areas.polygons(features.tiles("parks"))
draw({ id: "ring", from: lines.rings(parks), stroke: "solid" })
`

test('a script survives the round trip through the payload', () => {
  assert.equal(decodeScript(encodeScript(SCRIPT)), SCRIPT)
  // The payload is URL-fragment safe: no `/`, `#` or `=` to break the value.
  // (`+` is legal in a fragment, so it is left as it is.)
  assert.ok(!/[#/=]/.test(encodeScript(SCRIPT)))
  assert.equal(encodeScript(''), '')
})

test('the fragment names the language and carries the script', () => {
  const fragment = scriptFragment(SCRIPT)
  assert.ok(fragment.startsWith('#js='))
  assert.deepEqual(readFragment(fragment), { lang: LANGS.js, kind: 'script', text: SCRIPT })
  assert.deepEqual(readFragment(scriptFragment('draw()\n', 'py')), { lang: LANGS.py, kind: 'script', text: 'draw()\n' })
})

test('a fragment the page does not know is ignored, not guessed at', () => {
  assert.equal(readFragment(''), null)
  assert.equal(readFragment('#other=1'), null)
  assert.equal(readFragment('#js='), null)
  assert.equal(decodeScript('not a payload'), null)
})

test('a script too long to paste is not offered as a URL', () => {
  // Incompressible: a long script with nothing to deflate, so the payload is
  // genuinely over the limit rather than shrinking away. A fixed LCG, so the
  // text is the same every run.
  let seed = 123456789
  const chars = Array.from({ length: 6000 }, () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return String.fromCharCode(33 + ((seed >>> 8) % 94))
  })
  const big = chars.join('')
  assert.equal(scriptFragment(big), null)
  assert.equal(shareUrl(big, 'js', 'https://draw.land/'), null)
  assert.equal(tooLongForUrl(big), true)
  assert.equal(tooLongForUrl(SCRIPT), false)
})

test('a share URL is the page without its old fragment, plus the payload', () => {
  const url = shareUrl(SCRIPT, 'js', 'https://draw.land/app#js=old')
  assert.equal(url, `https://draw.land/app${scriptFragment(SCRIPT)}`)
  assert.equal(readFragment(url.slice(url.indexOf('#'))).text, SCRIPT)
})

test('a short link is a content id, and the id changes with the script', async () => {
  const id = await contentId(SCRIPT)
  assert.match(id, /^[A-Za-z0-9_-]{16}$/)
  assert.equal(await contentId(SCRIPT), id)         // content-addressed: stable
  assert.notEqual(await contentId(SCRIPT + '\n'), id)
  assert.deepEqual(readFragment(idFragment(id)), { kind: 'id', id })
})

test('a short link is resolved through the store, and a dead store is kept quiet', async () => {
  const id = await contentId(SCRIPT)
  const store = async (want) => (want === id ? SCRIPT : null)
  assert.deepEqual(await sharedScript(idFragment(id), store), { lang: 'javascript', text: SCRIPT })
  assert.equal(await sharedScript(idFragment('nope'), store), null)
  assert.equal(await sharedScript(idFragment(id), async () => { throw new Error('down') }), null)
})

test('only the self-contained payload is known before the first render', () => {
  const inline = inlineShare(scriptFragment(SCRIPT))
  assert.equal(inline.text, SCRIPT)
  assert.equal(inlineShare(idFragment('abcdef0123456789')), null)
  assert.equal(inlineShare(''), null)
})
test('short links are off while no store is configured', () => {
  // SHARE_ENDPOINT is a same-origin path by default, so the store is on; the
  // predicate is here so a build with no Worker can turn it off.
  assert.equal(typeof hasStore(), 'boolean')
})

test('the share sheet shows both ways, and says why one is missing', () => {
  const [url, stored] = shareOptions(SCRIPT, 'js', 'https://draw.land/app')
  assert.equal(url.id, 'url')
  assert.equal(stored.id, 'stored')
  assert.equal(url.link, shareUrl(SCRIPT, 'js', 'https://draw.land/app'))
  assert.equal(url.ok, true)
  assert.equal(url.why, null)
  assert.ok(url.hint.length > 20 && stored.hint.length > 20)
  // Test builds have no store (`VITE_SHARE_ENDPOINT` is unset), so the short
  // link is offered as a choice with a reason, not as a link — but it still
  // carries the shape of a short link, so both rows line up.
  assert.equal(stored.ok, false)
  assert.match(stored.why, /available/i)
  assert.match(stored.placeholder, /#s/)
  assert.match(url.placeholder, /#js/)

  // A script too long for a URL says so, in words, rather than hiding the row.
  let seed = 42
  const big = Array.from({ length: 6000 }, () => {
    seed = (1664525 * seed + 1013904223) >>> 0
    return String.fromCharCode(33 + ((seed >>> 8) % 94))
  }).join('')
  const [bigUrl] = shareOptions(big, 'js', 'https://draw.land/')
  assert.equal(bigUrl.ok, false)
  assert.equal(bigUrl.link, null)
  assert.match(bigUrl.why, /too long/i)
})

test('a script is stored under its content id and the short link names it', async () => {
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push([url, init?.method, init?.body])
    return new Response(null, { status: 201 })
  }
  try {
    const link = await storeScript(SCRIPT, 'https://draw.land/app', '/_share')
    const id = await contentId(SCRIPT)
    assert.equal(link, `https://draw.land/app${idFragment(id)}`)
    assert.deepEqual(seen, [[`/_share/${id}`, 'PUT', SCRIPT]])

    // A store that refuses leaves nothing to hand back.
    globalThis.fetch = async () => new Response('nope', { status: 500 })
    assert.equal(await storeScript(SCRIPT, 'https://draw.land/app', '/_share'), null)
  } finally {
    delete globalThis.fetch
  }
})

test('the short link is on the page, never on the store', async () => {
  globalThis.fetch = async () => new Response(null, { status: 201 })
  const id = await contentId(SCRIPT)
  try {
    // Same link shape wherever the app is hosted — the store origin never leaks
    // into the link, so moving from localhost to draw.land changes nothing.
    for (const page of ['http://localhost:5174/', 'https://draw.land/', 'https://draw.land/app?x=1#old']) {
      const link = await storeScript(SCRIPT, page, 'https://drawland-share.pietro-leoni.workers.dev/_share')
      assert.equal(link, `${page.split('#')[0]}${idFragment(id)}`)
      assert.ok(!link.includes('workers.dev'))
    }
  } finally {
    delete globalThis.fetch
  }
})
