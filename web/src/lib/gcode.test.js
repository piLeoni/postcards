import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareDownloads } from './download.js'
import {
  extractSvgGeometry,
  formatGcodeTemplate,
  HBOT_MARLIN_TOML,
  parseGwriteToml,
  svgToGcode,
} from './gcode.js'

const SAMPLE_SVG = `<?xml version='1.0' encoding='utf-8'?>
<svg xmlns="http://www.w3.org/2000/svg" width="152.4mm" height="101.6mm" viewBox="0 0 152.4 101.6">
<style>svg { stroke: black; }</style>
<g id="background" style="stroke:none;fill:#ffffff;fill-rule:evenodd">
<path d="M0 0L152.4 0L152.4 101.6L0 101.6 Z" fill="#ffffff" />
</g>
<g id="lines_roads">
<polyline points="0,0 10,20 30,40" />
</g>
<g id="lines_water">
<polyline points="5,5 15,25" />
</g>
</svg>
`

test('parseGwriteToml parses H-Bot Marlin profile and default_values', () => {
  const { profileName, profile, defaultValues } = parseGwriteToml(HBOT_MARLIN_TOML)
  assert.equal(profileName, 'hbot_marlin')
  assert.equal(profile.unit, 'mm')
  assert.equal(profile.vertical_flip, true)
  assert.equal(profile.bed_width, 200)
  assert.equal(profile.bed_height, 140)
  assert.equal(defaultValues.z_draw, 4)
  assert.equal(defaultValues.z_travel, 7)
  assert.equal(defaultValues.z_safe, 10)
  assert.equal(defaultValues.xy_draw_feed, 30000)
  assert.equal(defaultValues.junction_j, 0.013)
})

test('formatGcodeTemplate formats Python specifiers and escaped braces', () => {
  const out = formatGcodeTemplate('G0 X{x:.3f} Y{y:.3f} ; {{layer {layer_index1:d}: {layer_name}}}', {
    x: 12.3456,
    y: -0.00001,
    layer_index1: 2,
    layer_name: 'lines_roads',
  })
  assert.equal(out, 'G0 X12.346 Y0.000 ; {layer 2: lines_roads}')
})

test('extractSvgGeometry skips stroke:none fill groups and reads polylines', () => {
  const { widthMm, heightMm, layers } = extractSvgGeometry(SAMPLE_SVG)
  assert.equal(widthMm, 152.4)
  assert.equal(heightMm, 101.6)
  assert.equal(layers.length, 2)
  assert.equal(layers[0].id, 'lines_roads')
  assert.deepEqual(layers[0].lines[0], [
    [0, 0],
    [10, 20],
    [30, 40],
  ])
})

test('svgToGcode applies vertical_flip around bed_height (140mm) like svg2gcode.sh', () => {
  const res = svgToGcode(SAMPLE_SVG, { toml: HBOT_MARLIN_TOML })
  assert.equal(res.layerCount, 2)
  assert.equal(res.lineCount, 2)
  assert.equal(res.segmentCount, 5)
  // SVG (0, 0) -> X0.000 Y140.000
  assert.match(res.gcode, /G0 X0\.000 Y140\.000 F30000/)
  // SVG (10, 20) -> X10.000 Y120.000
  assert.match(res.gcode, /G1 X10\.000 Y120\.000/)
  // SVG (30, 40) -> X30.000 Y100.000
  assert.match(res.gcode, /G1 X30\.000 Y100\.000/)
  // Line end lifts to z_travel = 7
  assert.match(res.gcode, /G1 Z7 F20000/)
  // Document end parks at X0 Y140
  assert.match(res.gcode, /G0 X0 Y140 F30000/)
  assert.equal(res.bounds.outOfBounds, false)
  assert.equal(res.bounds.minX, 0)
  assert.equal(res.bounds.maxX, 30)
  assert.equal(res.bounds.minY, 100)
  assert.equal(res.bounds.maxY, 140)
})

test('svgToGcode detects outOfBounds and scales into bed when fitMarginMm is set', () => {
  const oversizeSvg = `<?xml version='1.0' encoding='utf-8'?>
<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200">
<style>svg { stroke: black; }</style>
<g id="roads"><polyline points="0,0 300,200" /></g>
</svg>`
  const raw = svgToGcode(oversizeSvg, { toml: HBOT_MARLIN_TOML })
  assert.equal(raw.bounds.outOfBounds, true)

  const fitted = svgToGcode(oversizeSvg, { toml: HBOT_MARLIN_TOML, fitMarginMm: 5 })
  assert.equal(fitted.bounds.outOfBounds, false)
  assert.ok(fitted.bounds.minX >= 5 - 1e-6)
  assert.ok(fitted.bounds.maxX <= 195 + 1e-6)
  assert.ok(fitted.bounds.minY >= 5 - 1e-6)
  assert.ok(fitted.bounds.maxY <= 135 + 1e-6)
})

test('prepareDownloads builds .gco files and supports perLayer', async () => {
  const drawing = {
    svg: new Blob([SAMPLE_SVG], { type: 'image/svg+xml' }),
    slices: [],
  }
  const single = await prepareDownloads(drawing, {
    basename: 'plot',
    format: 'gcode',
    perLayer: false,
    gcodeToml: HBOT_MARLIN_TOML,
    gcodeExt: 'gco',
  })
  assert.equal(single.length, 1)
  assert.equal(single[0].name, 'plot.gco')

  const perLayer = await prepareDownloads(drawing, {
    basename: 'plot',
    format: 'gcode',
    perLayer: true,
    gcodeToml: HBOT_MARLIN_TOML,
    gcodeExt: 'gco',
  })
  assert.equal(perLayer.length, 2)
  assert.equal(perLayer[0].name, 'plot-lines-roads.gco')
  assert.equal(perLayer[1].name, 'plot-lines-water.gco')
})
