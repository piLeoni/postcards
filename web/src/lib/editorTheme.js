/**
 * Monaco themes per palette (`lib/themes.js`). Still mostly two inks; keywords,
 * strings and comments are separated by tone, weight and slant.
 */

import { DEFAULT_THEME_ID, EDITOR_PALETTES, THEME_LIST, editorThemeName, themeMeta } from './themes'

export { editorThemeName }

/** @deprecated use editorThemeName(themeId) */
export const EDITOR_THEME = editorThemeName(DEFAULT_THEME_ID)

const SHARED_COLORS = {
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionHighlightBackground': '#00000012',
  'editor.wordHighlightBackground': '#00000010',
  'editor.wordHighlightStrongBackground': '#00000018',
  'editor.findMatchBackground': '#00000022',
  'editor.findMatchHighlightBackground': '#00000014',
  'editorOverviewRuler.border': '#00000000',
  'editorBracketHighlight.foreground1': '#888888',
  'editorBracketHighlight.foreground2': '#888888',
  'editorBracketHighlight.foreground3': '#888888',
  'editorBracketHighlight.foreground4': '#888888',
  'editorBracketHighlight.foreground5': '#888888',
  'editorBracketHighlight.foreground6': '#888888',
  'editorBracketHighlight.unexpectedBracket.foreground': '#888888',
  'editorWhitespace.foreground': '#00000014',
}

export function defineEditorThemes(monaco) {
  for (const { id } of THEME_LIST) {
    const pal = EDITOR_PALETTES[id]
    if (!pal) continue
    const scheme = themeMeta(id).scheme
    monaco.editor.defineTheme(editorThemeName(id), {
      base: scheme === 'dark' ? 'vs-dark' : 'vs',
      inherit: false,
      rules: pal.rules,
      colors: { ...SHARED_COLORS, ...pal.colors },
    })
  }
}

/** @deprecated use defineEditorThemes */
export function defineEditorTheme(monaco) {
  defineEditorThemes(monaco)
}

/** The page's monospace (`--font-mono` in index.css), for the editor. */
export function editorFont() {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return css || '"IBM Plex Mono", ui-monospace, Menlo, monospace'
}
