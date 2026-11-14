/**
 * Search over the documentation's sections. A section is a heading and the
 * text under it, up to the next heading: `{ id, title, parent, text }`, read
 * from the page itself (`DocSearch.jsx`), so what is searched is what is
 * written, with no index to keep beside it.
 *
 * Every word of the query must appear in a section's title or text. A match
 * in the title counts far more than one in the text, so `scatter` finds the
 * reference entry `areas.scatter` before the paragraphs that mention it.
 */

/** The query's words, lowercased. */
export const wordsOf = (query) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** How well `section` answers `words`: 0 when a word is missing from it. */
export function score(section, words) {
  const title = section.title.toLowerCase()
  const text = section.text.toLowerCase()
  const whole = words.join(' ')
  let s = 0
  for (const w of words) {
    const inTitle = title.includes(w)
    const inText = text.includes(w)
    if (!inTitle && !inText) return 0
    if (inTitle) s += 20
    if (inText) s += Math.min(count(text, w), 5)
  }
  // The title is the query (`features.tiles`), or its last part (`tiles`).
  if (title === whole || title.endsWith(`.${whole}`)) s += 100
  else if (title.startsWith(whole)) s += 50
  return s
}

function count(text, word) {
  let n = 0
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + word.length)) n++
  return n
}

/**
 * A line of the text around the first word's first match, split for
 * highlighting: `{ before, match, after }`, or the text's start when the
 * words are only in the title.
 */
export function snippet(text, words, width = 120) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  for (const w of words) {
    const at = lower.indexOf(w)
    if (at === -1) continue
    const start = Math.max(0, at - Math.floor((width - w.length) / 2))
    const end = Math.min(flat.length, start + width)
    return {
      before: (start > 0 ? '…' : '') + flat.slice(start, at),
      match: flat.slice(at, at + w.length),
      after: flat.slice(at + w.length, end) + (end < flat.length ? '…' : ''),
    }
  }
  const end = Math.min(flat.length, width)
  return { before: flat.slice(0, end) + (end < flat.length ? '…' : ''), match: '', after: '' }
}

/** The best `limit` sections for `query`, best first, each with its snippet. */
export function searchDocs(sections, query, limit = 20) {
  const words = wordsOf(query)
  if (!words.length) return []
  return sections
    .map((section, order) => ({ section, order, s: score(section, words) }))
    .filter((r) => r.s > 0)
    // Equal scores keep the page's order.
    .sort((a, b) => b.s - a.s || a.order - b.order)
    .slice(0, limit)
    .map(({ section }) => ({ ...section, snippet: snippet(section.text, words) }))
}
