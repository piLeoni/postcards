import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import Editor from '@monaco-editor/react'
import { PRESETS, presetState } from '../lib/presets'
import { injectStyleAtPlace, outputOf, titleOf } from '../lib/doc'
import { sidebarWidthAtom, themeAtom } from '../lib/store'
import { defineEditorThemes, editorFont, editorThemeName } from '../lib/editorTheme'
import { registerProfileJavascriptTokenizer } from '../lib/profileJavascriptMonarch'
import LIBRARY from '../../../crates/drawland-script/drawland.d.ts?raw'
import Panel from './Panel'
import OutputControls, { SIDEBAR_WIDE_PX } from './OutputControls'
import DrawActionButton from './DrawActionButton'

/** WebTUI button looks: a grey key, and one that only shows on hover. */
const KEY = { 'size-': 'small', 'variant-': 'background1' }

/* ---------------------------------------------------------------- */
/*  Sidebar — the document, which is the output                       */
/* ---------------------------------------------------------------- */

/** The column's width on a wide screen, in px: dragged by its left edge, kept. */
const DEFAULT_WIDTH = 448
const MIN_WIDTH = 320
/** Narrow hint strip always visible at the map edge when the column is collapsed. */
const RAIL_PX = 12
const maxWidth = () => Math.round(window.innerWidth * 0.7)
const clampOpenWidth = (w) => Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()))
const pointerWidth = (clientX) =>
  Math.round(Math.min(Math.max(RAIL_PX, window.innerWidth - clientX), maxWidth()))
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
  defineEditorThemes(monaco)
  registerProfileJavascriptTokenizer(monaco.languages)
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

/** A file name from a title: `Parks and buildings` → `parks-and-buildings`. */
const slug = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export default function Sidebar({
  open,
  onClose,
  onOpen,
  onColumnDragChange,
  doc,
  setDoc,
  check,
  output,
  units,
  status,
  drawing,
  busy,
  onDraw,
  onDrawAfterApply,
  onFitAfterApply,
  onStop,
  onPlaceMap,
  onOutputKeys,
  onOutputToCentre,
  onCentreOnOutput,
  onOpenSearch,
  onMoveDrag,
}) {
  const [width, setWidth] = useAtom(sidebarWidthAtom)
  const [dragW, setDragW] = useState(null)
  const dragWRef = useRef(null)
  const [themeId] = useAtom(themeAtom)
  const readableEditor = themeId === 'silk' || themeId === 'abyss'
  const [selectionOpen, setSelectionOpen] = useState(true)
  const [scriptOpen, setScriptOpen] = useState(true)
  const [draft, setDraft] = useState(null)   // text typed but not applied yet
  const [notice, setNotice] = useState(null)   // { text, error? }
  const [problem, setProblem] = useState(null)   // { kind: 'apply' | 'draw', title, text }
  const monacoRef = useRef(null)   // { editor, monaco }
  // The editor's problems (type errors, warnings), kept current so they can be
  // copied in one go.
  const [markers, setMarkers] = useState([])
  const syncingRef = useRef(false)   // the editor is being brought to `shown`, not typed in
  const fileRef = useRef(null)
  const presetMenuRef = useRef(null)
  const noticeTimer = useRef(0)
  const applyDraftRef = useRef(() => {})

  useEffect(() => {
    monacoRef.current?.editor.updateOptions({
      bracketPairColorization: { enabled: readableEditor },
    })
  }, [readableEditor])

  const shown = draft ?? doc
  const shownRef = useRef(shown)
  shownRef.current = shown
  const dirty = draft != null && draft !== doc
  const title = titleOf(shown) ?? ''
  // The same name and match the card's style picker shows (`presetState`).
  const { label: presetLabel, inUse: presetInUse } = useMemo(() => presetState(shown), [shown])
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

  /**
   * A preset brings title, place, paper and style: the map goes to its place
   * at once, then — once the new output has compiled — is sized to it, and the
   * card is drawn, as a style picked on the card is.
   */
  const loadPreset = (p) => {
    presetMenuRef.current?.removeAttribute('open')
    setDoc(p.doc)
    setDraft(null)
    const o = outputOf(p.doc)
    if (o?.kind === 'literal' && Number.isFinite(o.value?.lat) && Number.isFinite(o.value?.lng)) {
      onPlaceMap?.({ lat: o.value.lat, lng: o.value.lng, bearing: o.value.bearing })
    }
    onFitAfterApply?.(p.doc)
    onDrawAfterApply?.(p.doc)
    flash(`Loaded ${p.name}`)
  }

  /** The preset's style and title, keeping the output already on the map. */
  const injectPreset = (p) => {
    presetMenuRef.current?.removeAttribute('open')
    if (p.ownPlace) return loadPreset(p)
    const text = injectStyleAtPlace(shown, p.doc)
    setDoc(text)
    setDraft(null)
    onDrawAfterApply?.(text)
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

  /** Every problem the editor marks, one per line: `Line 102:30 error: …`. */
  const copyProblems = async () => {
    const m = monacoRef.current?.monaco
    const word = (s) => (m && s === m.MarkerSeverity.Error ? 'error' : m && s === m.MarkerSeverity.Warning ? 'warning' : 'info')
    const text = markers
      .map((k) => `Line ${k.startLineNumber}:${k.startColumn} ${word(k.severity)}: ${String(k.message).replace(/\s+/g, ' ')}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      flash(`${markers.length} problem${markers.length === 1 ? '' : 's'} copied`)
    } catch {
      flash('The browser blocked the clipboard', true)
    }
  }

  const startResize = (fromButton) => (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onColumnDragChange?.(true)
    const startOpen = open
    const startW = startOpen ? width : RAIL_PX
    const startX = e.clientX
    let lastX = startX
    let moved = false
    let closing = null

    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4) return
      moved = true
      const dx = ev.clientX - lastX
      if (Math.abs(dx) >= 1) {
        closing = dx > 0
        lastX = ev.clientX
      }
      const w = pointerWidth(ev.clientX)
      dragWRef.current = w
      setDragW(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onColumnDragChange?.(false)
      if (!moved) {
        dragWRef.current = null
        setDragW(null)
        if (fromButton) {
          if (startOpen) onClose()
          else onOpen?.()
        }
        return
      }
      const lastW = dragWRef.current ?? startW
      dragWRef.current = null
      setDragW(null)
      if (lastW < MIN_WIDTH) {
        const shouldClose = closing ?? startOpen
        if (shouldClose) onClose()
        else {
          onOpen?.()
          setWidth(MIN_WIDTH)
        }
      } else {
        if (!startOpen) onOpen?.()
        setWidth(clampOpenWidth(lastW))
      }
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const shellW = dragW ?? (open ? width : RAIL_PX)
  const contentHidden = shellW <= RAIL_PX

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
      className={`fixed inset-x-0 bottom-0 z-40 flex h-[85vh] min-h-0 w-full min-w-0 flex-col border-t border-[color:var(--chrome-divider)] bg-[var(--background0)] pr-[max(2ch,env(safe-area-inset-right))] pl-[max(2ch,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom,0px)] transition-transform duration-200 sm:relative sm:z-30 sm:h-full sm:px-0 sm:pb-0 sm:shadow-[var(--chrome-panel-shadow)] sm:w-[var(--side-w)] sm:shrink-0 sm:translate-y-0 sm:pointer-events-auto sm:border-t-0 sm:border-l sm:border-[color:var(--chrome-divider)] ${
        open ? 'translate-y-0' : 'pointer-events-none translate-y-full sm:pointer-events-auto sm:translate-y-0'
      } ${dragW == null ? 'sm:transition-[width] sm:duration-200' : ''}`}
      style={{ '--side-w': `${shellW}px` }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={open ? 'Collapse script column' : 'Expand script column'}
        title={open ? 'Collapse script column · drag to resize' : 'Expand script column · drag to resize'}
        className="chrome-surface chrome-border absolute top-1/2 left-0 z-50 hidden h-9 w-9 -translate-x-[80%] -translate-y-1/2 cursor-pointer items-center justify-center border font-mono text-[15px] font-bold leading-none shadow-[var(--chrome-elevate)] select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)] sm:flex"
        onPointerDown={startResize(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (open) onClose()
            else onOpen?.()
          }
        }}
      >
        {open ? '>' : '<'}
      </span>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          // On a phone the sheet scrolls, as wide as the screen; on a wide
          // screen the column fits its window, and its content keeps
          // `MIN_WIDTH` (320px) while the column is dragged narrower.
          className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto pl-[max(2ch,14px)] pr-[2ch] pb-[env(safe-area-inset-bottom,0px)] sm:w-[max(100%,320px)] sm:overflow-hidden sm:pb-0 ${
            contentHidden ? 'pointer-events-none max-sm:hidden' : ''
          }`}
        >
      <Panel
        title="Selection"
        collapsible
        open={selectionOpen}
        onOpenChange={setSelectionOpen}
        className="shrink-0"
        aside={(
          <button type="button" aria-label="Close" className="sm:hidden" {...KEY} onClick={onClose}>✕</button>
        )}
      >
        <div
          className={`mb-[0.35lh] grid gap-1 font-mono text-[11px] ${
            width >= SIDEBAR_WIDE_PX ? 'grid-cols-3' : 'grid-cols-1'
          }`}
        >
          <span
            role="button"
            tabIndex={0}
            title="Find a place by address and move the selection there"
            className="chrome-field flex w-full cursor-pointer items-center justify-center gap-[0.6ch] px-1.5 py-0.5 select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)]"
            onClick={onOpenSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenSearch?.()
              }
            }}
          >
            <span aria-hidden>⌕</span>
            <span>search</span>
          </span>
          {!output?.computed && (
            <span
              role="button"
              tabIndex={0}
              title="Move the selection to the middle of the map"
              className="chrome-surface chrome-border flex w-full cursor-pointer items-center justify-center gap-[0.5ch] border px-1.5 py-0.5 whitespace-nowrap select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)]"
              onClick={onOutputToCentre}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOutputToCentre?.()
                }
              }}
            >
              <span aria-hidden>✥</span>
              <span>selection to map</span>
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            title="Move the map so the selection is in the middle"
            className="chrome-surface chrome-border flex w-full cursor-pointer items-center justify-center gap-[0.5ch] border px-1.5 py-0.5 whitespace-nowrap select-none hover:bg-[var(--foreground0)] hover:text-[var(--background0)]"
            onClick={onCentreOnOutput}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onCentreOnOutput?.()
              }
            }}
          >
            <span aria-hidden>⌖</span>
            <span>map to selection</span>
          </span>
        </div>
        {output && !output.computed ? (
          <OutputControls output={output} units={units} sidebarWidth={width} onEdit={onOutputKeys} onMove={onMoveDrag} />
        ) : output?.computed ? (
          <p className="opacity-60">Output computed by the script.</p>
        ) : null}
      </Panel>

      <Panel
        title={dirty ? 'Script ●' : 'Script'}
        collapsible
        open={scriptOpen}
        onOpenChange={setScriptOpen}
        // On a phone the sheet scrolls: the script takes its own height there.
        className={scriptOpen ? 'relative flex min-h-0 flex-1 flex-col max-sm:flex-none' : 'shrink-0'}
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
              {presetLabel} ▾
            </summary>
            <div className="chrome-surface chrome-border z-30 w-full border">
              <ul className="editor-scroll max-h-[60vh] divide-y divide-[color:var(--chrome-divider)] overflow-y-auto">
                {PRESETS.map((p) => (
                  <li key={p.id} className="flex items-stretch">
                    <button
                      type="button"
                      size-="small"
                      variant-="background0"
                      aria-current={presetInUse(p) || undefined}
                      className={`h-auto min-w-0 flex-1 flex-col items-start justify-start px-[1ch] py-[0.5lh] text-left hover:bg-[var(--foreground0)] hover:text-[var(--background0)] hover:no-underline ${
                        presetInUse(p) ? 'bg-[var(--foreground0)]! text-[var(--background0)]!' : ''
                      }`}
                      onClick={() => loadPreset(p)}
                    >
                      <span className="font-bold">{presetInUse(p) ? `● ${p.name}` : p.name}</span>
                      <span className="opacity-60">{presetInUse(p) ? `the style in use · ${p.hint}` : p.hint}</span>
                    </button>
                    <button
                      type="button"
                      size-="small"
                      variant-="background0"
                      title="Use this preset's layers here; keep the map position and paper"
                      aria-label={`Inject ${p.name} here`}
                      className="map-chip flex shrink-0 flex-row items-center justify-center gap-[0.5ch] self-stretch whitespace-nowrap border-b border-l border-[color:var(--chrome-divider)] px-[1ch] hover:no-underline"
                      onClick={() => injectPreset(p)}
                    >
                      <svg aria-hidden viewBox="0 0 12 12" className="h-[1em] w-[1em] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2.5v7M6 9.5l-2.5-2.5M6 9.5l2.5-2.5" />
                      </svg>
                      inject here
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <DrawActionButton
            className="ml-auto"
            busy={busy}
            drawing={drawing}
            disabled={!output || (!busy && !onDraw)}
            onDraw={run}
            onStop={onStop}
          />
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
        {/* `overflow: clip` with a margin, not `hidden`: the editor still cannot spill,
            but Monaco's tooltips over the find widget may paint just past the edge. */}
        <div className="chrome-border relative mt-[0.5lh] min-h-0 flex-1 overflow-clip border pt-[0.5lh] [overflow-clip-margin:2.5rem] max-sm:h-[60vh] max-sm:flex-none">
          <div className="absolute top-[0.5lh] right-[2ch] z-10 flex gap-[1ch]">
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
            {markers.length > 0 && (
              <button type="button" {...KEY} title="Copy every error and warning the editor marks, with its line" onClick={copyProblems}>
                copy {markers.length} problem{markers.length === 1 ? '' : 's'}
              </button>
            )}
            <button type="button" {...KEY} title="Copy the script" onClick={copy}>
              copy
            </button>
          </div>
          {/* Under the buttons, so the script can still be reverted or applied. */}
          {problem && <div aria-hidden className="absolute inset-0 z-[5] cursor-pointer bg-[color-mix(in_srgb,var(--background0)_65%,transparent)]" title="Close" onClick={clearProblem} />}
          <Editor
            height="100%"
            language="javascript"
            path="file:///profile.js"
            theme={editorThemeName(themeId)}
            defaultValue={shown}
            onChange={(v) => {
              if (!syncingRef.current) setDraft(v ?? '')
            }}
            beforeMount={setUpEditor}
            onMount={(editor, monaco) => {
              monacoRef.current = { editor, monaco }
              // Errors and warnings only (not hints), for "copy N problems".
              const readMarkers = () => {
                const model = editor.getModel()
                if (!model) return
                const all = monaco.editor.getModelMarkers({ resource: model.uri })
                setMarkers(all.filter((k) => k.severity >= monaco.MarkerSeverity.Warning).sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn))
              }
              monaco.editor.onDidChangeMarkers(readMarkers)
              readMarkers()
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
              bracketPairColorization: { enabled: readableEditor },
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
            className="chrome-surface absolute inset-x-[2ch] top-1/2 z-20 flex max-h-[80%] min-h-[min(12lh,80%)] -translate-y-1/2 flex-col chrome-modal-shadow"
          >
            <div className="chrome-border flex shrink-0 items-center gap-[1ch] border-b py-[0.25lh] pr-[1ch] pl-[2ch]">
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

      <details className="chrome-border group shrink-0 border-t py-[0.5lh]">
        <summary className="flex min-w-0 cursor-pointer list-none items-center gap-[1ch] overflow-hidden select-none whitespace-nowrap">
          <span className="shrink-0 font-bold">Map data</span>
          <span className="min-w-0 flex-1 truncate opacity-60">
            OpenStreetMap · OpenFreeMap · Overpass · terramask · penfill · burin
          </span>
          <span className="shrink-0 transition-transform group-open:rotate-90" aria-hidden>›</span>
        </summary>
        <ul className="mt-[0.5lh] space-y-[0.35lh] opacity-60">
          <li>Features and sea: © OpenMapTiles © OpenStreetMap contributors, tiles from OpenFreeMap.</li>
          <li>With features.osm: © OpenStreetMap contributors, through Overpass.</li>
          <li>Basemap: © OpenMapTiles © OpenStreetMap contributors, Positron style from OpenFreeMap, drawn with MapLibre.</li>
          <li>
            Vector tiles and terrain grids:{' '}
            <a href="https://github.com/piLeoni/terramask" target="_blank" rel="noreferrer" className="underline">
              terramask
            </a>
            .
          </li>
          <li>
            Pattern fills inside areas:{' '}
            <a href="https://github.com/piLeoni/penfill" target="_blank" rel="noreferrer" className="underline">
              penfill
            </a>
            .
          </li>
          <li>
            Elevation hatching and stippling:{' '}
            <a href="https://github.com/piLeoni/burin-map" target="_blank" rel="noreferrer" className="underline">
              burin-map
            </a>
            .
          </li>
        </ul>
      </details>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the column"
        title="Drag to resize · double-click to reset"
        className="absolute inset-y-0 left-0 z-40 hidden w-[7px] -translate-x-1/2 cursor-col-resize hover:bg-black/10 sm:block"
        onPointerDown={startResize(false)}
        onDoubleClick={() => {
          if (open) setWidth(DEFAULT_WIDTH)
        }}
      />
    </aside>
  )
}
