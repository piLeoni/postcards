/**
 * Edits to the document text that keep the rest of it as written: comments,
 * alignment and flow maps survive, which a YAML round trip would not promise.
 */

/** Seven decimals of a degree is about a centimetre: plenty for a card. */
const round7 = (v) => Math.round(v * 1e7) / 1e7

/**
 * Set keys of the top-level `card:` block, e.g. `{ lat, lng }` after the card
 * is dragged. A key already there is rewritten in place; a missing one is
 * added at the end of the block, indented like its siblings.
 */
export function setCardKeys(text, patch) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^card\s*:\s*$/.test(l))
  if (start < 0) return text
  let end = start + 1
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === '')) end++
  // Trailing blank lines belong to the gap before the next block.
  while (end > start + 1 && lines[end - 1].trim() === '') end--
  const indent = lines.slice(start + 1, end).find((l) => l.trim())?.match(/^\s+/)?.[0] ?? '  '

  for (const [key, raw] of Object.entries(patch)) {
    const value = typeof raw === 'number' ? round7(raw) : raw
    const re = new RegExp(`^(\\s+${key}\\s*:\\s*)([^#]*?)(\\s*(#.*)?)$`)
    const at = lines.slice(start + 1, end).findIndex((l) => re.test(l))
    if (at >= 0) {
      lines[start + 1 + at] = lines[start + 1 + at].replace(re, `$1${value}$3`)
    } else {
      lines.splice(end, 0, `${indent}${key}: ${value}`)
      end++
    }
  }
  return lines.join('\n')
}
