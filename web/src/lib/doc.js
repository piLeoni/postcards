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

const UNITS = {
  mm: 'mm', cm: 'cm', in: 'in', inch: 'in', inches: 'in', '"': 'in',
  m: 'm', km: 'km', mi: 'mi', mile: 'mi', miles: 'mi', ft: 'ft', feet: 'ft',
}

/**
 * The unit a length of the `card:` block is written in: `'padding'` for
 * `padding: 0.25in`, `'slices.gutter'` for the gutter inside `slices:`
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
  if (inner) value = value.match(new RegExp(`\\b${inner}\\s*:\\s*(\\[[^\\]]*\\]|[^,}\\n]*)`))?.[1] ?? ''
  const unit = value.trim().match(/^\[?\s*[\d.]+\s*([a-z"]+)/i)?.[1]?.toLowerCase()
  return UNITS[unit] ?? null
}

/**
 * Put `# comment` at the end of a `card:` key's line, in place of any comment
 * already there; nothing happens when the key is not written.
 */
export function setCardComment(text, key, comment) {
  const lines = text.split('\n')
  const b = cardBlock(lines)
  if (!b) return text
  const re = new RegExp(`^(${b.indent}${key}\\s*:\\s*[^#]*?)\\s*(#.*)?$`)
  const at = lines.slice(b.start + 1, b.end).findIndex((l) => re.test(l))
  if (at < 0) return text
  const i = b.start + 1 + at
  lines[i] = lines[i].replace(re, (_, head) => `${head}   # ${comment}`)
  return lines.join('\n')
}

/** The top-level `title:` line. */
const TITLE = /^title\s*:/

/** Written bare when YAML would read it back unchanged as a string; quoted otherwise. */
const PLAIN = /^\p{L}[\p{L}\p{N} ·,.()'&/-]*[\p{L}\p{N}.)]$/u
const RESERVED = /^(true|false|yes|no|on|off|null|y|n)$/i
const yamlString = (s) => (PLAIN.test(s) && !RESERVED.test(s) ? s : JSON.stringify(s))

/** The document's `title:`, or `null` when it has none. */
export function titleOf(text) {
  const line = text.split('\n').find((l) => TITLE.test(l))
  if (!line) return null
  const v = line.replace(TITLE, '').trim()
  if (v.startsWith('"')) {
    const m = v.match(/^"((?:[^"\\]|\\.)*)"/)
    try {
      return m ? JSON.parse(`"${m[1]}"`) : v
    } catch {
      return m[1]
    }
  }
  if (v.startsWith("'")) {
    const m = v.match(/^'((?:[^']|'')*)'/)
    return m ? m[1].replace(/''/g, "'") : v
  }
  return v.replace(/\s+#.*$/, '')
}

/** Write `title:` in place, or as the first line; a blank title removes it. */
export function setTitle(text, title) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => TITLE.test(l))
  const line = title?.trim() ? `title: ${yamlString(title)}` : null
  if (at >= 0) {
    if (line) lines[at] = line
    else lines.splice(at, at === 0 && lines[1]?.trim() === '' ? 2 : 1)
  } else if (line) {
    lines.unshift(line, '')
  }
  return lines.join('\n')
}

/**
 * The document without its title and its `card:` block: what a preset
 * brings. Two documents with the same style differ only in name, place and
 * paper.
 */
export function styleOf(text) {
  const lines = text.split('\n').filter((l) => !TITLE.test(l))
  const b = cardBlock(lines)
  if (b) lines.splice(b.start, b.end - b.start)
  else {
    const at = lines.findIndex((l) => /^card\s*:/.test(l))
    if (at >= 0) lines.splice(at, 1)
  }
  return lines.map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
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
