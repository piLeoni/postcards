// `npm test`: the page's edits to a profile script.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  jsValue,
  outputComment,
  outputOf,
  outputUnit,
  setOutputComment,
  setOutputKeys,
  setTitle,
  shapeOf,
  styleOf,
  titleOf,
} from './doc.js'

const SCRIPT = `title("Parks")
output({ width: "6in", height: "4in", scale: "1:8000", lat: 37.8, lng: -122.2 })

// The parks.
const parks = areas.polygons(features.tiles("parks"))
draw({ id: "ring", from: lines.rings(parks), stroke: "solid" })
`

test('a literal output is read, a computed or missing one is told apart', () => {
  assert.deepEqual(outputOf(SCRIPT), { kind: 'literal', value: { width: '6in', height: '4in', scale: '1:8000', lat: 37.8, lng: -122.2 } })
  assert.deepEqual(outputOf('const w = "6in"\noutput({ width: w })'), { kind: 'computed' })
  assert.deepEqual(outputOf('for (const s of [1]) output({ scale: s })'), { kind: 'computed' })
  assert.deepEqual(outputOf('draw()'), { kind: 'missing' })
  assert.equal(outputOf('output({ width: '), null)
  assert.deepEqual(outputOf('output({ bearing: -12, padding: ["1mm", "2mm"], slices: { columns: 2 } })').value, {
    bearing: -12,
    padding: ['1mm', '2mm'],
    slices: { columns: 2 },
  })
})

test('changing a key rewrites its value and nothing else', () => {
  const moved = setOutputKeys(SCRIPT, { lat: 40.123456789, lng: -74 })
  assert.equal(moved, SCRIPT.replace('lat: 37.8, lng: -122.2', 'lat: 40.1234568, lng: -74'))
  const scaled = setOutputKeys(SCRIPT, { scale: '1:5000' })
  assert.ok(scaled.includes('scale: "1:5000"'))
  assert.equal(scaled.split('\n').length, SCRIPT.split('\n').length)
})

test('adding and removing keys keeps the commas right', () => {
  // Small growth stays on the line; past a line of editor it is reflowed.
  const small = setOutputKeys(SCRIPT, { bearing: 15 })
  assert.ok(small.includes('lng: -122.2, bearing: 15 })'), small)
  const added = setOutputKeys(SCRIPT, { bearing: 15, padding: ['1mm', '2mm'] })
  assert.deepEqual(outputOf(added).value, { width: '6in', height: '4in', scale: '1:8000', lat: 37.8, lng: -122.2, bearing: 15, padding: ['1mm', '2mm'] })
  assert.ok(added.includes('  bearing: 15,\n'), added)
  const removed = setOutputKeys(added, { width: null, height: null, padding: null })
  assert.deepEqual(Object.keys(outputOf(removed).value), ['scale', 'lat', 'lng', 'bearing'])
  assert.ok(removed.includes('  scale: "1:8000",\n'), removed)
  const slices = setOutputKeys(SCRIPT, { slices: { columns: 2, rows: 1, gutter: '5mm' } })
  assert.deepEqual(outputOf(slices).value.slices, { columns: 2, rows: 1, gutter: '5mm' })
})

test('a multi-line output grows by a line in its own indent', () => {
  const text = 'output({\n  width: "6in",\n  height: "4in",\n})\n'
  assert.equal(setOutputKeys(text, { lat: 1 }), 'output({\n  width: "6in",\n  height: "4in",\n  lat: 1,\n})\n')
  const bare = 'output({\n  width: "6in"\n})\n'
  assert.equal(setOutputKeys(bare, { lat: 1 }), 'output({\n  width: "6in",\n  lat: 1\n})\n')
})

test('a script without an output gets one after its title; a computed one is left alone', () => {
  const text = 'title("A")\ndraw()\n'
  assert.equal(setOutputKeys(text, { lat: 1, lng: 2 }), 'title("A")\noutput({ lat: 1, lng: 2 })\ndraw()\n')
  assert.equal(setOutputKeys('draw()\n', { lat: 1 }), 'output({ lat: 1 })\ndraw()\n')
  const computed = 'const s = "1:5000"\noutput({ scale: s })\n'
  assert.equal(setOutputKeys(computed, { lat: 1 }), computed)
})

test('units and the terrain comment live on the output', () => {
  assert.equal(outputUnit(SCRIPT, 'width'), 'in')
  assert.equal(outputUnit(setOutputKeys(SCRIPT, { slices: { gutter: ['5mm', '1cm'] } }), 'slices.gutter'), 'mm')
  assert.equal(outputUnit(SCRIPT, 'padding'), null)
  const noted = setOutputComment(SCRIPT, 'scale', 'terrain 1.22 × 0.813 km')
  assert.ok(noted.split('\n')[1].endsWith('})   // terrain 1.22 × 0.813 km'), noted)
  assert.equal(outputComment(noted, 'scale'), 'terrain 1.22 × 0.813 km')
  const again = setOutputComment(noted, 'scale', 'terrain 2 × 1 km')
  assert.equal(outputComment(again, 'scale'), 'terrain 2 × 1 km')
  assert.equal(again.split('\n').length, SCRIPT.split('\n').length)
})

test('the title is read and written as a literal', () => {
  assert.equal(titleOf(SCRIPT), 'Parks')
  assert.equal(titleOf(setTitle(SCRIPT, 'Green "things"')), 'Green "things"')
  assert.equal(setTitle('draw()\n', 'New'), 'title("New")\ndraw()\n')
  assert.ok(!setTitle(SCRIPT, '').includes('title('))
  assert.equal(titleOf('const t = "x"\ntitle(t)'), null)
})

test('style and shape leave out the title and the output', () => {
  const elsewhere = setTitle(setOutputKeys(SCRIPT, { lat: 1, lng: 2, scale: '1:4000' }), 'Other')
  assert.equal(styleOf(elsewhere), styleOf(SCRIPT))
  assert.ok(!styleOf(SCRIPT).includes('output('))
  assert.equal(shapeOf(elsewhere), shapeOf(SCRIPT))
  assert.equal(shapeOf(SCRIPT).split('\n').length, SCRIPT.split('\n').length, 'lines are kept')
  assert.notEqual(shapeOf(SCRIPT.replace('"solid"', '"dash"')), shapeOf(SCRIPT))
  const noted = setOutputComment(SCRIPT, 'scale', 'terrain 1 × 1 km')
  assert.equal(styleOf(noted), styleOf(SCRIPT))
})

test('a one-line output that grows past a line is reflowed one key per line', () => {
  const text = 'output({ width: "6in", scale: "1:8000", lat: 37.8771145, lng: -122.256196 })\n'
  const grown = setOutputKeys(text, { bearing: -34, tileZoom: 14 })
  assert.equal(
    grown,
    `output({
  width: "6in",
  scale: "1:8000",
  lat: 37.8771145,
  lng: -122.256196,
  bearing: -34,
  tileZoom: 14,
})
`,
  )
  assert.deepEqual(outputOf(grown).value.tileZoom, 14)
  // Small growth stays on the line.
  const small = setOutputKeys('output({ width: "6in", height: "4in" })\n', { lat: 1 })
  assert.equal(small, 'output({ width: "6in", height: "4in", lat: 1 })\n')
  // Comments beside keys survive the reflow.
  const noted = setOutputKeys(
    'output({ width: "6in", height: "4in", scale: "1:8000", lat: 37.8771145, lng: -122.256196 })   // note\n',
    { tileZoom: 14 },
  )
  assert.ok(noted.includes('  width: "6in",\n'), noted)
  assert.ok(noted.includes('  tileZoom: 14,'), noted)
  assert.ok(noted.includes('   note\n'), noted)
  assert.ok(noted.includes('  lat: 37.8771145,\n'), noted)
})

test('the preset outputs are multi-line with an explicit tileZoom', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const dir = join(import.meta.dirname, '..', 'presets')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(join(dir, f), 'utf8')
    const o = outputOf(text)
    assert.equal(o.kind, 'literal', f)
    assert.equal(o.value.tileZoom, 14, f)
    assert.ok(text.includes('output({\n  '), `${f}: output is multi-line`)
  }
})

test('values are written as the script would write them', () => {
  assert.equal(jsValue({ columns: 2, gutter: ['1mm', '2mm'], 'odd-key': true }), '{ columns: 2, gutter: ["1mm", "2mm"], "odd-key": true }')
})
