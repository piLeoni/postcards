import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dxfLayerName, svgToDxf } from './dxf.js'
import { prepareDownloads } from './download.js'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
<g id="roads" style="stroke:black;fill:none"><polyline points="0,0 10,10 20,0"/></g>
<g id="water" style="stroke:blue;fill:none"><path d="M0 0 L10 0 L10 10 Z"/></g>
</svg>`

describe('svgToDxf', () => {
  it('writes one DXF layer per group with Y flipped', () => {
    const { dxf, layerCount, lineCount } = svgToDxf(SVG)
    assert.equal(layerCount, 2)
    assert.equal(lineCount, 2)
    assert.ok(dxf.includes('AC1009'))
    assert.match(dxf, /\n2\nroads\n/)
    assert.match(dxf, /\n2\nwater\n/)
    // (10,10) in SVG → (10,40) in DXF
    assert.match(dxf, /\n10\n10\n20\n40\n/)
    assert.ok(dxf.trimEnd().endsWith('EOF'))
  })

  it('sanitizes and dedupes layer names', () => {
    const used = new Set()
    assert.equal(dxfLayerName('a:b', used), 'a_b')
    assert.equal(dxfLayerName('a;b', used), 'a_b_2')
    assert.equal(dxfLayerName('', used), 'LAYER')
  })

  it('exports via prepareDownloads', async () => {
    const drawing = { svg: new Blob([SVG]) }
    const one = await prepareDownloads(drawing, { basename: 'x', format: 'dxf', perLayer: false })
    assert.deepEqual(one.map((f) => f.name), ['x.dxf'])
    const split = await prepareDownloads(drawing, { basename: 'x', format: 'dxf', perLayer: true })
    assert.deepEqual(split.map((f) => f.name), ['x-roads.dxf', 'x-water.dxf'])
  })
})
