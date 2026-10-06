/**
 * Syntax highlighting for the documentation's code blocks, in the editor's own
 * scale: keywords black and bold, names near-black, strings mid-grey, comments
 * light and italic, punctuation lightest. `src/lib/editorTheme.js` holds the
 * same scale for Monaco, and `index.css` the `.flame` rules these classes use.
 *
 * A small tokenizer, by design: this is documentation, not an editor, and the
 * snippets are short and ordinary. It finds strings, comments and numbers
 * first, then words against the language's own little table, and leaves the
 * rest as plain text. Nothing is ever dropped or reordered, so what is on
 * screen is the code as written.
 */

// `text` is a comment (from `start`, to the end of the line); `quoted` names
// the quote characters of a string, when a language has them.
const LANGS = {
  bash: { comment: '#', words: 'kw' },
  python: { comment: '#', quoted: '"\'' },
  rust: { comment: '//', quoted: '"' },
  toml: { comment: '#', quoted: '"' },
  json: { quoted: '"' },
}

// Words that are keywords, and words that read as a type or a built name.
const WORDS = {
  js: [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'of', 'in', 'while', 'new', 'typeof',
    'import', 'export', 'from', 'async', 'await', 'class', 'extends', 'try', 'catch', 'throw', 'delete', 'null',
    'undefined', 'true', 'false', 'this',
  ],
  rust: ['fn', 'let', 'mut', 'pub', 'use', 'struct', 'enum', 'impl', 'match', 'return', 'if', 'else', 'for', 'in', 'self', 'as', 'where', 'trait', 'type', 'const'],
  python: ['def', 'return', 'if', 'else', 'elif', 'for', 'in', 'while', 'import', 'from', 'as', 'class', 'with', 'not', 'and', 'or', 'None', 'True', 'False', 'lambda'],
}

/** The JavaScript built names shown a touch heavier than plain punctuation. */
const BUILT = ['draw', 'fills', 'lines', 'areas', 'features', 'compose', 'output', 'title', 'engine', 'modules', 'ink', 'burin', 'Math', 'JSON', 'Object', 'String', 'Number', 'Array', 'console']

/**
 * `code` as HTML, with each token wrapped. The classes are the editor's:
 * `tk-c` comment, `tk-k` keyword, `tk-b` built name, `tk-s` string, `tk-n`
 * number, `tk-f` function name, `tk-o` punctuation.
 */
export function highlight(code, lang = 'js') {
  const spec = LANGS[lang] ?? {}
  const words = new Set(WORDS[lang] ?? [])
  const built = new Set(lang === 'js' ? BUILT : [])
  const out = []
  let i = 0
  const take = (end) => {
    const text = code.slice(i, end)
    i = end
    return text
  }
  while (i < code.length) {
    const c = code[i]
    // Comment to the end of the line.
    if (spec.comment && code.startsWith(spec.comment, i)) {
      const end = code.indexOf('\n', i)
      out.push(span('c', take(end === -1 ? code.length : end)))
      continue
    }
    // A string, including the JS template literal, kept whole across lines.
    if (c === '"' || c === "'" || (!spec.comment && c === '`') || (spec.quoted && spec.quoted.includes(c))) {
      const quote = c
      let end = i + 1
      while (end < code.length && code[end] !== quote) end += code[end] === '\\' ? 2 : 1
      out.push(span('s', take(Math.min(end + 1, code.length))))
      continue
    }
    // A number, with its unit when it is a length.
    if (/[0-9]/.test(c) && !/[\w$]/.test(code[i - 1] ?? '')) {
      let end = i
      while (end < code.length && /[\w.%]/.test(code[end])) end++
      out.push(span('n', take(end)))
      continue
    }
    // A word: a keyword, a built name, or a call (a name before `(`).
    if (/[A-Za-z_$]/.test(c)) {
      let end = i
      while (end < code.length && /[\w$]/.test(code[end])) end++
      const word = code.slice(i, end)
      const next = code[end]
      const cls = words.has(word) ? 'k' : built.has(word) ? 'b' : next === '(' ? 'f' : null
      const text = take(end)
      out.push(cls ? span(cls, text) : text)
      continue
    }
    // Punctuation and operators, one character at a time.
    if ('{}()[].,;:'.includes(c)) {
      out.push(span('o', take(i + 1)))
      continue
    }
    out.push(escapeHtml(take(i + 1)))
  }
  return out.join('')
}

const span = (cls, text) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
