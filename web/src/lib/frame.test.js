import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sheetsOf } from './frame.js'

test('sheetsOf cuts like the engine: margins, and overlapping tiles of one size', () => {
  const plain = sheetsOf({ width_mm: 300, height_mm: 100, columns: 3, rows: 1, padding_x_mm: 5, padding_y_mm: 5 })
  assert.deepEqual(plain[1].at, [100, 0, 200, 100])
  // No gutter: the padding only round the outside, the drawings meet at the cuts.
  assert.deepEqual(plain[0].inner, [5, 5, 100, 95])
  assert.deepEqual(plain[1].inner, [100, 5, 200, 95])
  const gutter = sheetsOf({ width_mm: 300, height_mm: 100, columns: 3, rows: 1, padding_x_mm: 5, padding_y_mm: 5, gutter_x_mm: 4, gutter_y_mm: 4 })
  assert.deepEqual(gutter[1].inner, [102, 5, 198, 95])
  // Three sheets 20 mm over each other: each (300 + 40) / 3 wide, the last ending at the edge.
  const tiles = sheetsOf({ width_mm: 300, height_mm: 100, columns: 3, rows: 1, padding_x_mm: 5, padding_y_mm: 5, overlap_x_mm: 20, overlap_y_mm: 20 })
  const w = 340 / 3
  for (const s of tiles) assert.ok(Math.abs(s.at[2] - s.at[0] - w) < 1e-9)
  assert.ok(Math.abs(tiles[0].at[2] - tiles[1].at[0] - 20) < 1e-9)
  assert.ok(Math.abs(tiles[2].at[2] - 300) < 1e-9)
  // One row: no overlap down.
  assert.deepEqual([tiles[0].at[1], tiles[0].at[3]], [0, 100])
})
