/**
 * Font bytes for `modules.labels` Google fonts (woff2 or ttf), decoded in the engine.
 * Fetched on the page thread before draw (workers are often blocked on Google).
 */

function parseKey(key) {
  const parts = key.split(':')
  const italic = parts.at(-1) === 'italic'
  const weight = Number.parseInt(italic ? parts.at(-2) : parts.at(-1), 10)
  const family = italic ? parts.slice(0, -2).join(':') : parts.slice(0, -1).join(':')
  return { family, weight, italic }
}

/** Same idea as `drawland_core::google_fonts::pick_url_from_css`. */
function pickUrl(css) {
  const latin = css.split('/* latin */')[1]
  if (latin) {
    const u = firstGstaticUrl(latin, ['woff2', 'woff', 'ttf'])
    if (u) return u
  }
  return firstGstaticUrl(css, ['ttf']) ?? firstGstaticUrl(css, ['woff2', 'woff'])
}

function firstGstaticUrl(text, exts) {
  for (const chunk of text.split('url(').slice(1)) {
    const url = chunk.split(')')[0]?.trim().replace(/^['"]|['"]$/g, '')
    if (url?.startsWith('https://fonts.gstatic.com/') && exts.some((e) => url.endsWith(e))) return url
  }
  return null
}

async function fetchChecked(url, signal, what) {
  let res
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    const hint =
      e?.message === 'Failed to fetch'
        ? ' (network, VPN, or a block on fonts.googleapis.com / fonts.gstatic.com — try disabling your ad blocker for this site)'
        : ''
    throw new Error(`${what}: ${e?.message ?? e}${hint}`)
  }
  if (!res.ok) {
    throw new Error(`${what}: HTTP ${res.status} ${res.statusText} — ${url}`)
  }
  return res
}

export async function fetchGoogleFontKey(key, signal) {
  const { family, weight, italic } = parseKey(key)
  const familyQ = family.replaceAll(' ', '+')
  const axis = italic ? 'ital,wght' : 'wght'
  const vals = italic ? `1,${weight}` : String(weight)
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyQ}:${axis}@${vals}&display=swap`
  const css = await fetchChecked(cssUrl, signal, `Google Fonts CSS for "${family}"`).then((r) => r.text())
  // A browser gets the face in subsets, a file each (latin, latin-ext,
  // cyrillic, greek…): all of them, latin first, so `İstanbul` or `Łódź`
  // find their letters. Bundled for the engine (`google_fonts::bundle`).
  const urls = subsetUrls(css)
  if (!urls.length) {
    const url = pickUrl(css)
    if (!url) {
      throw new Error(
        `Google font "${family}" (${key}): no font file found in stylesheet — check the family name and weight (e.g. weight: 400).`,
      )
    }
    urls.push(url)
  }
  const files = []
  for (const url of urls) {
    const buf = await fetchChecked(url, signal, `Google font file for "${family}"`).then((r) => r.arrayBuffer())
    files.push(new Uint8Array(buf))
  }
  return files.length === 1 ? files[0] : bundle(files)
}

/** Every subset's font URL in a stylesheet, latin first, then latin-ext, then the rest. */
function subsetUrls(css) {
  const found = []
  for (const block of css.split('/* ').slice(1)) {
    const name = block.slice(0, block.indexOf(' */'))
    const url = firstGstaticUrl(block, ['woff2', 'woff', 'ttf'])
    if (url) found.push([name, url])
  }
  const order = (n) => (n === 'latin' ? 0 : n === 'latin-ext' ? 1 : 2)
  return found.sort((a, b) => order(a[0]) - order(b[0])).map(([, u]) => u)
}

/** `DLFB`, then each file as a little-endian u32 length and its bytes. */
function bundle(files) {
  const total = 4 + files.reduce((n, f) => n + 4 + f.length, 0)
  const out = new Uint8Array(total)
  out.set([0x44, 0x4c, 0x46, 0x42], 0)
  const view = new DataView(out.buffer)
  let at = 4
  for (const f of files) {
    view.setUint32(at, f.length, true)
    out.set(f, at + 4)
    at += 4 + f.length
  }
  return out
}

/** Every key from `engine.googleFontKeys(graph)`, for the main thread to pass into the draw worker. */
export async function loadGoogleFontsForGraph(engine, graph, signal) {
  const keys = [...engine.googleFontKeys(graph)]
  const out = {}
  for (const key of keys) {
    out[key] = await fetchGoogleFontKey(key, signal)
  }
  return out
}

/** Download in the worker when the page did not prefetch (CLI / tests). */
export async function fetchGoogleFonts(engine, graph, job, signal, task) {
  const keys = [...engine.googleFontKeys(graph)]
  if (!keys.length) return
  const row = task.child('google-fonts', 'google-fonts', keys.length, 'google fonts')
  let done = 0
  for (const key of keys) {
    const bytes = await fetchGoogleFontKey(key, signal)
    job.addGoogleFont(key, bytes)
    done += 1
    row.step(done, key)
  }
  row.ok(`${keys.length} font${keys.length === 1 ? '' : 's'}`)
}
