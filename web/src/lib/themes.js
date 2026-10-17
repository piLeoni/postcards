/**
 * Colour palettes for the UI and Monaco. CSS variables live in `themes.css`;
 * editor token colours here stay in step with each palette.
 */

import { graySyntaxRules, phosphorSyntaxRules, readableSyntaxRules } from './editorTokens.js'

export const DEFAULT_THEME_ID = 'paper'

/** @typedef {{ id: string, label: string, scheme: 'light' | 'dark' }} ThemeMeta */

/** @type {(ThemeMeta & { swatch: [string, string] })[]} */
export const THEME_LIST = [
  { id: 'paper', label: 'Paper', scheme: 'light', swatch: ['#ffffff', '#000000'] },
  { id: 'ink', label: 'Ink', scheme: 'dark', swatch: ['#0a0b0d', '#eef1f6'] },
  { id: 'silk', label: 'Silk', scheme: 'light', swatch: ['#f7f6f2', '#5f5d58'] },
  { id: 'abyss', label: 'Abyss', scheme: 'dark', swatch: ['#0b2326', '#e9dfc8'] },
  { id: 'ember', label: 'Ember', scheme: 'dark', swatch: ['#120e06', '#ffbf3a'] },
  { id: 'phosphor', label: 'Phosphor', scheme: 'dark', swatch: ['#0a0f0a', '#41ff41'] },
]

const byId = Object.fromEntries(THEME_LIST.map((t) => [t.id, t]))

/** Previous palette ids still in `localStorage`. */
const LEGACY_THEME_IDS = {
  midnight: 'abyss',
  parchment: 'silk',
  amber: 'ember',
  contrast: 'paper',
  lemon: 'silk',
  rose: 'ember',
}

export function normalizeThemeId(id) {
  if (!id || typeof id !== 'string') return DEFAULT_THEME_ID
  const mapped = LEGACY_THEME_IDS[id] ?? id
  return byId[mapped] ? mapped : DEFAULT_THEME_ID
}

export function themeMeta(id) {
  return byId[normalizeThemeId(id)]
}

export function editorThemeName(id) {
  return `drawland-${themeMeta(id).id}`
}

/** Apply `data-theme` and `color-scheme` on the document root. */
export function applyTheme(id) {
  const t = themeMeta(id)
  document.documentElement.dataset.theme = t.id
  document.documentElement.style.colorScheme = t.scheme
}

/**
 * Basemap per palette: same hue family as the UI chrome (paper, ink, silk, abyss,
 * ember, phosphor). Silk and Abyss use softer map linework and UI dividers.
 *
 * @type {Record<string, {
 *   sky: string, land: string, wash: string, botanical: string,
 *   road: string, roadEdge: string,
 *   labelHard: string, label: string, labelSoft: string, labelQuiet: string,
 * }>}
 */
export const MAP_PALETTES = {
  paper: {
    sky: '#ffffff',
    land: '#ffffff',
    wash: '#f0f0f0',
    botanical: '#fafafa',
    road: '#ffffff',
    roadEdge: '#dddddd',
    labelHard: '#000000',
    label: '#333333',
    labelSoft: '#777777',
    labelQuiet: '#999999',
  },
  ink: {
    sky: '#0a0b0d',
    land: '#111318',
    wash: '#181c24',
    botanical: '#141820',
    road: '#222830',
    roadEdge: '#343c48',
    labelHard: '#eef1f6',
    label: '#b8bec8',
    labelSoft: '#787f8c',
    labelQuiet: '#525862',
  },
  silk: {
    sky: '#f7f6f2',
    land: '#f3f1ec',
    wash: '#ebe9e4',
    botanical: '#f2f0eb',
    road: '#f5f4f0',
    roadEdge: '#e4e2dc',
    labelHard: '#5f5d58',
    label: '#8a8880',
    labelSoft: '#a8a6a0',
    labelQuiet: '#c8c6c0',
  },
  abyss: {
    sky: '#0b2326',
    land: '#081e21',
    wash: '#06181b',
    botanical: '#0a2225',
    road: '#0a2428',
    roadEdge: '#123038',
    labelHard: '#e9dfc8',
    label: '#a09888',
    labelSoft: '#506870',
    labelQuiet: '#384850',
  },
  ember: {
    sky: '#120e06',
    land: '#1a1408',
    wash: '#2a2210',
    botanical: '#201a0c',
    road: '#302818',
    roadEdge: '#483c28',
    labelHard: '#ffbf3a',
    label: '#e8a838',
    labelSoft: '#a07830',
    labelQuiet: '#705820',
  },
  phosphor: {
    sky: '#0a0f0a',
    land: '#0e140e',
    wash: '#142018',
    botanical: '#0c120c',
    road: '#182018',
    roadEdge: '#283828',
    labelHard: '#41ff41',
    label: '#30d030',
    labelSoft: '#208820',
    labelQuiet: '#145014',
  },
}

/** Role → hex for MapLibre paint (see `calm` in MapView). */
export function mapColors(themeId) {
  const p = MAP_PALETTES[themeMeta(themeId).id] ?? MAP_PALETTES.paper
  return {
    paper: p.sky,
    land: p.land,
    wash: p.wash,
    botanical: p.botanical,
    line: p.road,
    edge: p.roadEdge,
    ink: p.labelHard,
    hard: p.label,
    soft: p.labelSoft,
    faint: p.labelQuiet,
  }
}

/** Default ink colour on the card (matches `--foreground0` of each palette). */
export function defaultInkColor(themeId) {
  const p = MAP_PALETTES[themeMeta(themeId).id] ?? MAP_PALETTES.paper
  return p.labelHard
}

/**
 * Monaco: grey steps (slightly cool on light themes). Hue lives in chrome/map for
 * Midnight and Phosphor; Paper stays high-contrast trademark.
 *
 * @type {Record<string, { rules: import('monaco-editor').editor.ITokenThemeRule[], colors: Record<string, string> }>}
 */
export const EDITOR_PALETTES = {
  paper: {
    rules: graySyntaxRules({
      base: '000000',
      bold: '000000',
      mid: '333333',
      soft: '555555',
      mute: '777777',
      dim: 'aaaaaa',
    }),
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#000000',
      'editorGutter.background': '#ffffff',
      'editorLineNumber.foreground': '#aaaaaa',
      'editorLineNumber.activeForeground': '#000000',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editorCursor.foreground': '#000000',
      'editor.selectionBackground': '#d4d4d4',
      'editor.inactiveSelectionBackground': '#e8e8e8',
      'editorBracketHighlight.foreground1': '#777777',
      'editorBracketHighlight.foreground2': '#555555',
      'editorBracketHighlight.foreground3': '#333333',
      'editorBracketMatch.background': '#e0e0e0',
      'editorBracketMatch.border': '#999999',
      'editorIndentGuide.background1': '#ececec',
      'editorIndentGuide.activeBackground1': '#c0c0c0',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#1a1a1a',
      'editorSuggestWidget.selectedBackground': '#ebebeb',
      'focusBorder': '#000000',
      'scrollbarSlider.background': '#00000018',
      'scrollbarSlider.hoverBackground': '#00000030',
      'scrollbarSlider.activeBackground': '#00000048',
    },
  },
  ink: {
    rules: graySyntaxRules({
      base: 'c8ccd4',
      bold: 'f2f4f8',
      mid: '9aa3b0',
      soft: '808890',
      mute: '5c6470',
      dim: '454c58',
    }),
    colors: {
      'editor.background': '#0a0b0d',
      'editor.foreground': '#c8ccd4',
      'editorGutter.background': '#0a0b0d',
      'editorLineNumber.foreground': '#454c58',
      'editorLineNumber.activeForeground': '#eef1f6',
      'editor.lineHighlightBackground': '#111318',
      'editorCursor.foreground': '#f2f4f8',
      'editor.selectionBackground': '#2a3038',
      'editor.inactiveSelectionBackground': '#1a1e24',
      'editorBracketHighlight.foreground1': '#808890',
      'editorBracketHighlight.foreground2': '#9aa3b0',
      'editorBracketHighlight.foreground3': '#6a727c',
      'editorBracketMatch.background': '#222830',
      'editorBracketMatch.border': '#525862',
      'editorIndentGuide.background1': '#181c24',
      'editorWidget.background': '#0e1014',
      'editorWidget.border': '#9aa3b0',
      'editorSuggestWidget.selectedBackground': '#1a1e24',
      'focusBorder': '#9aa3b0',
      'scrollbarSlider.background': '#ffffff18',
      'scrollbarSlider.hoverBackground': '#ffffff30',
      'scrollbarSlider.activeBackground': '#ffffff45',
    },
  },
  silk: {
    rules: readableSyntaxRules({
      base: '5f5d58',
      keyword: '2a2848',
      type: '3a52b0',
      namespace: '0a7070',
      variable: '4a4844',
      member: 'a04818',
      func: '007878',
      string: '2a7a38',
      number: 'a06818',
      comment: '8a8780',
      dim: 'b0ada5',
      mid: '6a6862',
    }),
    colors: {
      'editor.background': '#f7f6f2',
      'editor.foreground': '#5f5d58',
      'editorGutter.background': '#f7f6f2',
      'editorLineNumber.foreground': '#b8b5ad',
      'editorLineNumber.activeForeground': '#3a3834',
      'editor.lineHighlightBackground': '#f1efea',
      'editorCursor.foreground': '#3a3834',
      'editor.selectionBackground': '#d5d2cb',
      'editor.inactiveSelectionBackground': '#e2dfd7',
      'editorBracketHighlight.foreground1': '#5a88c8',
      'editorBracketHighlight.foreground2': '#4a9860',
      'editorBracketHighlight.foreground3': '#b08840',
      'editorBracketMatch.background': '#e2dfd7',
      'editorBracketMatch.border': '#949188',
      'editorIndentGuide.background1': '#e2dfd7',
      'editorWidget.background': '#f7f6f2',
      'editorWidget.border': '#5f5d58',
      'editorSuggestWidget.selectedBackground': '#f1efea',
      'focusBorder': '#5f5d58',
      'scrollbarSlider.background': '#00000012',
      'scrollbarSlider.hoverBackground': '#00000022',
      'scrollbarSlider.activeBackground': '#00000032',
    },
  },
  abyss: {
    rules: readableSyntaxRules({
      base: 'e9dfc8',
      keyword: 'f8f0d8',
      type: '7ad4ff',
      namespace: '62d8f0',
      variable: 'e0d4bc',
      member: 'ffb070',
      func: 'd8b8ff',
      string: 'd0ff50',
      number: 'ffd060',
      comment: '6a98a8',
      dim: '4a8090',
      mid: 'c0b0a0',
    }),
    colors: {
      'editor.background': '#0b2326',
      'editor.foreground': '#e9dfc8',
      'editorGutter.background': '#0b2326',
      'editorLineNumber.foreground': '#3d6878',
      'editorLineNumber.activeForeground': '#f5eed8',
      'editor.lineHighlightBackground': '#071a1d',
      'editorCursor.foreground': '#f5eed8',
      'editor.selectionBackground': '#1a4550',
      'editor.inactiveSelectionBackground': '#0f2a2e',
      'editorBracketHighlight.foreground1': '#62b8de',
      'editorBracketHighlight.foreground2': '#c6f926',
      'editorBracketHighlight.foreground3': '#e8c050',
      'editorBracketMatch.background': '#0f2a2e',
      'editorBracketMatch.border': '#5a7888',
      'editorIndentGuide.background1': '#092022',
      'editorWidget.background': '#071a1d',
      'editorWidget.border': '#62b8de',
      'editorSuggestWidget.selectedBackground': '#0f2a2e',
      'focusBorder': '#62b8de',
      'scrollbarSlider.background': '#ffffff18',
      'scrollbarSlider.hoverBackground': '#ffffff30',
      'scrollbarSlider.activeBackground': '#ffffff45',
    },
  },
  ember: {
    rules: [
      { token: '', foreground: 'e8a838' },
      { token: 'keyword', foreground: 'ffbf3a', fontStyle: 'bold' },
      { token: 'type', foreground: 'ffc860', fontStyle: 'bold' },
      { token: 'string.key', foreground: 'ffc860', fontStyle: 'bold' },
      { token: 'attribute.name', foreground: 'ffc860', fontStyle: 'bold' },
      { token: 'number', foreground: 'ff9830', fontStyle: 'bold' },
      { token: 'identifier', foreground: 'e8a838' },
      { token: 'variable', foreground: 'e8a838' },
      { token: 'namespace', foreground: 'ffc860', fontStyle: 'bold' },
      { token: 'member', foreground: 'd89828' },
      { token: 'function', foreground: 'ffb050' },
      { token: 'string', foreground: 'd89828' },
      { token: 'regexp', foreground: 'd89828' },
      { token: 'comment', foreground: '907030', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '705820' },
      { token: 'operators', foreground: 'c09030' },
      { token: 'function', foreground: 'ffb050' },
    ],
    colors: {
      'editor.background': '#120e06',
      'editor.foreground': '#e8a838',
      'editorGutter.background': '#120e06',
      'editorLineNumber.foreground': '#705820',
      'editorLineNumber.activeForeground': '#ffbf3a',
      'editor.lineHighlightBackground': '#1a1408',
      'editorCursor.foreground': '#ffbf3a',
      'editor.selectionBackground': '#3d3020',
      'editor.inactiveSelectionBackground': '#2a2210',
      'editorBracketHighlight.foreground1': '#ffc860',
      'editorBracketHighlight.foreground2': '#d89828',
      'editorBracketHighlight.foreground3': '#ff9830',
      'editorBracketMatch.background': '#302818',
      'editorBracketMatch.border': '#907030',
      'editorIndentGuide.background1': '#2a2210',
      'editorWidget.background': '#1a1408',
      'editorWidget.border': '#a07830',
      'editorSuggestWidget.selectedBackground': '#2a2210',
      'focusBorder': '#a07830',
      'scrollbarSlider.background': '#ffbf3a28',
      'scrollbarSlider.hoverBackground': '#ffbf3a40',
      'scrollbarSlider.activeBackground': '#ffbf3a58',
    },
  },
  phosphor: {
    rules: phosphorSyntaxRules(),
    colors: {
      'editor.background': '#0a0f0a',
      'editor.foreground': '#8ee878',
      'editorGutter.background': '#0a0f0a',
      'editorLineNumber.foreground': '#386830',
      'editorLineNumber.activeForeground': '#b8ffb0',
      'editor.lineHighlightBackground': '#0e140e',
      'editorCursor.foreground': '#41ff41',
      'editor.selectionBackground': '#1a3020',
      'editor.inactiveSelectionBackground': '#142018',
      'editorBracketHighlight.foreground1': '#70b868',
      'editorBracketHighlight.foreground2': '#90d088',
      'editorBracketHighlight.foreground3': '#58a050',
      'editorBracketMatch.background': '#182818',
      'editorBracketMatch.border': '#488840',
      'editorIndentGuide.background1': '#142018',
      'editorWidget.background': '#0c120c',
      'editorWidget.border': '#58a050',
      'editorSuggestWidget.selectedBackground': '#142018',
      'focusBorder': '#58a050',
      'scrollbarSlider.background': '#41ff4128',
      'scrollbarSlider.hoverBackground': '#41ff4140',
      'scrollbarSlider.activeBackground': '#41ff4158',
    },
  },
}
