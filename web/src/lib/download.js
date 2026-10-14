/**
 * Export the drawn SVG (and raster fallbacks) from the browser.
 */
import { svgTextToPngBlob } from './preview.js'

const slugToken = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const safeLayer = (id) => slugToken(id) || 'layer'

/**
 * Clean a user-provided file stem: drop unsafe characters and trim leading or
 * trailing hyphens/dots so `-` only appears between particles.
 */
export function sanitizeBasename(name) {
  const s = String(name ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return s || 'drawland'
}

/**
 * Join non-empty file name particles with `-` so hyphens only sit between
 * tokens (`drawland-a1b2c3d4`, `drawland-a1b2c3d4-r1c1`, `drawland-a1b2c3d4-roads`).
 */
export function joinNameParts(...parts) {
  const cleaned = parts
    .map((p) => String(p ?? '').trim().replace(/^[-_]+|[-_]+$/g, ''))
    .filter(Boolean)
  return cleaned.join('-') || 'drawland'
}

/**
 * 8 lowercase hex chars from SHA-256 of `text` (strictly `[0-9a-f]`, never `-` or `_`).
 */
export async function shortHexId(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Default download stem: `drawland-` + 8 hex chars from the script SHA-256.
 * Never ends with `-`.
 */
export async function suggestExportBasename(doc) {
  const hex = await shortHexId(doc)
  return joinNameParts('drawland', hex)
}

/** @deprecated use suggestExportBasename */
export const exportBasename = suggestExportBasename

/** Round decimal numbers in SVG markup; integers are left alone. */
export function roundSvgNumbers(svgText, decimals) {
  if (!Number.isFinite(decimals) || decimals < 0) return svgText
  const d = Math.min(6, Math.max(0, Math.round(decimals)))
  const re = /(-?\d+\.\d+)/g
  return svgText.replace(re, (m) => {
    const n = Number(m)
    if (!Number.isFinite(n)) return m
    const r = Number(n.toFixed(d))
    return Object.is(r, -0) ? '0' : String(r)
  })
}

/**
 * Top-level `<g id="…">` groups inside the SVG (one string per group, with the
 * same header and footer as the source).
 */
export function splitSvgByTopLevelGroups(svgText) {
  const close = svgText.lastIndexOf('</svg>')
  if (close < 0) return []
  const styleEnd = svgText.indexOf('</style>')
  const openEnd = svgText.indexOf('>')
  const headerEnd = styleEnd >= 0 && styleEnd < close ? styleEnd + 8 : openEnd + 1
  if (headerEnd <= 0) return []
  const header = svgText.slice(0, headerEnd)
  const footer = svgText.slice(close)
  const body = svgText.slice(headerEnd, close)

  const out = []
  let pos = 0
  while (pos < body.length) {
    const g = body.indexOf('<g', pos)
    if (g < 0) break
    if (g > pos && !/^\s*$/.test(body.slice(pos, g))) break
    const idM = body.slice(g).match(/^<g\s+id="([^"]+)"/)
    if (!idM) break
    const id = idM[1]
    let depth = 0
    let j = g
    let end = -1
    while (j < body.length) {
      const nextOpen = body.indexOf('<g', j)
      const nextClose = body.indexOf('</g>', j)
      if (nextClose < 0) break
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++
        j = nextOpen + 2
      } else {
        depth--
        if (depth === 0) {
          end = nextClose + 4
          break
        }
        j = nextClose + 4
      }
    }
    if (end < 0) break
    const chunk = body.slice(g, end)
    out.push([id, `${header}\n${chunk}\n${footer}`])
    pos = end
  }
  return out
}

/** PNG raster scale from target DPI (25.4 mm per inch). */
export function pxPerMmFromDpi(dpi) {
  const n = Number(dpi)
  if (!Number.isFinite(n) || n <= 0) return 10
  return n / 25.4
}

/**
 * Build `{ name, blob }` files from the last draw and export options.
 *
 * @param {object} drawing `{ svg, slices?, groups? }`
 * @param {object} options
 * @param {string} options.basename file stem without extension (user-edited)
 * @param {'svg'|'png'} options.format
 * @param {number|string|null|undefined} options.svgDecimals `null`/empty = full precision
 * @param {boolean} options.perLayer one SVG per grammar layer
 * @param {'whole'|'slices'} [options.sliceMode] `'whole'` (all together) or `'slices'` (one file per slice)
 * @param {boolean} [options.perSheet] legacy alias for `sliceMode === 'slices'`
 * @param {number} options.pngDpi raster resolution
 * @param {'transparent'|'white'} options.pngBackground
 */
export async function prepareDownloads(drawing, options) {
  if (!drawing?.svg) return []
  const base = sanitizeBasename(options.basename)
  const wantSlices = (options.sliceMode === 'slices' || options.perSheet === true) && drawing.slices?.length > 0
  const sliceList = wantSlices
    ? drawing.slices.map(([name, blob]) => ({ sheet: name, blob }))
    : [{ sheet: '', blob: drawing.svg }]

  const files = []
  for (const { sheet, blob } of sliceList) {
    let text = await blob.text()
    if (options.svgDecimals != null && options.svgDecimals !== '' && Number.isFinite(Number(options.svgDecimals))) {
      text = roundSvgNumbers(text, Number(options.svgDecimals))
    }
    const stem = joinNameParts(base, sheet)

    if (options.format === 'png') {
      const png = await svgTextToPngBlob(text, {
        pxPerMm: pxPerMmFromDpi(options.pngDpi),
        background: options.pngBackground,
      })
      if (png) files.push({ name: `${stem}.png`, blob: png })
      continue
    }

    if (options.perLayer) {
      const layers = splitSvgByTopLevelGroups(text)
      if (layers.length > 1) {
        for (const [id, layerSvg] of layers) {
          files.push({
            name: `${joinNameParts(stem, safeLayer(id))}.svg`,
            blob: new Blob([layerSvg], { type: 'image/svg+xml' }),
          })
        }
        continue
      }
    }

    files.push({ name: `${stem}.svg`, blob: new Blob([text], { type: 'image/svg+xml' }) })
  }
  return files
}

/** Trigger browser downloads; spaced so multi-file exports are not dropped. */
export async function saveDownloads(files) {
  for (const [i, { name, blob }] of files.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 300))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
