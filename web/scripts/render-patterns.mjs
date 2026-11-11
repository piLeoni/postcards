#!/usr/bin/env node
// The docs' pattern catalogue: one swatch per penfill pattern, drawn by the
// CLI so each is what `drawland map` writes.
//
//   node web/scripts/render-patterns.mjs
//
// One profile, no map data: a sheet of square cells, each filled with one
// pattern and drawn as its own group (`p-<file>`). The SVG is then cut by
// group into `web/public/docs/patterns/<file>.svg` (viewBox cropped to the
// cell), and `web/src/docs/pattern-swatches.json` lists them for `Patterns.jsx`.
//
// The patterns come from the `Pattern` union in `drawland.d.ts`, so a new
// pattern gets a swatch (in the "other" group until it is placed in GROUPS).
// A pattern that makes the CLI fail is left out and reported.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dts = readFileSync(join(root, 'crates/drawland-script/drawland.d.ts'), 'utf8')
const bin = join(root, 'target/release/drawland')
const outDir = join(root, 'web/public/docs/patterns')
const jsonOut = join(root, 'web/src/docs/pattern-swatches.json')

/** The string members of `type <name> = | "a" | "b" …`. */
function union(name) {
  const m = dts.match(new RegExp(`type ${name} =([\\s\\S]*?)\\n\\n`))
  if (!m) throw new Error(`no type ${name} in drawland.d.ts`)
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}
const PATTERNS = union('Pattern')
const PAT_NAMES = union('PatName')

/** Two names for one pattern: the second is shown under the first. */
const ALIASES = { wave_grid: 'wave-grid' }

/** The catalogue's sections, in order, and the patterns in each. */
const GROUPS = [
  ['lines', 'Lines and hatches', [
    'lines', 'zigzag', 'rectilinear', 'grid', 'triangles', 'fill', 'concentric', 'offsets', 'spiral', 'sunburst', 'pat',
  ]],
  ['dots', 'Dots and stipple', ['dots', 'stipple', 'stipple-noise', 'stipple-edge', 'scribble']],
  ['waves', 'Waves and water', [
    'waves', 'curl-waves', 'flow-waves', 'scallop-waves', 'wave-grid', 'ripples', 'swells', 'eddies', 'lily-pads',
  ]],
  ['nature', 'Nature', ['grass', 'fluid-grass', 'tufts', 'sprouts', 'twigs', 'vines', 'canopy', 'doodle-trees', 'wood']],
  ['stone', 'Stone and soil', [
    // rock
    'granite', 'granite-x', 'diorite', 'gabbro', 'diabase', 'ophitic', 'dacite', 'feldspar', 'hornblende',
    'amphibolite', 'gneiss', 'marble', 'lava', 'ferrous',
    // sediment
    'breccia', 'breccia-blobs', 'conglomerate', 'conglomerate-flat', 'arena', 'beds', 'laminae', 'coal', 'bentonite',
    'diatom', 'coquina', 'shards', 'drift', 'brackets', 'masonry',
    // stones on the ground
    'gravel', 'gravel-clipped', 'fine-gravel', 'pebbles', 'pebble-scatter', 'stone-cluster', 'coarse-stone',
    'mixed-rocks', 'terrazzo',
    // soil
    'sandy-soil', 'silty-soil', 'clay-soil', 'loose-soil', 'compacted-soil', 'grainy-soil', 'chalky-soil',
    'gravelly-soil', 'pebbled-soil', 'layered-soil', 'debris-soil', 'mulch', 'mulched-soil', 'organic-topsoil',
    'cracked-earth', 'dry-cracked-soil', 'cracks', 'cell-net', 'erosion-lines',
  ]],
  ['geometric', 'Geometric and space-filling', ['hilbert', 'honeycomb', 'truchet', 'scales', 'chess']],
  ['special', 'Special', ['clouds', 'isoline-blobs', 'isoline-stack', 'isoline-stack-hatched', 'growth', 'solid', 'none']],
  ['pat', 'pat hatches', []], // filled below: one swatch per `PatName`
]

/**
 * Options beyond `pattern`, where the default needs one or reads badly in a
 * 22 mm cell. `centre` is filled in per cell (the cell's middle).
 */
const OPTIONS = {
  // needs one
  pat: { name: 'BRICK' },
  chess: { spacing: '2mm' }, // the square is `spacing` (`cell` is not read)
  spiral: { centre: true },
  sunburst: { centre: true },
  // the default spacing (0.5mm) inks these nearly solid with a 0.2mm pen
  'compacted-soil': { spacing: '4mm' },
  'layered-soil': { spacing: '1.5mm' },
  'mulched-soil': { spacing: '3mm' },
  mulch: { spacing: '1mm' },
  'sandy-soil': { spacing: '1mm' },
  'chalky-soil': { spacing: '1mm' },
  'grainy-soil': { spacing: '1mm' },
  'silty-soil': { spacing: '1.5mm' },
  'gravelly-soil': { spacing: '0.8mm' },
  'cracked-earth': { spacing: '1mm' },
  'dry-cracked-soil': { spacing: '1mm' },
  gravel: { spacing: '1mm' },
  'stone-cluster': { spacing: '1mm' },
  terrazzo: { spacing: '1.5mm' },
  hornblende: { spacing: '1mm' },
  feldspar: { spacing: '1mm' },
  dacite: { spacing: '1mm' },
  diatom: { spacing: '0.8mm' },
  ferrous: { spacing: '0.8mm' },
  fill: { spacing: '0.8mm' },
  truchet: { spacing: '1mm' },
  triangles: { spacing: '1mm' },
  honeycomb: { spacing: '0.8mm' },
  'lily-pads': { spacing: '1mm' },
  grass: { spacing: '1.6mm' },
  'curl-waves': { spacing: '1mm' },
  'pebbled-soil': { spacing: '1mm' },
  'erosion-lines': { spacing: '1mm' },
  // a crown, a puff or a tree is `spacing` across: give it room in a 22mm cell
  'doodle-trees': { spacing: '4mm' },
  'isoline-stack': { spacing: '3mm' },
  'isoline-stack-hatched': { spacing: '3mm' },
  'isoline-blobs': { spacing: '6mm', contour: '0.4mm', threshold: 0.1, coverage: 1 },
}
/** `pat` hatches too dense at the default size. */
const PAT_OPTIONS = { EARTH: { spacing: '1.5mm' }, GRATE: { spacing: '1mm' } }

const CELL = 22 // mm, a swatch's side
const GAP = 4 // mm between cells
const COLUMNS = 10

// Every entry: { file, name, options, group, alias? }
const entries = []
const placed = new Set()
for (const [group, , names] of GROUPS) {
  for (const name of names) {
    if (!PATTERNS.includes(name)) continue
    placed.add(name)
    entries.push({ file: name, name, options: { ...(OPTIONS[name] ?? {}) }, group })
  }
}
for (const n of PAT_NAMES) entries.push({ file: `pat-${n}`, name: 'pat', options: { name: n, ...(PAT_OPTIONS[n] ?? {}) }, group: 'pat' })
for (const [alias, of] of Object.entries(ALIASES)) {
  placed.add(alias)
  const e = entries.find((x) => x.name === of)
  if (e) e.alias = alias
}
for (const name of PATTERNS) {
  if (!placed.has(name)) entries.push({ file: name, name, options: { ...(OPTIONS[name] ?? {}) }, group: 'other' })
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
    if (opts.centre === true) opts.centre = [x, y]
    out.push(
      `draw({ id: "p-${e.file}", from: fills.fill({ in: areas.shape({ at: [${x}, ${y}], rect: [${CELL}, ${CELL}] }), pattern: "${e.name}"${literal(opts)} }), stroke: { width: "0.2mm" } })`,
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

/**
 * Patterns drawn in the sheet's first row. `wood` lays its grain levels out
 * from the page origin, not the area's, so far down the page it comes out
 * empty (a penfill bug): kept near the top it draws.
 */
const FIRST = ['wood']
const sheetOrder = (l) => [...l.filter((e) => FIRST.includes(e.file)), ...l.filter((e) => !FIRST.includes(e.file))]

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

const groupTitles = Object.fromEntries(GROUPS.map(([id, title]) => [id, title]))
groupTitles.other = 'Other'
const json = list.map((e) => {
  const o = { ...e.options }
  if (o.centre === true) o.centre = '[x, y]' // shown as written: the area's middle
  const row = { name: e.name, file: e.file, group: e.group, groupTitle: groupTitles[e.group], options: o }
  if (e.alias) row.alias = e.alias
  return row
})
writeFileSync(jsonOut, JSON.stringify(json, null, 1) + '\n')
rmSync(tmp, { recursive: true, force: true })

console.log(`${list.length} swatches, ${(bytes / 1024).toFixed(0)} KB, in ${outDir}`)
if (failed.length) console.log(`failed: ${failed.map((f) => `${f.file} (${f.error})`).join('; ')}`)
if (empty.length) console.log(`drew nothing: ${empty.join(', ')}`)
