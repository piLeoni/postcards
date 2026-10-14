/**
 * Streaming raster preview for `draw.worker.js`.
 *
 * As `job.draw` streams ~1 MB chunks of SVG text (`part === 0`), this painter
 * records the vector primitives in compact typed arrays so it can:
 * 1. Render a whole-card `ImageBitmap` immediately when the draw finishes
 *    (used while panning/zooming the map at 60 fps), and
 * 2. Render a sharp viewport-cropped `ImageBitmap` at exact screen device-pixel
 *    resolution whenever the user stops zooming or panning (`renderViewport`),
 *    so zooming in on any detail gives vector-exact SVG crispness without the
 *    browser ever parsing a multi-megabyte SVG DOM.
 */

const MAX_OVERVIEW_PX = 2560
const TARGET_OVERVIEW_PX_PER_MM = 16
const MAX_VIEWPORT_PX = 3840
const STROKE_BATCH = 4096

const DEFAULT_STYLE = {
  stroke: '#000000',
  lineWidth: 0.1,
  lineCap: 'round',
  lineJoin: 'round',
  fill: null,
}

export function createPreviewPainter() {
  if (typeof OffscreenCanvas === 'undefined') return null

  let wMm = 0
  let hMm = 0
  let carry = ''
  let style = { ...DEFAULT_STYLE }
  const stack = []

  // Recorded vector batches in document order:
  // - `{ kind: 'strokes', style, coords: Float32Array, lengths: Uint32Array, bounds: Float32Array }`
  // - `{ kind: 'path', style, d: string, fill: string | null }`
  const items = []

  // Active stroke accumulator for the current style:
  let coordBuf = new Float32Array(65536)
  let coordLen = 0
  let lenBuf = new Uint32Array(16384)
  let boxBuf = new Float32Array(16384 * 4)
  let polyCount = 0

  const ensureCoords = (extra) => {
    if (coordLen + extra <= coordBuf.length) return
    let nextCap = coordBuf.length * 2
    while (nextCap < coordLen + extra) nextCap *= 2
    const next = new Float32Array(nextCap)
    next.set(coordBuf.subarray(0, coordLen))
    coordBuf = next
  }

  const ensurePolys = () => {
    if (polyCount < lenBuf.length) return
    const nextCap = lenBuf.length * 2
    const nextLens = new Uint32Array(nextCap)
    nextLens.set(lenBuf)
    lenBuf = nextLens
    const nextBoxes = new Float32Array(nextCap * 4)
    nextBoxes.set(boxBuf)
    boxBuf = nextBoxes
  }

  const flushGroupStrokes = () => {
    if (polyCount === 0) return
    items.push({
      kind: 'strokes',
      style: { ...style },
      coords: coordBuf.slice(0, coordLen),
      lengths: lenBuf.slice(0, polyCount),
      bounds: boxBuf.slice(0, polyCount * 4),
    })
    coordLen = 0
    polyCount = 0
  }

  const initFromSvgTag = (chunk, start, end) => {
    const tag = chunk.slice(start, end)
    const m = tag.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    if (!m) return
    wMm = parseFloat(m[1])
    hMm = parseFloat(m[2])
  }

  const openGroup = (chunk, start, end) => {
    flushGroupStrokes()
    stack.push({ ...style })
    const next = { ...style }
    const tag = chunk.slice(start, end)
    const sm = tag.match(/style="([^"]*)"/)
    if (sm) {
      for (const part of sm[1].split(';')) {
        const colon = part.indexOf(':')
        if (colon < 0) continue
        const k = part.slice(0, colon).trim()
        const v = part.slice(colon + 1).trim()
        if (!v) continue
        if (k === 'stroke') next.stroke = v === 'none' ? null : v
        else if (k === 'stroke-width') {
          const n = parseFloat(v)
          if (Number.isFinite(n) && n > 0) next.lineWidth = n
        } else if (k === 'stroke-linecap') next.lineCap = v
        else if (k === 'stroke-linejoin') next.lineJoin = v
        else if (k === 'fill') next.fill = v === 'none' ? null : v
      }
    }
    style = next
  }

  const closeGroup = () => {
    flushGroupStrokes()
    if (stack.length) {
      style = stack.pop()
    }
  }

  const recordPath = (chunk, start, end) => {
    flushGroupStrokes()
    const tag = chunk.slice(start, end)
    const dm = tag.match(/\bd="([^"]+)"/)
    if (!dm) return
    const fm = tag.match(/\bfill="([^"]+)"/)
    items.push({
      kind: 'path',
      style: { ...style },
      d: dm[1],
      fill: fm ? fm[1] : style.fill,
    })
  }

  /**
   * Zero-allocation scanner for `<polyline points="x1,y1 x2,y2 ..." />`.
   * Appends coordinates directly into `coordBuf` and records per-polyline
   * bounding boxes in `boxBuf` so viewport renders can frustum-cull strokes.
   */
  const recordPolyline = (chunk, lineStart, lineEnd) => {
    if (!style.stroke) return
    let i = lineStart + 18 // right after `<polyline points="`
    const end = lineEnd - 4 // right at closing `"` before ` />`
    let pts = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    while (i < end) {
      // Parse x
      let sign = 1
      let c = chunk.charCodeAt(i)
      if (c === 45) {
        sign = -1
        i++
        c = chunk.charCodeAt(i)
      }
      let val = 0
      while (c >= 48 && c <= 57) {
        val = val * 10 + (c - 48)
        i++
        c = chunk.charCodeAt(i)
      }
      if (c === 46) {
        i++
        let div = 1
        c = chunk.charCodeAt(i)
        while (c >= 48 && c <= 57) {
          val = val * 10 + (c - 48)
          div *= 10
          i++
          c = chunk.charCodeAt(i)
        }
        val /= div
      }
      const x = sign * val
      i++ // skip ','

      // Parse y
      sign = 1
      c = chunk.charCodeAt(i)
      if (c === 45) {
        sign = -1
        i++
      }
      val = 0
      while (i < end) {
        c = chunk.charCodeAt(i)
        if (c < 48 || c > 57) break
        val = val * 10 + (c - 48)
        i++
      }
      if (i < end && c === 46) {
        i++
        let div = 1
        while (i < end) {
          c = chunk.charCodeAt(i)
          if (c < 48 || c > 57) break
          val = val * 10 + (c - 48)
          div *= 10
          i++
        }
        val /= div
      }
      const y = sign * val
      i++ // skip ' '

      ensureCoords(2)
      coordBuf[coordLen++] = x
      coordBuf[coordLen++] = y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      pts++
    }
    if (pts >= 2) {
      ensurePolys()
      lenBuf[polyCount] = pts
      const b = polyCount * 4
      boxBuf[b] = minX
      boxBuf[b + 1] = minY
      boxBuf[b + 2] = maxX
      boxBuf[b + 3] = maxY
      polyCount++
    } else if (pts === 1) {
      coordLen -= 2
    }
  }

  const processLine = (chunk, start, end) => {
    if (end <= start) return
    if (chunk.charCodeAt(start) !== 60) return // '<'
    const c1 = chunk.charCodeAt(start + 1)
    if (c1 === 112) {
      // 'p': <polyline or <path
      const c2 = chunk.charCodeAt(start + 2)
      if (c2 === 111) recordPolyline(chunk, start, end)
      else if (c2 === 97) recordPath(chunk, start, end)
    } else if (c1 === 103) {
      // 'g': <g ...>
      openGroup(chunk, start, end)
    } else if (c1 === 47) {
      // '/': </g> or </svg>
      if (chunk.charCodeAt(start + 2) === 103) closeGroup()
    } else if (c1 === 115 && chunk.charCodeAt(start + 2) === 118) {
      // 'sv': <svg ...>
      initFromSvgTag(chunk, start, end)
    }
  }

  /**
   * Paint the recorded items covering `[mmX0, mmY0, mmX1, mmY1]` into an
   * `OffscreenCanvas` of `pxW × pxH` pixels and return an `ImageBitmap`.
   */
  const paintRegion = (mmX0, mmY0, mmX1, mmY1, pxW, pxH) => {
    if (!(wMm > 0 && hMm > 0 && pxW > 0 && pxH > 0)) return null
    const regW = mmX1 - mmX0
    const regH = mmY1 - mmY0
    if (!(regW > 0 && regH > 0)) return null
    const canvas = new OffscreenCanvas(pxW, pxH)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(pxW / regW, pxH / regH)
    ctx.translate(-mmX0, -mmY0)

    for (const item of items) {
      const s = item.style
      if (s.stroke) ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.lineWidth
      ctx.lineCap = s.lineCap
      ctx.lineJoin = s.lineJoin
      if (item.kind === 'path') {
        if (typeof Path2D === 'undefined') continue
        const p = new Path2D(item.d)
        if (item.fill && item.fill !== 'none') {
          ctx.fillStyle = item.fill
          ctx.fill(p, 'evenodd')
        }
        if (s.stroke) ctx.stroke(p)
      } else {
        if (!s.stroke) continue
        const pad = s.lineWidth
        const bx0 = mmX0 - pad
        const by0 = mmY0 - pad
        const bx1 = mmX1 + pad
        const by1 = mmY1 + pad
        const { coords, lengths, bounds } = item
        let cIdx = 0
        let batch = 0
        ctx.beginPath()
        for (let p = 0; p < lengths.length; p++) {
          const pts = lengths[p]
          const b = p * 4
          if (bounds[b + 2] >= bx0 && bounds[b] <= bx1 && bounds[b + 3] >= by0 && bounds[b + 1] <= by1) {
            ctx.moveTo(coords[cIdx], coords[cIdx + 1])
            let k = cIdx + 2
            const end = cIdx + pts * 2
            while (k < end) {
              ctx.lineTo(coords[k], coords[k + 1])
              k += 2
            }
            if (++batch >= STROKE_BATCH) {
              ctx.stroke()
              ctx.beginPath()
              batch = 0
            }
          }
          cIdx += pts * 2
        }
        if (batch > 0) ctx.stroke()
      }
    }

    if (typeof canvas.transferToImageBitmap !== 'function') return null
    return canvas.transferToImageBitmap()
  }

  return {
    feed(text) {
      const chunk = carry ? carry + text : text
      const lastNl = chunk.lastIndexOf('\n')
      if (lastNl < 0) {
        carry = chunk
        return
      }
      carry = chunk.slice(lastNl + 1)
      let pos = 0
      while (pos <= lastNl) {
        const nl = chunk.indexOf('\n', pos)
        const end = nl < 0 || nl > lastNl ? lastNl : nl
        processLine(chunk, pos, end)
        if (nl < 0 || nl >= lastNl) break
        pos = nl + 1
      }
    },
    finish() {
      if (carry) {
        processLine(carry, 0, carry.length)
        carry = ''
      }
      flushGroupStrokes()
      // Release temporary builder buffers once finished
      coordBuf = new Float32Array(0)
      lenBuf = new Uint32Array(0)
      boxBuf = new Float32Array(0)
      if (!(wMm > 0 && hMm > 0)) return null
      const scale = Math.min(MAX_OVERVIEW_PX / Math.max(wMm, hMm), TARGET_OVERVIEW_PX_PER_MM)
      const pxW = Math.max(1, Math.round(wMm * scale))
      const pxH = Math.max(1, Math.round(hMm * scale))
      return paintRegion(0, 0, wMm, hMm, pxW, pxH)
    },
    renderViewport({ mmX0, mmY0, mmX1, mmY1, pxW, pxH }) {
      const scale = Math.min(1, MAX_VIEWPORT_PX / Math.max(pxW, pxH, 1))
      const w = Math.max(1, Math.round(pxW * scale))
      const h = Math.max(1, Math.round(pxH * scale))
      return paintRegion(mmX0, mmY0, mmX1, mmY1, w, h)
    },
  }
}
