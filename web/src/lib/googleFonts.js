/**
 * TTF bytes for `modules.labels` Google fonts, handed to the job before draw.
 */

const CSS_UA = 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Truetype)'

function parseKey(key) {
  const parts = key.split(':')
  const italic = parts.at(-1) === 'italic'
  const weight = Number.parseInt(italic ? parts.at(-2) : parts.at(-1), 10)
  const family = italic ? parts.slice(0, -2).join(':') : parts.slice(0, -1).join(':')
  return { family, weight, italic }
}

async function fetchOne(key, signal) {
  const { family, weight, italic } = parseKey(key)
  const familyQ = family.replaceAll(' ', '+')
  const axis = italic ? 'ital,wght' : 'wght'
  const vals = italic ? `1,${weight}` : String(weight)
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyQ}:${axis}@${vals}&display=swap`
  const css = await fetch(cssUrl, { signal, headers: { 'User-Agent': CSS_UA } }).then((r) => r.text())
  const ttf = css.match(/src: url\((https:\/\/fonts\.gstatic\.com[^)]+\.ttf)\)/)?.[1]
  if (!ttf) throw new Error(`no TTF for Google font ${family}`)
  const buf = await fetch(ttf, { signal }).then((r) => r.arrayBuffer())
  return new Uint8Array(buf)
}

/** Download every key from `engine.googleFontKeys(graph)` and call `job.addGoogleFont`. */
export async function fetchGoogleFonts(engine, graph, job, signal, task) {
  const keys = [...engine.googleFontKeys(graph)]
  if (!keys.length) return
  const row = task.child('google-fonts', 'google-fonts', keys.length, 'google fonts')
  let done = 0
  for (const key of keys) {
    const bytes = await fetchOne(key, signal)
    job.addGoogleFont(key, bytes)
    done += 1
    row.step(done, key)
  }
  row.ok(`${keys.length} font${keys.length === 1 ? '' : 's'}`)
}
