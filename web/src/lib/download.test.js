import assert from 'node:assert/strict'
import test from 'node:test'
import {
  joinNameParts,
  pxPerMmFromDpi,
  roundSvgNumbers,
  sanitizeBasename,
  shortHexId,
  splitSvgByTopLevelGroups,
  suggestExportBasename,
} from './download.js'

const MINI = `<?xml version='1.0' encoding='utf-8'?>
<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10">
<style>svg { stroke: black; }</style>
<g id="roads">
<polyline points="0,0 1.23456,2.34567" />
</g>
<g id="parks">
<polyline points="3,3 4,4" />
</g>
</svg>
`

test('sanitizeBasename drops unsafe characters and trailing hyphens', () => {
  assert.equal(sanitizeBasename('  my/map-  '), 'my-map')
  assert.equal(sanitizeBasename('drawland-a1b2c3-'), 'drawland-a1b2c3')
  assert.equal(sanitizeBasename(''), 'drawland')
})

test('joinNameParts only places hyphens between non-empty particles', () => {
  assert.equal(joinNameParts('drawland', 'a1b2c3d4', '', 'r1c1'), 'drawland-a1b2c3d4-r1c1')
  assert.equal(joinNameParts('drawland-a1b2c3d4-', '-roads-'), 'drawland-a1b2c3d4-roads')
})

test('suggestExportBasename uses 8 hex chars and never ends with a hyphen', async () => {
  const hex = await shortHexId('output({ lat: 45, lng: 9 })')
  assert.match(hex, /^[0-9a-f]{8}$/)
  const name = await suggestExportBasename('output({ lat: 45, lng: 9 })')
  assert.match(name, /^drawland-[0-9a-f]{8}$/)
  assert.ok(!name.endsWith('-'))
})

test('pxPerMmFromDpi converts inches to millimetres', () => {
  assert.ok(Math.abs(pxPerMmFromDpi(254) - 10) < 0.001)
})

test('roundSvgNumbers trims fractional digits', () => {
  const out = roundSvgNumbers(MINI, 2)
  assert.match(out, /1\.23,2\.35/)
  assert.doesNotMatch(out, /1\.23456/)
})

test('splitSvgByTopLevelGroups keeps header and splits by id', () => {
  const parts = splitSvgByTopLevelGroups(MINI)
  assert.equal(parts.length, 2)
  assert.equal(parts[0][0], 'roads')
  assert.equal(parts[1][0], 'parks')
  assert.match(parts[0][1], /^<\?xml/)
  assert.match(parts[0][1], /<g id="roads">/)
  assert.match(parts[0][1], /<\/svg>\s*$/)
  assert.doesNotMatch(parts[0][1], /id="parks"/)
})
