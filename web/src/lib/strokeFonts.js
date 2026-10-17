/**
 * Single-stroke font bytes (EMS SVG, etc.) for labels and `lines.text`.
 * Fetched on the main thread before draw when possible.
 */

import { strokeFontFetchUrl } from './strokeFontUrls'

async function fetchChecked(url, signal, what) {
  let res
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    const hint =
      e?.message === 'Failed to fetch'
        ? ' (network block or missing bundled font — catalog fonts load from this site, not GitLab)'
        : ''
    throw new Error(`${what}: ${e?.message ?? e}${hint}`)
  }
  if (!res.ok) {
    throw new Error(`${what}: HTTP ${res.status} ${res.statusText} — ${url}`)
  }
  return res
}

export async function fetchStrokeFontUrl(catalogUrl, signal) {
  const fetchUrl = strokeFontFetchUrl(catalogUrl)
  const buf = await fetchChecked(fetchUrl, signal, `stroke font`).then((r) => r.arrayBuffer())
  return new Uint8Array(buf)
}

export async function loadStrokeFontsForGraph(engine, graph, signal) {
  const keys = [...engine.strokeFontKeys(graph)]
  const out = {}
  for (const url of keys) {
    out[url] = await fetchStrokeFontUrl(url, signal)
  }
  return out
}

/** Download in the worker when the page did not prefetch (CLI uses Rust). */
export async function fetchStrokeFonts(engine, graph, job, signal, task) {
  const keys = [...engine.strokeFontKeys(graph)]
  if (!keys.length) return
  const row = task.child('stroke-fonts', 'stroke-fonts', keys.length, 'stroke fonts')
  let done = 0
  for (const url of keys) {
    const bytes = await fetchStrokeFontUrl(url, signal)
    job.addStrokeFont(url, bytes)
    done += 1
    row.step(done, url)
  }
  row.ok(`${keys.length} font${keys.length === 1 ? '' : 's'}`)
}
