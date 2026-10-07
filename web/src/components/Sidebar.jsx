import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import Editor from '@monaco-editor/react'
import { PRESETS } from '../lib/presets'
import { injectStyleAtPlace, outputOf, styleOf, titleOf } from '../lib/doc'
import { sidebarWidthAtom } from '../lib/store'
import { EDITOR_THEME, defineEditorTheme, editorFont } from '../lib/editorTheme'
import LIBRARY from '../../../crates/drawland-script/drawland.d.ts?raw'
import Panel from './Panel'

/** WebTUI button looks: a grey key, and one that only shows on hover. */
const KEY = { 'size-': 'small', 'variant-': 'background1' }

/* ---------------------------------------------------------------- */
/*  Sidebar — the document, which is the output                       */
/* ---------------------------------------------------------------- */

/** The column's width on a wide screen, in px: dragged by its left edge, kept. */
const DEFAULT_WIDTH = 448
const MIN_WIDTH = 320
const clampWidth = (w) => Math.round(Math.min(Math.max(w, MIN_WIDTH), window.innerWidth * 0.7))
/** The site's pages, opened in place rather than fetched (see `App.jsx`). */
const go = (e, path) => {
  e.preventDefault()
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** Where an engine message points, `line 3 column 11`, if it does. */
const spotOf = (text) => {
  const m = text.match(/line (\d+) column (\d+)/)
  return m ? { line: Number(m[1]), column: Number(m[2]) } : null
}

/** The engine's words, without the parser's own prefix. */
const plain = (text) => sentence(text.replace(/^(Error: |graph JSON: )/, ''))

/**
 * The editor checks the script as JavaScript against the library's
 * description: autocomplete, argument docs, and a wrong kind of value (lines
 * where an area goes) underlined while typing. No DOM: a profile has no page.
 */
let libraryAdded = false
function setUpEditor(monaco) {
  defineEditorTheme(monaco)
  const ts = monaco.typescript ?? monaco.languages.typescript
  const js = ts.javascriptDefaults
  js.setCompilerOptions({
    allowJs: true,
    checkJs: true,
    allowNonTsExtensions: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    lib: ['es2020'],
  })
  js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })
  if (!libraryAdded) {
    js.addExtraLib(LIBRARY, 'file:///drawland.d.ts')
    libraryAdded = true
  }
}

const PRESET_STYLES = PRESETS.map((p) => [p, styleOf(p.doc)])

/** A file name from a title: `Parks and buildings` → `parks-and-buildings`. */
const slug = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function Sidebar({ open, onClose, doc, setDoc, check, output, status, drawing, busy, onDraw, onDrawAfterApply, onStop, onShare, onPlaceMap }) {
  const [width, setWidth] = useAtom(sidebarWidthAtom)
  const [draft, setDraft] = useState(null)   // text typed but not applied yet
  const [notice, setNotice] = useState(null)   // { text, error? }
  const [problem, setProblem] = useState(null)   // { kind: 'apply' | 'draw', title, text }
  const monacoRef = useRef(null)   // { editor, monaco }
  const syncingRef = useRef(false)   // the editor is being brought to `shown`, not typed in
  const fileRef = useRef(null)
  const presetMenuRef = useRef(null)
  const noticeTimer = useRef(0)
  const applyDraftRef = useRef(() => {})

  const shown = draft ?? doc
  const shownRef = useRef(shown)
  shownRef.current = shown
  const dirty = draft != null && draft !== doc
  const title = titleOf(shown) ?? ''
  const style = useMemo(() => styleOf(shown), [shown])
  const preset = PRESET_STYLES.find(([, s]) => s === style)?.[0] ?? null
  // A drag or a preset rewrites the document; an edit in progress stays.
  useEffect(() => {
    if (draft === doc) setDraft(null)
  }, [doc, draft])

  const flash = (text, isError = false) => {
    clearTimeout(noticeTimer.current)
    setNotice({ text, error: isError })
    noticeTimer.current = setTimeout(() => setNotice(null), isError ? 8000 : 3000)
  }

  // The editor follows the document by the smallest edit that gets it there:
  // a drag rewrites a few digits, so only those change, and the view, the
  // cursor and the undo history stay as they are.
  useEffect(() => {
    const model = monacoRef.current?.editor.getModel()
    if (!model) return
    const now = model.getValue()
    if (now === shown) return
    let a = 0
    while (a < now.length && a < shown.length && now[a] === shown[a]) a++
    let b = 0
    while (b < now.length - a && b < shown.length - a && now[now.length - 1 - b] === shown[shown.length - 1 - b]) b++
    const from = model.getPositionAt(a)
    const to = model.getPositionAt(now.length - b)
    syncingRef.current = true
    model.pushEditOperations([], [{ range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text: shown.slice(a, shown.length - b) }], () => null)
    syncingRef.current = false
  }, [shown])

  /** Underline where the engine points, or nothing. */
  const mark = (text) => {
    const m = monacoRef.current
    const model = m?.editor.getModel()
    if (!model) return
    const at = text && spotOf(text)
    m.monaco.editor.setModelMarkers(model, 'drawland', at && at.line <= model.getLineCount()
      ? [{
          severity: m.monaco.MarkerSeverity.Error,
          message: plain(text).split('\n')[0],
          startLineNumber: at.line,
          startColumn: at.column,
          endLineNumber: at.line,
          endColumn: model.getLineMaxColumn(at.line),
        }]
      : [])
    if (at) m.editor.revealLineNearTop(at.line)
  }

  const clearProblem = () => {
    setProblem(null)
    mark(null)
  }

  /** A script is only applied once it runs and the engine takes it; else it stays a draft and says why. */
  const applyDraft = async () => {
    if (!dirty) return true
    const text = draft
    const wrong = await check(text)
    if (shownRef.current !== text) return false
    if (wrong) {
      setProblem({ kind: 'apply', title: 'Not applied', text: wrong })
      mark(wrong)
      return false
    }
    clearProblem()
    setDoc(text)
    setDraft(null)
    return true
  }

  /**
   * Run applies first, then draws: a run over an edited script draws what the
   * editor says, not the last applied one. A script that does not apply is not
   * drawn; the reason is already on screen.
   */
  const run = async () => {
    if (!dirty) {
      onDraw()
      return
    }
    const text = draft
    if (!(await applyDraft())) return
    onDrawAfterApply(text)
  }

  // A draw that fails says why in the same card.
  const drawError = status.phase === 'error' ? status.detail : null
  useEffect(() => {
    if (drawError) setProblem({ kind: 'draw', title: 'Not drawn', text: drawError })
  }, [drawError])

  // Nothing left to apply, nothing wrong with applying it.
  useEffect(() => {
    if (!dirty && problem?.kind === 'apply') clearProblem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, problem])
  applyDraftRef.current = applyDraft

  /** A preset brings title, place, paper and style; the map follows its centre. */
  const loadPreset = (p) => {
    presetMenuRef.current?.removeAttribute('open')
    setDoc(p.doc)
    setDraft(null)
    const o = outputOf(p.doc)
    if (o?.kind === 'literal' && Number.isFinite(o.value?.lat) && Number.isFinite(o.value?.lng)) {
      onPlaceMap?.({ lat: o.value.lat, lng: o.value.lng, bearing: o.value.bearing })
    }
    flash(`Loaded ${p.name}`)
  }

  /** The preset's style and title, keeping the output already on the map. */
  const injectPreset = (p) => {
    presetMenuRef.current?.removeAttribute('open')
    const text = injectStyleAtPlace(shown, p.doc)
    setDoc(text)
    setDraft(null)
    flash(`Injected ${p.name} here`)
  }

  /** A file that the engine does not take opens as a draft, with the reason. */
  const importFile = async (file) => {
    if (!file) return
    const text = await file.text()
    const wrong = await check(text)
    if (wrong) {
      setDraft(text)
      setProblem({ kind: 'apply', title: `${file.name} not applied`, text: wrong })
      setTimeout(() => mark(wrong))
      return
    }
    clearProblem()
    setDoc(text)
    setDraft(null)
    flash(`Loaded ${file.name}`)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([shown], { type: 'text/javascript' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(title) || 'drawland'}.js`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown)
      flash('Script copied')
    } catch {
      flash('The browser blocked the clipboard', true)
    }
  }

  /**
   * Open the share sheet for the applied document. The two transports it
   * offers — the script in the URL, and the stored short link — are resolved
   * there, where the choice is explained; this only opens it. The sheet itself
   * is a panel over the map (see `App.jsx`), not over this column.
   */

  const resize = (e) => {
    e.preventDefault()
    const move = (ev) => setWidth(clampWidth(window.innerWidth - ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const groups = drawing?.groups ?? []
  const strokes = useMemo(() => groups.reduce((n, [, s]) => n + s, 0), [groups])
  const failed = status.phase === 'error'
  // Engine errors start in lower case, like the terminal's; a message here
  // starts with a capital.
  const statusText = failed
    ? sentence(status.detail ?? 'Something went wrong')
    : status.phase === 'working'
      ? status.detail ?? 'Drawing…'
      : status.phase === 'loading'
        ? 'Starting…'
        : drawing
          ? `Drawn in ${drawing.ms} ms · ${strokes.toLocaleString('en-US')} strokes · ${(drawing.svg.size / 1e6).toFixed(1)} MB`
          : 'Not drawn yet'

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-40 flex h-[85vh] min-h-0 w-full min-w-0 flex-col border-t border-black bg-white px-[2ch] transition-transform duration-200 lg:relative lg:z-30 lg:h-full lg:shadow-[-4px_0_14px_rgba(0,0,0,0.16)] lg:w-[var(--side-w)] lg:shrink-0 lg:translate-y-0 lg:pointer-events-auto lg:border-t-0 lg:border-l ${
        open ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      }`}
      style={{ color: '#000', backgroundColor: '#fff', '--side-w': `${width}px` }}
    >
      <Panel
        title={<span className="tracking-[0.2em]">DRAWLAND</span>}
        className="shrink-0"
        aside={(
          <button type="button" aria-label="Close" {...KEY} className="lg:hidden" onClick={onClose}>✕</button>
        )}
      >
        <p className="opacity-60">
          Turn any place on Earth into a pen-and-ink drawing. Frame a view on
          the map and draw.land produces a layered SVG, ready for a pen
          plotter, a laser cutter or any vector editor. Fine-tune each layer below.
        </p>
      </Panel>

      <Panel
        title={dirty ? 'Script ●' : 'Script'}
        className="relative flex min-h-0 flex-1 flex-col"
        aside={(
          <span
            className={`min-w-0 truncate ${dirty || failed ? 'font-bold' : 'opacity-60'}`}
            title={dirty ? undefined : statusText}
          >
            {dirty ? 'Edited, not applied' : failed ? '✗ Not drawn' : `${drawing ? '●' : '○'} ${statusText}`}
          </span>
        )}
      >
        <div className="relative flex shrink-0 flex-wrap gap-[1ch]">
          <button type="button" {...KEY} title="Load a profile script (.js)" onClick={() => fileRef.current?.click()}>
            load
          </button>
          <button type="button" {...KEY} title="Save the script as a .js file named after its title" onClick={download}>
            save
          </button>
          {/* Static, so the menu opens under the whole row rather than this button. */}
          <details ref={presetMenuRef} is-="popover" className="static">
            <summary is-="button" {...KEY} title="Replace the profile with a ready-made one; the map centres on its place">
              presets ▾
            </summary>
            <div className="z-30 w-full border border-black bg-white">
              <ul className="max-h-[60vh] divide-y divide-black overflow-y-auto">
                {PRESETS.map((p) => (
                  <li key={p.id} className="flex items-stretch">
                    <button
                      type="button"
                      size-="small"
                      variant-="background0"
                      aria-current={p === preset || undefined}
                      className={`h-auto min-w-0 flex-1 flex-col items-start justify-start px-[1ch] py-[0.5lh] text-left hover:bg-black hover:text-white hover:no-underline ${
                        p === preset ? 'bg-black text-white' : ''
                      }`}
                      onClick={() => loadPreset(p)}
                    >
                      <span className="font-bold">{p === preset ? `● ${p.name}` : p.name}</span>
                      <span className="opacity-60">{p === preset ? `the style in use · ${p.hint}` : p.hint}</span>
                    </button>
                    <button
                      type="button"
                      size-="small"
                      variant-="background0"
                      title="Use this preset's layers here; keep the map position and paper"
                      className="shrink-0 border-l border-black px-[1ch] py-[0.5lh] hover:bg-black hover:text-white hover:no-underline"
                      onClick={() => injectPreset(p)}
                    >
                      inject here
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <button
            type="button"
            {...KEY}
            title="Share the applied script: a link that carries it, or a short link to it"
            onClick={onShare}
          >
            share
          </button>
          {/* The run, in the shape every script tool has taught: play starts a
              draw, stop (while one runs) gives it up. */}
          <button
            type="button"
            size-="small"
            variant-={busy ? 'background1' : 'foreground0'}
            className="ml-auto inline-flex items-center gap-[0.75ch]"
            title={busy ? 'Stop the draw' : drawing ? 'Apply the script, then draw it again' : 'Apply the script, then draw it'}
            aria-label={busy ? 'Stop the draw' : 'Draw the script'}
            disabled={!output || (!busy && !onDraw)}
            onClick={busy ? onStop : run}
          >
            {busy ? (
              <svg aria-hidden viewBox="0 0 12 12" className="h-[1em] w-[1em] shrink-0" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" />
              </svg>
            ) : drawing ? (
              <svg aria-hidden viewBox="0 0 12 12" className="h-[1em] w-[1em] shrink-0">
                <path d="M10 6A4 4 0 1 1 8 2.54" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9.56 3.44L6.68 3.62L8.28 0.85z" fill="currentColor" />
              </svg>
            ) : (
              <svg aria-hidden viewBox="0 0 12 12" className="h-[1em] w-[1em] shrink-0" fill="currentColor">
                <path d="M2.5 1.5v9l8-4.5z" />
              </svg>
            )}
            {busy ? 'STOP' : drawing ? 'RERUN' : 'RUN'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".js,.txt"
            className="hidden"
            onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </div>
        {notice && (
          <p className={`mt-[0.5lh] shrink-0 break-words ${notice.error ? 'font-bold' : 'opacity-60'}`}>
            {notice.error ? `✗ ${sentence(notice.text)}` : sentence(notice.text)}
          </p>
        )}
        <div className="relative mt-[0.5lh] min-h-0 flex-1 overflow-hidden border border-black pt-[0.5lh]">
          <div className="absolute top-[0.25lh] right-[2ch] z-10 flex gap-[1ch]">
            {dirty && (
              <>
                <button type="button" {...KEY} title="Back to the script as it was" onClick={() => { setDraft(null); clearProblem() }}>
                  revert
                </button>
                <button type="button" size-="small" variant-="foreground0" title="⌘/Ctrl + Enter" onClick={applyDraft}>
                  apply
                </button>
              </>
            )}
            <button type="button" {...KEY} title="Copy the script" onClick={copy}>
              copy
            </button>
          </div>
          {/* Under the buttons, so the script can still be reverted or applied. */}
          {problem && <div aria-hidden className="absolute inset-0 z-[5] cursor-pointer bg-white/65" title="Close" onClick={clearProblem} />}
          <Editor
            height="100%"
            language="javascript"
            path="file:///profile.js"
            theme={EDITOR_THEME}
            defaultValue={shown}
            onChange={(v) => {
              if (!syncingRef.current) setDraft(v ?? '')
            }}
            beforeMount={setUpEditor}
            onMount={(editor, monaco) => {
              monacoRef.current = { editor, monaco }
              if (editor.getValue() !== shownRef.current) editor.setValue(shownRef.current)
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => applyDraftRef.current())
              // Monaco measures glyphs once; a web font that lands later
              // would leave the cursor out of step with the text.
              document.fonts.ready.then(() => monaco.editor.remeasureFonts())
            }}
            options={{
              minimap: { enabled: false },
              fontFamily: editorFont(),
              fontSize: 11,
              bracketPairColorization: { enabled: false },
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              // Follows the column as it is resized.
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              detectIndentation: false,
            }}
          />
        </div>
        {/* Centred over the script it is about, with room even when the editor is short. */}
        {problem && (
          <div
            role="alert"
            className="absolute inset-x-[2ch] top-1/2 z-20 flex max-h-[80%] min-h-[min(12lh,80%)] -translate-y-1/2 flex-col bg-white"
            style={{ boxShadow: '0 0 0 1px #000, 0 16px 44px rgb(0 0 0 / 0.3)' }}
          >
            <div className="flex shrink-0 items-center gap-[1ch] border-b border-black py-[0.25lh] pr-[1ch] pl-[2ch]">
              <span className="font-bold">✗ {problem.title}</span>
              {/* Select-all-and-copy, and one button that does the same for a
                  message too long to drag through. The text is kept raw. */}
              <button
                type="button"
                {...KEY}
                className="ml-auto"
                title="Copy the whole message"
                onClick={() => navigator.clipboard?.writeText(problem.text)}
              >
                copy
              </button>
              <button type="button" {...KEY} aria-label="Close" title="Close" onClick={clearProblem}>
                ✕
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto px-[2ch] py-[0.75lh] text-[11px] leading-snug break-words whitespace-pre-wrap">{plain(problem.text)}</pre>
          </div>
        )}
      </Panel>

      <details className="group shrink-0 border-t border-black py-[0.5lh]">
        <summary className="flex cursor-pointer list-none items-center gap-[1ch] select-none">
          <span className="font-bold">Map data</span>
          <span className="min-w-0 truncate opacity-60">OpenStreetMap · OpenFreeMap · Overpass</span>
          <span className="ml-auto transition-transform group-open:rotate-90">›</span>
        </summary>
        <ul className="mt-[0.5lh] opacity-60">
          <li>Features and sea: © OpenMapTiles © OpenStreetMap contributors, tiles from OpenFreeMap.</li>
          <li>With features.osm: © OpenStreetMap contributors, through Overpass.</li>
          <li>Basemap: © OpenMapTiles © OpenStreetMap contributors, Positron style from OpenFreeMap, drawn with MapLibre.</li>
        </ul>
      </details>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the column"
        title="Drag to resize · double-click to reset"
        className="absolute inset-y-0 left-0 z-10 hidden w-[7px] -translate-x-1/2 cursor-col-resize hover:bg-black/10 lg:block"
        onPointerDown={resize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
      />
    </aside>
  )
}
