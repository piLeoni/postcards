import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchDocs, snippet } from './docSearch.js'

const SECTIONS = [
  { id: 'concepts-fills', title: 'Fills', parent: 'Concepts', text: 'A fill hatches an area; scatter places marks in it.' },
  { id: 'ref-areas-scatter', title: 'areas.scatter', parent: 'Areas', text: 'Marks placed over the areas.' },
  { id: 'ref-features-tiles', title: 'features.tiles', parent: 'Features', text: "Features from OpenFreeMap's vector tiles." },
  { id: 'tutorial-01', title: '1 Hello, map', parent: 'Tutorial', text: 'const bldg = features.tiles("buildings")' },
]

test('a title match comes before the text that mentions it', () => {
  const ids = searchDocs(SECTIONS, 'scatter').map((r) => r.id)
  assert.deepEqual(ids, ['ref-areas-scatter', 'concepts-fills'])
})

test('a qualified name finds its reference entry first', () => {
  assert.equal(searchDocs(SECTIONS, 'features.tiles')[0].id, 'ref-features-tiles')
})

test('every word must appear', () => {
  assert.deepEqual(searchDocs(SECTIONS, 'scatter tiles'), [])
  assert.deepEqual(searchDocs(SECTIONS, 'hello buildings').map((r) => r.id), ['tutorial-01'])
})

test('an empty query finds nothing', () => {
  assert.deepEqual(searchDocs(SECTIONS, '   '), [])
})

test('the snippet is cut around the match', () => {
  const s = snippet('x '.repeat(200) + 'needle' + ' y'.repeat(200), ['needle'], 40)
  assert.equal(s.match, 'needle')
  assert.ok(s.before.startsWith('…') && s.after.endsWith('…'))
  assert.ok((s.before + s.match + s.after).length <= 42)
})
