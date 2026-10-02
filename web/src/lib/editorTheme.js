/**
 * A greyscale theme for the editor, in step with the black-and-white page:
 * what is what is told by tone, weight and slant, not by colour. Names (YAML
 * keys) are black and bold, values mid-grey, comments light and italic,
 * punctuation lightest.
 *
 * Built without inheriting from `vs`: its token rules are more specific than
 * ours and would bring colour back.
 */

export const EDITOR_THEME = 'postcards-grey'

// Darker than burin-map's: this document is mostly `{ }` flow maps, so
// punctuation is a large share of what is on screen.
const NAME = '000000'
const VALUE = '262626'
const TEXT = '333333'
const HELP = '666666'
const MARK = '666666'

export function defineEditorTheme(monaco) {
  monaco.editor.defineTheme(EDITOR_THEME, {
    base: 'vs',
    inherit: false,
    rules: [
      { token: '', foreground: '1a1a1a' },
      { token: 'type', foreground: NAME, fontStyle: 'bold' },
      { token: 'string.key', foreground: NAME, fontStyle: 'bold' },
      { token: 'attribute.name', foreground: NAME, fontStyle: 'bold' },
      { token: 'number', foreground: VALUE },
      { token: 'keyword', foreground: VALUE },
      { token: 'variable', foreground: VALUE },
      { token: 'type.identifier', foreground: VALUE },
      { token: 'string', foreground: TEXT },
      { token: 'comment', foreground: HELP, fontStyle: 'italic' },
      { token: 'delimiter', foreground: MARK },
      { token: 'operators', foreground: MARK },
      { token: 'white', foreground: MARK },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1a1a1a',
      'editorGutter.background': '#ffffff',
      'editorLineNumber.foreground': '#8a8a8a',
      'editorLineNumber.activeForeground': '#1a1a1a',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#000000',
      'editor.selectionBackground': '#d9d9d9',
      'editor.inactiveSelectionBackground': '#e8e8e8',
      'editor.selectionHighlightBackground': '#ebebeb',
      'editor.wordHighlightBackground': '#ebebeb',
      'editor.wordHighlightStrongBackground': '#e0e0e0',
      'editor.findMatchBackground': '#c4c4c4',
      'editor.findMatchHighlightBackground': '#e3e3e3',
      // Monaco colours bracket pairs even with `bracketPairColorization` off.
      'editorBracketHighlight.foreground1': '#666666',
      'editorBracketHighlight.foreground2': '#666666',
      'editorBracketHighlight.foreground3': '#666666',
      'editorBracketHighlight.foreground4': '#666666',
      'editorBracketHighlight.foreground5': '#666666',
      'editorBracketHighlight.foreground6': '#666666',
      'editorBracketHighlight.unexpectedBracket.foreground': '#666666',
      'editorBracketMatch.background': '#e6e6e6',
      'editorBracketMatch.border': '#9a9a9a',
      'editorIndentGuide.background1': '#eeeeee',
      'editorIndentGuide.activeBackground1': '#c8c8c8',
      'editorWhitespace.foreground': '#d6d6d6',
      'editorOverviewRuler.border': '#00000000',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#1a1a1a',
      'editorSuggestWidget.selectedBackground': '#ebebeb',
      'focusBorder': '#1a1a1a',
      'scrollbarSlider.background': '#00000018',
      'scrollbarSlider.hoverBackground': '#00000030',
      'scrollbarSlider.activeBackground': '#00000048',
    },
  })
}

/** The page's monospace (`--font-mono` in index.css), for the editor. */
export function editorFont() {
  const css = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return css || '"IBM Plex Mono", ui-monospace, Menlo, monospace'
}
