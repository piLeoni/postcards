/**
 * Sharing a profile script.
 *
 * The document is the script, and the script is text, so a share is the text
 * itself — not the compiled graph. Two transports, chosen by size:
 *
 *   1. Self-contained URL. The script, deflated and written in the fragment:
 *      `#js=<payload>` (a Python script would be `#py=…`). No server, no
 *      storage, no retention policy; the recipient decodes it and reads a
 *      script. This is the default, and it is only offered while the encoded
 *      payload stays short enough to paste (`SHARE_MAX`).
 *   2. Short link. A content hash in the fragment — `#s=<hash>` — that a
 *      small object-store Worker resolves to the script. This is a
 *      *shortening* of the same thing: the URL path needs no server, so a
 *      store that is down never breaks sharing, only short links.
 *
 * `lz-string` gives a payload that is already URL-safe, so the fragment is
 * written as-is: no second percent-encoding layer, and no `+`/`/`/`=` to
 * escape. The result is stable to paste in chat and email.
 */
import LZString from 'lz-string'

/** The fragment keys the page reads, one per script language. */
export const LANGS = { js: 'javascript', py: 'python' }

/**
 * The longest `#js=` payload the page will offer as a link. A browser takes
 * far more, but a URL is only shareable while it survives a chat client and
 * an email wrap; past this the short link is the honest answer. The payload
 * is base64-of-deflate, so a ~2 KB script lands well under it.
 */
export const SHARE_MAX = 1800

/**
 * Where the short-link store lives, from the build's `VITE_SHARE_ENDPOINT`.
 * Empty (the default) means no store is deployed: the short link is offered as
 * "not available" rather than failing on click. A deployment sets it to the
 * Worker in `share/`, on its own origin, with its `/_share` path.
 */
export const SHARE_ENDPOINT = import.meta.env?.VITE_SHARE_ENDPOINT ?? ''

/** The payload for `text`: deflated and URL-safe, or `''` for empty text. */
export function encodeScript(text) {
  return text ? LZString.compressToEncodedURIComponent(text) : ''
}

/** The script `payload` carries, or `null` when it is not one. */
export function decodeScript(payload) {
  if (!payload) return null
  try {
    return LZString.decompressFromEncodedURIComponent(payload)
  } catch {
    return null
  }
}

/** The `#js=`-style payload from a fragment, or `null`: `{ lang, kind, value }`. */
export function readFragment(hash) {
  const m = (hash ?? '').replace(/^#/, '').match(/^(js|py|s)=(.+)$/)
  if (!m) return null
  const [, key, value] = m
  return key === 's' ? { kind: 'id', id: decodeURIComponent(value) } : { lang: LANGS[key], kind: 'script', text: decodeScript(value) }
}

/**
 * A fragment for `text` in `lang`, or `null` when it would be too long to
 * share. The value is already URL-safe, so it is written without escaping.
 */
export function scriptFragment(text, lang = 'js') {
  const value = encodeScript(text)
  if (!value) return null
  const payload = `${lang}=${value}`
  return payload.length <= SHARE_MAX ? `#${payload}` : null
}

/** A fragment for a short-link id. */
export const idFragment = (id) => `#s=${encodeURIComponent(id)}`

/** The full share URL for `text`, or `null` when it would be too long. */
export function shareUrl(text, lang = 'js', href = typeof location !== 'undefined' ? location.href : '') {
  const fragment = scriptFragment(text, lang)
  if (!fragment) return null
  const base = href.split('#')[0]
  return `${base}${fragment}`
}

/** The script length past which the URL form is no longer offered. */
export const tooLongForUrl = (text, lang = 'js') => scriptFragment(text, lang) === null

/* ---------------------------------------------------------------- */
/*  The two ways to share, described — for the share sheet           */
/* ---------------------------------------------------------------- */

/** A link and what to say about it: `{ id, title, hint, link, chars, ok, why }`. */
/** A link and what to say about it: `{ id, title, hint, link, ok, why, placeholder }`. */
const option = (id, title, hint, link, ok, why, placeholder) => ({ id, title, hint, link, ok, why, placeholder, chars: link?.length ?? 0 })

/**
 * Both ways to share `text`, ready to show: the full link (only while it stays
 * short enough to paste) and the short link. Each carries the link itself when
 * it is there, and `why` when it is not; `placeholder` is the shape of the link
 * for when it is not, so both rows keep the same box to line up. The sheet is a
 * view over this, and the reasoning lives in one tested place.
 */
export function shareOptions(text, lang = 'js', href = typeof location !== 'undefined' ? location.href : '') {
  const url = shareUrl(text, lang, href)
  const base = href.split('#')[0]
  // A short link's shape without a script in hand: the page, then a hash.
  const shortShape = `${base}#s…`
  return [
    option(
      'url',
      'Full link',
      'Your whole script, inside the link. Anyone who opens it gets your drawing, ready to run.',
      url,
      Boolean(url),
      url ? null : 'Too long for a full link. Use a short link instead.',
      `${base}#js…`,
    ),
    option(
      'stored',
      'Short link',
      'A brief link that opens the same script. Easier to paste into a message.',
      hasStore() ? shortShape : null,
      hasStore(),
      hasStore() ? null : 'Not available yet.',
      shortShape,
    ),
  ]
}

/**
 * Resolve a short link for `text`: store it under its content id and return
 * the full link, or `null` when the store did not take it. The id is the name,
 * so an identical script shares one blob.
 *
 * The link points at **the page the app is on** (`href`), never at the store:
 * opening it loads the app, which then fetches the script by hash. That is what
 * makes the same link shape survive a move from `localhost` to `draw.land`.
 */
export async function storeScript(text, href = typeof location !== 'undefined' ? location.href : '', endpoint = SHARE_ENDPOINT) {
  const id = await contentId(text)
  if (!(await putScript(text, id, endpoint))) return null
  return `${href.split('#')[0]}${idFragment(id)}`
}

/* ---------------------------------------------------------------- */
/*  Content id — the name of a script, for the short-link store      */
/* ---------------------------------------------------------------- */

/**
 * `sha256` of `text`, as 16 base64url chars: the name a short link uses. It
 * is a content address — the same script shared twice is one id, and the
 * store has nothing to look up or edit, only blob by name.
 */
export async function contentId(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '').slice(0, 16)
}

/* ---------------------------------------------------------------- */
/*  The store — a dumb blob endpoint, no ownership, no listing       */
/* ---------------------------------------------------------------- */

/** Store `text` under `id`; `true` when it is there (freshly written or already). */
export async function putScript(text, id, endpoint = SHARE_ENDPOINT) {
  const res = await fetch(`${endpoint}/${id}`, { method: 'PUT', body: text })
  // 201 written, 204/409 already there: all mean the bytes are stored.
  return res.ok || res.status === 409
}

/** The script stored under `id`, or `null` when there is none. */
export async function getScript(id, endpoint = SHARE_ENDPOINT) {
  const res = await fetch(`${endpoint}/${encodeURIComponent(id)}`)
  return res.ok ? res.text() : null
}

/** Whether a store is configured to write to (short links are off without one). */
export const hasStore = () => Boolean(SHARE_ENDPOINT)

/* ---------------------------------------------------------------- */
/*  Reading a share on load                                          */
/* ---------------------------------------------------------------- */

/**
 * The script a page was opened with, or `null`: the `#js=`/`#py=` payload, or
 * the `#s=` id resolved through the store. Read once, before the document is
 * first read, so the engine compiles the shared script rather than the stored
 * one. `store` is the fetch to use for a short link (tests pass their own).
 */
export async function sharedScript(hash = typeof location !== 'undefined' ? location.hash : '', store = getScript) {
  const frag = readFragment(hash)
  if (!frag) return null
  if (frag.kind === 'script') return frag.text ? { lang: frag.lang, text: frag.text } : null
  try {
    const text = await store(frag.id)
    return text ? { lang: 'javascript', text } : null
  } catch {
    return null
  }
}

/**
 * The fragment read *synchronously* at import: only the self-contained form
 * can be known before the first render, and it is the one that must seed the
 * document at once. A short link is resolved a moment later (`sharedScript`),
 * then applied like a preset.
 */
export const inlineShare = (hash = typeof location !== 'undefined' ? location.hash : '') => {
  const frag = readFragment(hash)
  return frag?.kind === 'script' && frag.text ? frag : null
}