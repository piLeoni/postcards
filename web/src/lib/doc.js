/**
 * Edits to the profile script that keep the rest of it as written. The page
 * owns two calls, and only while they are literal: `title("…")` and
 * `output({ … })` at the top level. Dragging the output rewrites the values
 * in that object and leaves every other byte of the script alone; an output
 * the script computes is the script's, and the page only shows it.
 */
import { parse } from 'acorn'

/** Seven decimals of a degree is about a centimetre: plenty for an output. */
const round7 = (v) => Math.round(v * 1e7) / 1e7

/** The program and its line comments, or `null` while the text does not parse. */
function program(text) {
  const comments = []
  try {
    const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'script', onComment: comments })
    return { ast, comments }
  } catch {
    return null
  }
}

/** Every node under `node`, depth first. */
function* nodes(node) {
  if (!node || typeof node.type !== 'string') return
  yield node
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const v of value) yield* nodes(v)
    else if (value && typeof value.type === 'string') yield* nodes(value)
  }
}

const isCall = (node, name) =>
  node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name

/** The top-level statements that are a plain `name(…)` call. */
const statements = (ast, name) => ast.body.filter((s) => s.type === 'ExpressionStatement' && isCall(s.expression, name))

const NOT = Symbol('not literal')

const keyOf = (p) =>
  p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method || p.shorthand
    ? null
    : p.key.type === 'Identifier'
      ? p.key.name
      : p.key.type === 'Literal'
        ? String(p.key.value)
        : null

/** The value a node writes literally (numbers, strings, lists, objects of them), or `NOT`. */
function literal(node) {
  switch (node?.type) {
    case 'Literal':
      return node.regex || node.bigint ? NOT : node.value
    case 'TemplateLiteral':
      return node.expressions.length ? NOT : node.quasis[0].value.cooked
    case 'UnaryExpression':
      return node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number'
        ? -node.argument.value
        : NOT
    case 'ArrayExpression': {
      const out = []
      for (const e of node.elements) {
        const v = e && e.type !== 'SpreadElement' ? literal(e) : NOT
        if (v === NOT) return NOT
        out.push(v)
      }
      return out
    }
    case 'ObjectExpression': {
      const out = {}
      for (const p of node.properties) {
        const k = keyOf(p)
        const v = k === null ? NOT : literal(p.value)
        if (v === NOT) return NOT
        out[k] = v
      }
      return out
    }
    default:
      return NOT
  }
}

/**
 * The script's `name({…})` call: `{ kind: 'literal', value, statement, object }`
 * for one top-level call with a literal object, `{ kind: 'computed' }` when the
 * script calls it any other way, `{ kind: 'missing' }` when it does not call
 * it, `null` while the text does not parse.
 */
function call(text, name, parsed = program(text)) {
  if (!parsed) return null
  const top = statements(parsed.ast, name)
  const all = [...nodes(parsed.ast)].filter((n) => isCall(n, name))
  if (!all.length) return { kind: 'missing' }
  if (top.length !== 1 || all.length !== 1) return { kind: 'computed' }
  const statement = top[0]
  const object = statement.expression.arguments[0]
  const value = statement.expression.arguments.length === 1 ? literal(object) : NOT
  return value === NOT ? { kind: 'computed' } : { kind: 'literal', value, statement, object, parsed }
}

/**
 * Where the output comes from: `{ kind: 'literal', value }` (the page edits it),
 * `{ kind: 'computed' }` (the script's own), `{ kind: 'missing' }`, or `null`
 * while the script does not parse.
 */
export function outputOf(text) {
  const c = call(text, 'output')
  return c && (c.kind === 'literal' ? { kind: 'literal', value: c.value } : { kind: c.kind })
}

const IDENT = /^[A-Za-z_$][\w$]*$/

/** A value as the script would write it. */
export function jsValue(v) {
  if (typeof v === 'number') return String(round7(v))
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jsValue).join(', ')}]`
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null)
    return entries.length ? `{ ${entries.map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${jsValue(x)}`).join(', ')} }` : '{}'
  }
  return String(v)
}

const lineStart = (text, at) => text.lastIndexOf('\n', at - 1) + 1
const lineEnd = (text, at) => {
  const i = text.indexOf('\n', at)
  return i < 0 ? text.length : i
}

/** One key of the literal `output({…})` set (or removed, for `null`). */
function setKey(text, key, value) {
  const c = call(text, 'output')
  if (!c || c.kind === 'computed') return text
  if (c.kind === 'missing') {
    if (value === null || value === undefined) return text
    // After the title, or first.
    const t = call(text, 'title')
    const at = t?.kind === 'literal' ? lineEnd(text, t.statement.end) + 1 : 0
    const line = `output({ ${IDENT.test(key) ? key : JSON.stringify(key)}: ${jsValue(value)} })\n`
    return at > text.length ? `${text}\n${line}` : text.slice(0, at) + line + text.slice(at)
  }
  const props = c.object.properties
  const i = props.findIndex((p) => keyOf(p) === key)
  if (i >= 0) {
    const p = props[i]
    if (value !== null && value !== undefined) return text.slice(0, p.value.start) + jsValue(value) + text.slice(p.value.end)
    // Removed with the comma that tied it to a neighbour.
    if (props.length === 1) return text.slice(0, c.object.start) + '{}' + text.slice(c.object.end)
    if (i < props.length - 1) return text.slice(0, p.start) + text.slice(props[i + 1].start)
    return text.slice(0, props[i - 1].end) + text.slice(p.end)
  }
  if (value === null || value === undefined) return text
  const entry = `${IDENT.test(key) ? key : JSON.stringify(key)}: ${jsValue(value)}`
  if (!props.length) return text.slice(0, c.object.start) + `{ ${entry} }` + text.slice(c.object.end)
  const last = props[props.length - 1]
  const tail = text.slice(last.end, c.object.end - 1)
  const comma = tail.match(/^\s*,/)
  const multiline = text.slice(c.object.start, last.start).includes('\n')
  if (multiline) {
    const indent = text.slice(lineStart(text, last.start), last.start).match(/^\s*/)[0]
    const at = comma ? last.end + comma[0].length : last.end
    return text.slice(0, at) + `${comma ? '' : ','}\n${indent}${entry}${comma ? ',' : ''}` + text.slice(at)
  }
  return text.slice(0, last.end) + `, ${entry}` + text.slice(last.end)
}

/**
 * Set keys of the literal `output({…})`, e.g. `{ lat, lng }` after the output
 * is dragged: values are plain JS (numbers, strings, lists, objects), `null`
 * removes a key. A script without `output(…)` gets one; one that computes its
 * output is left alone.
 */
export function setOutputKeys(text, patch) {
  let out = text
  for (const [key, value] of Object.entries(patch)) out = setKey(out, key, value)
  return out
}

const UNITS = {
  mm: 'mm', cm: 'cm', in: 'in', inch: 'in', inches: 'in', '"': 'in',
  m: 'm', km: 'km', mi: 'mi', mile: 'mi', miles: 'mi', ft: 'ft', feet: 'ft',
}

/**
 * The unit a length of the output is written in: `'padding'` for
 * `padding: "0.25in"`, `'slices.gutter'` for the gutter inside `slices`.
 * `null` when the key is not there or carries no unit.
 */
export function outputUnit(text, key) {
  const o = outputOf(text)
  if (o?.kind !== 'literal') return null
  let v = key.split('.').reduce((at, k) => (at && typeof at === 'object' ? at[k] : undefined), o.value)
  if (Array.isArray(v)) v = v[0]
  const unit = typeof v === 'string' ? v.trim().match(/^[\d.]+\s*([a-z"]+)/i)?.[1]?.toLowerCase() : null
  return UNITS[unit] ?? null
}

/** The output's `// comment`, on the line where `key` is written. */
export function outputComment(text, key) {
  const c = call(text, 'output')
  if (c?.kind !== 'literal') return null
  const p = c.object.properties.find((q) => keyOf(q) === key)
  if (!p) return null
  const end = lineEnd(text, p.end)
  const comment = c.parsed.comments.find((m) => m.type === 'Line' && m.start >= p.end && m.end <= end)
  return comment ? comment.value.trim() : null
}

/**
 * Put `// comment` at the end of the line where the output's `key` is
 * written, in place of a line comment already there; nothing happens when
 * the key is not written literally.
 */
export function setOutputComment(text, key, comment) {
  const c = call(text, 'output')
  if (c?.kind !== 'literal') return text
  const p = c.object.properties.find((q) => keyOf(q) === key)
  if (!p) return text
  const end = lineEnd(text, p.end)
  const old = c.parsed.comments.find((m) => m.type === 'Line' && m.start >= p.end && m.end <= end)
  if (old) return text.slice(0, old.start) + `// ${comment}` + text.slice(old.end)
  return text.slice(0, end).trimEnd() + `   // ${comment}` + text.slice(end)
}

/** The script's literal `title("…")`, or `null`. */
export function titleOf(text) {
  const t = call(text, 'title')
  return t?.kind === 'literal' && typeof t.value === 'string' ? t.value : null
}

/** Write `title("…")` in place, or as the first line; a blank title removes it. */
export function setTitle(text, title) {
  const t = call(text, 'title')
  const blank = !title?.trim()
  if (t?.kind === 'literal') {
    if (!blank) return text.slice(0, t.object.start) + JSON.stringify(title) + text.slice(t.object.end)
    const start = lineStart(text, t.statement.start)
    let end = lineEnd(text, t.statement.end) + 1
    if (start === 0 && text.slice(end).startsWith('\n')) end++
    return text.slice(0, start) + text.slice(end)
  }
  if (blank || t?.kind === 'computed') return text
  return `title(${JSON.stringify(title)})\n${text}`
}

/** `[start, end)` of each top-level literal `title(…)` / `output(…)` statement, with its line comment. */
function ownedRanges(text, parsed) {
  return ['title', 'output']
    .map((name) => call(text, name, parsed))
    .filter((c) => c?.kind === 'literal')
    .map((c) => {
      const end = lineEnd(text, c.statement.end)
      const comment = c.parsed.comments.find((m) => m.type === 'Line' && m.start >= c.statement.end && m.end <= end)
      return [c.statement.start, comment ? comment.end : c.statement.end]
    })
    .sort((a, b) => b[0] - a[0])
}

/**
 * The script without its literal title and output: what a preset brings. Two
 * scripts with the same style differ only in name, place and paper.
 */
export function styleOf(text) {
  const parsed = program(text)
  if (!parsed) return text.trim()
  let out = text
  for (const [a, b] of ownedRanges(text, parsed)) out = out.slice(0, a) + out.slice(b)
  return out.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The script with its literal title and output blanked, lines kept: two
 * scripts with the same shape build the same graph, its script lines
 * included. The key the page caches graphs under.
 */
export function shapeOf(text) {
  const parsed = program(text)
  if (!parsed) return text
  let out = text
  for (const [a, b] of ownedRanges(text, parsed)) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, '') + out.slice(b)
  return out
}
