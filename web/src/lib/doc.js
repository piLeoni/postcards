/**
 * Edits to the document text that keep the rest of it as written: comments,
 * alignment and flow maps survive, which a YAML round trip would not promise.
 */

/** Seven decimals of a degree is about a centimetre: plenty for a card. */
const round7 = (v) => Math.round(v * 1e7) / 1e7

/** The `card:` block's lines: `[start, end)` after the header, and the indent of its keys. */
function cardBlock(lines) {
  const start = lines.findIndex((l) => /^card\s*:\s*$/.test(l))
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === '')) end++
  // Trailing blank lines belong to the gap before the next block.
  while (end > start + 1 && lines[end - 1].trim() === '') end--
  const indent = lines.slice(start + 1, end).find((l) => l.trim())?.match(/^\s+/)?.[0] ?? '  '
  return { start, end, indent }
}

const UNITS = { mm: 'mm', cm: 'cm', in: 'in', inch: 'in', inches: 'in', '"': 'in' }

/**
 * The unit a length of the `card:` block is written in: `'padding'` for
 * `padding: 0.25in`, `'slices.padding'` for the gutter inside `slices:`
 * (flow or block). `null` when the key is not there or carries no unit.
 */
export function cardUnit(text, key) {
  const lines = text.split('\n')
  const b = cardBlock(lines)
  if (!b) return null
  const [outer, inner] = key.split('.')
  const at = lines.slice(b.start + 1, b.end).findIndex((l) => new RegExp(`^${b.indent}${outer}\\s*:`).test(l))
  if (at < 0) return null
  const i = b.start + 1 + at
  let under = 0
  while (i + 1 + under < b.end && lines[i + 1 + under].match(/^\s*/)[0].length > b.indent.length) under++
  let value = lines.slice(i, i + 1 + under).join(' ').replace(/#.*$/gm, '')
  value = value.slice(value.indexOf(':') + 1)
  if (inner) value = value.match(new RegExp(`\\b${inner}\\s*:\\s*([^,}\\n]*)`))?.[1] ?? ''
  const unit = value.trim().match(/^[\d.]+\s*([a-z"]+)/i)?.[1]?.toLowerCase()
  return UNITS[unit] ?? null
}

/**
 * Set keys of the top-level `card:` block, e.g. `{ lat, lng }` after the card
 * is dragged. A key already there is rewritten in place (a block value under
 * it goes, the new value is written inline); a missing one is added at the
 * end of the block, indented like its siblings. `null` removes the key.
 */
export function setCardKeys(text, patch) {
  const lines = text.split('\n')
  const b = cardBlock(lines)
  if (!b) return text
  const { start, indent } = b
  let { end } = b

  for (const [key, raw] of Object.entries(patch)) {
    const value = typeof raw === 'number' ? round7(raw) : raw
    const re = new RegExp(`^(${indent}${key}\\s*:\\s*)([^#]*?)(\\s*(#.*)?)$`)
    const at = lines.slice(start + 1, end).findIndex((l) => re.test(l))
    if (at >= 0) {
      const i = start + 1 + at
      // The lines indented under the key are its block value.
      let under = 0
      while (i + 1 + under < end && lines[i + 1 + under].match(/^\s*/)[0].length > indent.length && lines[i + 1 + under].trim()) under++
      if (value === null || value === undefined) {
        lines.splice(i, 1 + under)
        end -= 1 + under
      } else {
        lines.splice(i, 1 + under, lines[i].replace(re, `$1${value}$3`))
        end -= under
      }
    } else if (value !== null && value !== undefined) {
      lines.splice(end, 0, `${indent}${key}: ${value}`)
      end++
    }
  }
  return lines.join('\n')
}
