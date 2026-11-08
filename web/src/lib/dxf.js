/**
 * SVG → DXF (AutoCAD R12 ASCII) for CAD / laser / plotter tools.
 *
 * Reuses the G-code geometry parser, so the same strokes are exported (solid
 * fill groups with `stroke:none` are skipped). Each top-level SVG group becomes
 * a DXF layer; units are millimetres with Y flipped so the drawing is upright.
 */
import { extractSvgGeometry } from './gcode.js'

/** DXF layer names cannot contain `<>/\":;?*|=\``; keep them short and ASCII. */
export function dxfLayerName(id, used = new Set()) {
  let base =
    String(id ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 31) || 'LAYER'
  let name = base
  for (let i = 2; used.has(name.toUpperCase()); i++) name = `${base}_${i}`
  used.add(name.toUpperCase())
  return name
}

const num = (n) => {
  const r = Number(n.toFixed(4))
  return Object.is(r, -0) ? '0' : String(r)
}

/**
 * @param {string} svgText
 * @returns {{ dxf: string, layerCount: number, lineCount: number }}
 */
export function svgToDxf(svgText) {
  const { widthMm, heightMm, layers } = extractSvgGeometry(svgText)
  const used = new Set()
  const named = layers.map((l) => ({ name: dxfLayerName(l.id, used), lines: l.lines }))
  const out = []
  const g = (code, value) => out.push(String(code), String(value))

  // Header: R12, millimetres, extents.
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 4)
  g(9, '$MEASUREMENT')
  g(70, 1)
  g(9, '$EXTMIN')
  g(10, 0)
  g(20, 0)
  g(30, 0)
  g(9, '$EXTMAX')
  g(10, num(widthMm))
  g(20, num(heightMm))
  g(30, 0)
  g(0, 'ENDSEC')

  // Layer table.
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, named.length + 1)
  const layerEntry = (name, color) => {
    g(0, 'LAYER')
    g(2, name)
    g(70, 0)
    g(62, color)
    g(6, 'CONTINUOUS')
  }
  layerEntry('0', 7)
  named.forEach((l, i) => layerEntry(l.name, (i % 6) + 1))
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  // Entities: one POLYLINE per stroke.
  let lineCount = 0
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const { name, lines } of named) {
    for (const pts of lines) {
      if (pts.length < 2) continue
      const first = pts[0]
      const last = pts[pts.length - 1]
      const closed = pts.length > 2 && first[0] === last[0] && first[1] === last[1]
      const verts = closed ? pts.slice(0, -1) : pts
      g(0, 'POLYLINE')
      g(8, name)
      g(66, 1)
      g(10, 0)
      g(20, 0)
      g(30, 0)
      g(70, closed ? 1 : 0)
      for (const [x, y] of verts) {
        g(0, 'VERTEX')
        g(8, name)
        g(10, num(x))
        g(20, num(heightMm - y))
        g(30, 0)
      }
      g(0, 'SEQEND')
      g(8, name)
      lineCount++
    }
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')

  return { dxf: out.join('\n') + '\n', layerCount: named.length, lineCount }
}
