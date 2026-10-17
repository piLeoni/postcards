/**
 * Profile editor JS tokenizer: same as Monaco's default, plus distinct tokens for
 * module roots, members after `.`, and call sites before `(`.
 */

import { language as jsMonarch } from 'monaco-editor/languages/definitions/javascript/javascript.js'

/** Top-level draw.land graph namespaces (see docs/highlight.js). */
const DRAWLAND_ROOTS = [
  'draw',
  'fills',
  'lines',
  'areas',
  'features',
  'compose',
  'output',
  'title',
  'engine',
  'modules',
  'ink',
  'burin',
]

function patchCommon(common) {
  const rest = common.slice(2)
  const withoutDot = rest.map((rule) => {
    if (Array.isArray(rule) && rule[0] === /[;,.]/ && rule[1] === 'delimiter') {
      return [/[;,]/, 'delimiter']
    }
    return rule
  })
  return [
    [/[a-z_$][\w$]*(?=\s*\()/, 'function'],
    [
      /#?[a-z_$][\w$]*/,
      {
        cases: {
          '@keywords': 'keyword',
          '@drawlandRoots': 'namespace',
          '@default': 'variable',
        },
      },
    ],
    [/[A-Z][\w$]*/, 'type.identifier'],
    ...withoutDot,
    [/\./, { token: 'delimiter', next: '@member' }],
  ]
}

const profileJavascriptLanguage = {
  ...jsMonarch,
  drawlandRoots: DRAWLAND_ROOTS,
  tokenizer: {
    ...jsMonarch.tokenizer,
    common: patchCommon(jsMonarch.tokenizer.common),
    member: [
      [/[a-z_$][\w$]*/, { token: 'member', next: '@pop' }],
      [/[A-Z][\w$]*/, { token: 'member', next: '@pop' }],
      ['', { token: '', next: '@pop' }],
    ],
  },
}

let registered = false

/** @param {import('monaco-editor').languages} languages */
export function registerProfileJavascriptTokenizer(languages) {
  if (registered) return
  registered = true
  languages.setMonarchTokensProvider('javascript', profileJavascriptLanguage)
}
