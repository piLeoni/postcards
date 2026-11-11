#!/usr/bin/env node
// The docs' reference, read from the library's description: every namespace
// (`features`, `areas`, …), every top-level function, and every type a profile
// fills in, with their JSDoc, written to `web/src/docs/library-reference.json`.
//
//   node web/scripts/build-reference.mjs
//
// `npm test` (`src/lib/reference.test.js`) regenerates it in memory and fails
// when the committed file is stale, so the reference cannot drift from
// `drawland.d.ts`. Order is source order; nothing here depends on the clock.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = import.meta.dirname
export const LIBRARY = resolve(here, '..', '..', 'crates', 'drawland-script', 'drawland.d.ts')
export const OUTPUT = resolve(here, '..', 'src', 'docs', 'library-reference.json')

const printer = ts.createPrinter({ removeComments: true })

/** A node as one line: printed without its comments, whitespace collapsed. */
function show(node, source) {
  return flat(printer.printNode(ts.EmitHint.Unspecified, node, source))
}

/** Whitespace collapsed, a literal's trailing `;` dropped. */
function flat(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/; \}/g, ' }')
    .replace(/\[ /g, '[')
    .replace(/ \]/g, ']')
    .replace(/\{ +\}/g, '{}')
    .replace(/\( +/g, '(')
    .replace(/ +\)/g, ')')
    .trim()
    .replace(/^\| /, '')
}

/**
 * The `/** … *\/` comments in the trivia before a node, as written. (Read
 * from the text: the parser's own JSDoc skips a comment on the line of the
 * token before it, as in `{ /** … *\/ exteriorOnly?: boolean }`.)
 */
function jsDocs(node, source) {
  return source.text.slice(node.getFullStart(), node.getStart(source)).match(/\/\*\*[\s\S]*?\*\//g) ?? []
}

/**
 * A comment's text as blocks: paragraphs (`p`), code indented two spaces or
 * more (`code`), and `- ` lists (`list`).
 */
function blocks(comment) {
  const lines = comment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
  // A one-line comment keeps its padding (`/** text */`).
  if (lines.length === 1) lines[0] = lines[0].trim()
  const out = []
  let prose = []
  let code = []
  let list = null
  const flush = () => {
    if (prose.length) out.push({ kind: 'p', text: prose.join(' ') })
    if (code.length) {
      const indent = Math.min(...code.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
      out.push({ kind: 'code', text: code.map((l) => l.slice(indent)).join('\n').trimEnd() })
    }
    if (list) out.push({ kind: 'list', items: list })
    prose = []
    code = []
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
    } else if (/^ {2,}\S/.test(line) && !list) {
      if (prose.length) flush()
      code.push(line)
    } else if (/^- /.test(line)) {
      if (prose.length || code.length) flush()
      list = list ?? []
      list.push(line.slice(2).trim())
    } else if (list && /^ +\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`
    } else {
      if (code.length || list) flush()
      prose.push(line.trim())
    }
  }
  flush()
  return out
}

/** Names of the types a node mentions (`TypeReference`s), first-seen order. */
function referenced(node) {
  const names = []
  const walk = (n) => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
      if (!names.includes(n.typeName.text)) names.push(n.typeName.text)
    }
    n.forEachChild(walk)
  }
  walk(node)
  return names
}

function nameOf(node) {
  if (!node.name) return ''
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  return node.name.getText()
}

/** One parameter: its name, type as written, and the options an inline `{ … }` type lists. */
function parameter(p, ctx) {
  const out = {
    name: p.name.getText(ctx.source),
    optional: Boolean(p.questionToken),
    rest: Boolean(p.dotDotDotToken),
    type: p.type ? show(p.type, ctx.source) : 'unknown',
  }
  const inline = p.type ? literalMembers(p.type, ctx) : []
  if (inline.length) out.properties = inline
  return out
}

/** The properties of the type literals a type is made of (`{ … }`, `A & { … }`, `"x" | { … }`). */
function literalMembers(type, ctx) {
  if (ts.isTypeLiteralNode(type)) return type.members.map((m) => member(m, ctx))
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) return type.types.flatMap((t) => literalMembers(t, ctx))
  if (ts.isParenthesizedTypeNode(type)) return literalMembers(type.type, ctx)
  return []
}

function doc(node, ctx, where) {
  const comments = jsDocs(node, ctx.source)
  if (comments.length > 1) ctx.warnings.push(`${where}: ${comments.length} JSDoc blocks; the last is used`)
  return comments.length ? blocks(comments[comments.length - 1]) : []
}

function signature(node, ctx) {
  const params = node.parameters.map((p) => parameter(p, ctx))
  const text = `(${node.parameters.map((p) => show(p, ctx.source)).join(', ')})`
  const returns = node.type ? show(node.type, ctx.source) : 'void'
  return { params, text, returns }
}

/** A member of a type literal or interface: a property, a method, or an index signature. */
function member(m, ctx, owner = '') {
  const name = ts.isIndexSignatureDeclaration(m) ? `[${m.parameters.map((p) => show(p, ctx.source)).join(', ')}]` : nameOf(m)
  const base = {
    name,
    optional: Boolean(m.questionToken),
    readonly: Boolean(m.modifiers?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword)),
  }
  if (ts.isMethodSignature(m)) {
    const sig = signature(m, ctx)
    return { ...base, kind: 'method', type: `${sig.text} => ${sig.returns}`, params: sig.params, returns: sig.returns, types: referenced(m), doc: doc(m, ctx, `${owner}.${name}`) }
  }
  return { ...base, kind: ts.isIndexSignatureDeclaration(m) ? 'index' : 'property', type: m.type ? show(m.type, ctx.source) : 'unknown', types: m.type ? referenced(m.type) : [], doc: doc(m, ctx, `${owner}.${name}`) }
}

/** A union's string literals, and its other members as written. */
function union(type, ctx) {
  if (ts.isParenthesizedTypeNode(type)) return union(type.type, ctx)
  if (!ts.isUnionTypeNode(type)) return null
  const values = []
  const others = []
  for (const t of type.types) {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text)
    else others.push(show(t, ctx.source))
  }
  return { values, others }
}

/** A namespace const (`declare const areas: { … }`). */
function namespace(decl, statement, ctx) {
  const name = decl.name.getText(ctx.source)
  const members = decl.type.members.map((m) => {
    const mname = nameOf(m)
    const sig = signature(m, ctx)
    return {
      name: mname,
      signature: `${name}.${mname}${sig.text}: ${sig.returns}`,
      params: sig.params,
      returns: sig.returns,
      types: referenced(m),
      doc: doc(m, ctx, `${name}.${mname}`),
    }
  })
  return { name, doc: doc(statement, ctx, name), members }
}

function typeEntry(node, ctx) {
  const name = node.name.text
  const entry = { name, kind: '', doc: doc(node, ctx, name) }
  if (ts.isClassDeclaration(node)) {
    entry.kind = 'handle'
  } else if (ts.isInterfaceDeclaration(node)) {
    entry.kind = 'interface'
    if (node.heritageClauses) entry.extends = node.heritageClauses.flatMap((h) => h.types.map((t) => show(t, ctx.source)))
    entry.members = node.members.map((m) => member(m, ctx, name))
  } else {
    entry.kind = 'type'
    entry.text = show(node.type, ctx.source)
    entry.types = referenced(node.type)
    const u = union(node.type, ctx)
    if (u) {
      entry.values = u.values
      entry.others = u.others
    }
    if (ts.isIntersectionTypeNode(node.type)) {
      entry.extends = node.type.types.filter((t) => !ts.isTypeLiteralNode(t)).map((t) => show(t, ctx.source))
    }
    const members = literalMembers(node.type, ctx)
    if (members.length) entry.members = members
  }
  return entry
}

/**
 * The JSON kept small: `false` flags and empty lists left out, and `types`
 * (the names a signature mentions) kept to the library's own.
 */
function prune(value, known) {
  if (Array.isArray(value)) return value.map((v) => prune(v, known))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const w = k === 'types' && Array.isArray(v) && v.every((x) => typeof x === 'string') ? v.filter((x) => known.has(x)) : prune(v, known)
    if (w === false || (Array.isArray(w) && !w.length)) continue
    out[k] = w
  }
  return out
}

/** The reference, as the object `library-reference.json` holds. */
export function buildReference(file = LIBRARY) {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const ctx = { source, warnings: [] }
  const namespaces = []
  const functions = []
  const types = []
  for (const s of source.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (d.type && ts.isTypeLiteralNode(d.type)) namespaces.push(namespace(d, s, ctx))
      }
    } else if (ts.isFunctionDeclaration(s) && s.name) {
      const sig = signature(s, ctx)
      functions.push({
        name: s.name.text,
        signature: `${s.name.text}${sig.text}: ${sig.returns}`,
        params: sig.params,
        returns: sig.returns,
        types: referenced(s),
        doc: doc(s, ctx, s.name.text),
      })
    } else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || (ts.isClassDeclaration(s) && s.name)) {
      types.push(typeEntry(s, ctx))
    }
  }
  // Only the library's own types are worth linking (not `Record`, `Omit`).
  const known = new Set(types.map((t) => t.name))
  return {
    reference: prune({
      source: 'crates/drawland-script/drawland.d.ts',
      generator: 'web/scripts/build-reference.mjs',
      namespaces,
      functions,
      types,
    }, known),
    warnings: ctx.warnings,
  }
}

/** The file's text: pretty-printed, with a final newline. */
export function referenceText(file = LIBRARY) {
  return `${JSON.stringify(buildReference(file).reference, null, 2)}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { warnings } = buildReference()
  for (const w of warnings) console.warn(`warning: ${w}`)
  writeFileSync(OUTPUT, referenceText())
  console.log(`wrote ${OUTPUT.slice(join(here, '..', '..').length + 1)}`)
}
