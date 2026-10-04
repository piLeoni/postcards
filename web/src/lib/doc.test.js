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
  const added = setOutputKeys(SCRIPT, { bearing: 15, padding: ['1mm', '2mm'] })
  assert.ok(added.includes('lng: -122.2, bearing: 15, padding: ["1mm", "2mm"] })'), added)
  assert.deepEqual(outputOf(added).value.padding, ['1mm', '2mm'])
  const removed = setOutputKeys(added, { width: null, padding: null })
  assert.deepEqual(Object.keys(outputOf(removed).value), ['height', 'scale', 'lat', 'lng', 'bearing'])
  assert.ok(removed.includes('output({ height: "4in"'), removed)
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

test('values are written as the script would write them', () => {
  assert.equal(jsValue({ columns: 2, gutter: ['1mm', '2mm'], 'odd-key': true }), '{ columns: 2, gutter: ["1mm", "2mm"], "odd-key": true }')
})
