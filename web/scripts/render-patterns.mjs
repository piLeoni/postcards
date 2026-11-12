#!/usr/bin/env node
// The docs' pattern pages: a swatch for every material, a few for each
// generator to show what its options do, and one for every symbol scatter
// can place, all drawn by the CLI so each is what `drawland map` writes.
//
//   node web/scripts/render-patterns.mjs
//
// What there is comes from penfill's catalogue itself (its `describe()`,
// written to `web/src/docs/catalog.json` for the page), so a new material,
// generator or mark gets its swatch without touching this file. Only the
// generator variants below are chosen by hand: they are the page's examples.
//
// One profile, no map data: a sheet of square cells, each filled and drawn
// as its own group (`p-<file>`). The SVG is then cut by group into
// `web/public/docs/patterns/<file>.svg`, and `web/src/docs/pattern-swatches.json`
// lists them.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const bin = join(root, 'target/release/drawland')
const outDir = join(root, 'web/public/docs/patterns')
const jsonOut = join(root, 'web/src/docs/pattern-swatches.json')
const catalogOut = join(root, 'web/src/docs/catalog.json')

// The catalogue, from penfill (a sibling checkout, as the build expects).
const penfill = resolve(root, '../penfill')
const catalog = JSON.parse(
  execFileSync('cargo', ['run', '-q', '--release', '--example', 'catalog_sheet', '--', '--json'], { cwd: penfill, encoding: 'utf8', maxBuffer: 1 << 26 }),
)
writeFileSync(catalogOut, JSON.stringify(catalog, null, 1) + '\n')

/**
 * The generator variants the page shows: each an option set that makes one
 * idea visible. Lengths in mm, as a profile writes them.
 */
const STAR = [[[0, -1.2], [0.35, -0.35], [1.2, 0], [0.35, 0.35], [0, 1.2], [-0.35, 0.35], [-1.2, 0], [-0.35, -0.35], [0, -1.2]]]
const VARIANTS = {
  hatch: [{}, { cross: 2 }, { cross: 3, spacing: 0.9 }, { join: true, angle: 45 }, { dash: [1.2, 0.6], dash_jitter: 0.6 }, { wobble: 0.8, spacing: 0.9 }, { vary: 1, spacing: 0.9 }, { density: 'edge', contrast: 1 }, { cross: 3, density: 'gradient', contrast: 1, spacing: 0.9 }],
  scatter: [{}, { arrange: 'hex', mark: 0.3 }, { density: 'gradient', contrast: 1, spacing: 0.6, mark: 0.3 }, { motif: 'tree', rotate: 'upright', mark: 2, spacing: 2.6, vary: 0.35, jitter: 0.5 }, { motif: 'conifer', rotate: 'upright', arrange: 'rows', mark: 1.8, spacing: 2.4 }, { motif: 'ring', mark: 1, spacing: 1.8, vary: 0.7, jitter: 0.6 }, { motif: 'shard', mark: 1.2, spacing: 1.8, vary: 0.6, density: 'noise', contrast: 0.9 }, { motif: STAR, rotate: 'random', spacing: 3.5 }],
  cells: [{}, { vary: 1, spacing: 2.4 }, { style: 'net', spacing: 3 }, { style: 'cracks', spacing: 3.5 }, { inner: 'mixed', vary: 0.9, spacing: 2.4 }, { style: 'net', inner: 'dots', spacing: 3.5 }, { density: 'noise', contrast: 0.9 }],
  tile: ['brick', 'herringbone', 'basket', 'parquet', 'setts', 'flagstones', 'tiles', 'hexagons', 'stairs', 'grate', 'chess'].map((motif) => ({ motif })).concat([{ pat: 'ANSI37' }, { motif: STAR, size: [3, 3], stagger: 0.5 }]),
  waves: [{}, { shape: 'scallop' }, { shape: 'zigzag' }, { shape: 'curl', spacing: 2 }, { shape: 'flow' }, { cross: 2, spacing: 1.6 }],
  rings: [{}, { from: 'edges' }, { spiral: true }],
  scribble: [{ layers: 1 }, {}, { layers: 3, loose: 0.8 }],
}

const CELL = 22 // mm, a swatch's side
const GAP = 4 // mm between cells
const COLUMNS = 10

const entries = []
for (const m of catalog.materials) {
  entries.push({ file: `m-${m.name}`, pattern: m.name, options: {}, kind: 'material', name: m.name, group: m.group })
}
for (const g of catalog.generators) {
  const variants = VARIANTS[g.name] ?? [{}]
  variants.forEach((options, i) => entries.push({ file: `g-${g.name}-${i}`, pattern: g.name, options, kind: 'generator', name: g.name }))
}
const marks = catalog.generators.find((g) => g.name === 'scatter')?.options.find((o) => o.key === 'motif')?.kind.values ?? []
for (const mark of marks) {
  entries.push({ file: `k-${mark}`, pattern: 'scatter', options: { motif: mark, mark: 3, spacing: 5.5, rotate: 'upright', edge: 'inside' }, kind: 'mark', name: mark })
}

/** The cell's middle, in page mm. */
function cellAt(i) {
  const col = i % COLUMNS
  const row = Math.floor(i / COLUMNS)
  return [GAP + col * (CELL + GAP) + CELL / 2, GAP + row * (CELL + GAP) + CELL / 2]
}

/** Options as a JS object literal, as a profile writes them. */
function literal(o) {
  const parts = Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  return parts.length ? `, ${parts.join(', ')}` : ''
}

function profile(list) {
  const rows = Math.ceil(list.length / COLUMNS)
  const width = GAP + COLUMNS * (CELL + GAP)
  const height = GAP + rows * (CELL + GAP)
  const out = [
    `// Written by web/scripts/render-patterns.mjs: one cell per pattern.`,
    `output({ lat: 0, lng: 0, width: "${width}mm", height: "${height}mm", scale: "1:10000" })`,
  ]
  list.forEach((e, i) => {
    const [x, y] = (e.cell = cellAt(i))
    const opts = { ...e.options }
    out.push(
      `draw({ id: "p-${e.file}", from: fills.fill({ in: areas.shape({ at: [${x}, ${y}], rect: [${CELL}, ${CELL}] }), pattern: "${e.pattern}"${literal(opts)} }), stroke: { width: "0.2mm" } })`,
    )
  })
  return out.join('\n') + '\n'
}

const tmp = mkdtempSync(join(tmpdir(), 'drawland-patterns-'))

/** Render `list`: `{ svg }`, or `{ error }` with the CLI's complaint. */
function render(list, tag) {
  const js = join(tmp, `${tag}.js`)
  const svg = join(tmp, `${tag}.svg`)
  writeFileSync(js, profile(list))
  try {
    execFileSync(bin, ['map', js, '-o', svg, '--decimals', '2', '--cache', join(tmp, 'cache')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
    })
    return { svg: readFileSync(svg, 'utf8') }
  } catch (err) {
    const log = `${err.stdout ?? ''}${err.stderr ?? ''}`
    const msg = (log.match(/✗ def [^\n]*/)?.[0] ?? log.trim().split('\n').pop() ?? '').replace(/ \(known:.*/, '')
    return { error: msg || String(err) }
  }
}

if (!existsSync(bin)) {
  console.error(`no ${bin}: cargo build --release -p drawland-cli`)
  process.exit(1)
}

const sheetOrder = (l) => l

let list = sheetOrder(entries)
let result = render(list, 'all')
const failed = []
if (result.error) {
  // Find the culprits one by one, then draw the rest together.
  console.warn(`the sheet failed (${result.error}); trying each pattern alone`)
  list = []
  entries.forEach((e, i) => {
    const one = render([e], `one-${i}`)
    if (one.error) failed.push({ file: e.file, error: one.error })
    else list.push(e)
  })
  list = sheetOrder(list)
  result = render(list, 'all')
  if (result.error) throw new Error(`the sheet still fails: ${result.error}`)
}

const svg = result.svg
const style = svg.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? ''
/** Every top-level group, by id. */
const groups = new Map()
for (const m of svg.matchAll(/<g id="p-([^"]+)"[^>]*>[\s\S]*?<\/g>|<g id="p-([^"]+)"[^>]*\/>/g)) {
  groups.set(m[1] ?? m[2], m[0])
}

/**
 * Swatches are pictures, not plots: the polylines are thinned (points closer
 * to the line than `TOLERANCE` dropped), moved to the cell's own origin,
 * rounded to hundredths and written as one relative path, which is a tenth
 * of the size. Anything else (`solid`'s filled path) is kept as it is.
 */
const TOLERANCE = 0.02 // mm

/** Douglas–Peucker on [x, y] pairs. */
function thin(pts) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dx * (ay - py) - dy * (ax - px)) / len
      if (d > worst) [worst, at] = [d, i]
    }
    if (worst > TOLERANCE) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Hundredths as the shortest SVG number: `.5`, `-.05`, `12`. */
function num(h) {
  const s = (Math.abs(h) / 100).toFixed(2).replace(/\.?0+$/, '').replace(/^0\./, '.')
  return (h < 0 ? '-' : '') + (s === '' ? '0' : s)
}

/** Numbers joined the short way: a minus or a leading `.` after a decimal needs no space. */
function joinNums(nums) {
  let out = ''
  for (const n of nums) {
    if (out && !(n[0] === '-' || (n[0] === '.' && /\.\d*$/.test(out)))) out += ' '
    out += n
  }
  return out
}

/** A group's contents, as a swatch's: polylines → one path, the rest translated. */
function swatchBody(g, ox, oy) {
  const nums = []
  let cx = 0
  let cy = 0
  for (const m of g.matchAll(/<polyline points="([^"]*)"/g)) {
    const raw = m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number))
    const pts = thin(raw).map(([x, y]) => [Math.round((x - ox) * 100), Math.round((y - oy) * 100)])
    const ops = ['m', num(pts[0][0] - cx), num(pts[0][1] - cy)]
    let [px, py] = pts[0]
    if (pts.length === 1) ops.push('0', '0')
    for (const [x, y] of pts.slice(1)) {
      ops.push(num(x - px), num(y - py))
      ;[px, py] = [x, y]
    }
    ;[cx, cy] = [px, py]
    nums.push(ops)
  }
  const d = nums.map((ops) => ops[0] + joinNums(ops.slice(1))).join('')
  const style = g.match(/^<g[^>]*?style="([^"]*)"/)?.[1] ?? ''
  const rest = g
    .replace(/^<g[^>]*>/, '')
    .replace(/<\/g>$/, '')
    .replace(/<polyline [^>]*\/>/g, '')
    .trim()
  let body = ''
  if (d) body += `<path d="${d}" fill="none"/>`
  if (rest) body += `<g transform="translate(${-ox} ${-oy})">${rest}</g>`
  return `<g style="${style}">${body}</g>`
}

mkdirSync(outDir, { recursive: true })
for (const f of readdirSync(outDir)) if (f.endsWith('.svg')) rmSync(join(outDir, f))
const empty = []
let bytes = 0
const kept = new Set(list.map((e) => e.file))
list = entries.filter((e) => kept.has(e.file))
for (const e of list) {
  const [cx, cy] = e.cell
  const [ox, oy] = [cx - CELL / 2, cy - CELL / 2]
  const g = groups.get(e.file) ?? ''
  if (!/<(polyline|path|line|polygon|circle|rect)\b/.test(g)) empty.push(e.file)
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}mm" height="${CELL}mm" viewBox="0 0 ${CELL} ${CELL}">` +
    `${style}\n${swatchBody(g, ox, oy)}\n</svg>\n`
  bytes += doc.length
  writeFileSync(join(outDir, `${e.file}.svg`), doc)
}

const json = list.map((e) => ({ file: e.file, kind: e.kind, name: e.name, pattern: e.pattern, options: e.options, ...(e.group ? { group: e.group } : {}) }))
writeFileSync(jsonOut, JSON.stringify(json, null, 1) + '\n')
rmSync(tmp, { recursive: true, force: true })

console.log(`${list.length} swatches, ${(bytes / 1024).toFixed(0)} KB, in ${outDir}`)
if (failed.length) console.log(`failed: ${failed.map((f) => `${f.file} (${f.error})`).join('; ')}`)
if (empty.length) console.log(`drew nothing: ${empty.join(', ')}`)
