import test from 'node:test'
import assert from 'node:assert/strict'
import { STROKE_FONT_FETCH_URL, strokeFontFetchUrl } from './strokeFontUrls.js'

test('catalog stroke font URLs load from same-origin /fonts/', () => {
  const gitlab =
    'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSReadability.svg'
  assert.equal(strokeFontFetchUrl(gitlab), '/fonts/EMSReadability.svg')
  assert.equal(Object.keys(STROKE_FONT_FETCH_URL).length, 13)
})

test('unknown stroke font URLs are fetched as given', () => {
  assert.equal(strokeFontFetchUrl('https://example.com/MyFont.svg'), 'https://example.com/MyFont.svg')
})
