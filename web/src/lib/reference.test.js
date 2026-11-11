// `npm test`: the docs' reference (`src/docs/library-reference.json`) is what
// `scripts/build-reference.mjs` makes of drawland.d.ts today, so the page
// cannot drift from the library it describes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OUTPUT, referenceText } from '../../scripts/build-reference.mjs'

test('library-reference.json is up to date with drawland.d.ts', () => {
  const committed = readFileSync(OUTPUT, 'utf8')
  assert.ok(committed === referenceText(), 'library-reference.json is stale: run node web/scripts/build-reference.mjs')
})
