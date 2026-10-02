import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { PRESETS } from '../lib/presets'
import { setCardKeys } from '../lib/doc'
import { EDITOR_THEME, defineEditorTheme, editorFont } from '../lib/editorTheme'
import Panel from './Panel'

/** WebTUI button looks: a grey key, and one that only shows on hover. */
const KEY = { 'size-': 'small', 'variant-': 'background1' }

/* ---------------------------------------------------------------- */
/*  Sidebar — the document, which is the card                       */
/* ---------------------------------------------------------------- */

/** The column's width on a wide screen, in px: dragged by its left edge, kept. */
const WIDTH_KEY = 'postcards.sidebarWidth'
const MIN_WIDTH = 320
const clampWidth = (w) => Math.round(Math.min(Math.max(w, MIN_WIDTH), window.innerWidth * 0.7))
const REPO = 'https://github.com/piLeoni/postcards'
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1)

export default function Sidebar({ open, onClose, doc, setDoc, card, status, drawing, busy, onDraw }) {
  const [width, setWidth] = useState(() => clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || 448))
  const [expanded, setExpanded] = useState(false)   // the editor widened to the most the column takes
  const [draft, setDraft] = useState(null)   // text typed but not applied yet
  const [notice, setNotice] = useState(null)   // { text, error? }
  const fileRef = useRef(null)
  const presetMenuRef = useRef(null)
  const noticeTimer = useRef(0)
  const applyDraftRef = useRef(() => {})

  const shown = draft ?? doc
  const dirty = draft != null && draft !== doc

  // A drag or a preset rewrites the document; an edit in progress stays.
  useEffect(() => {
    if (draft === doc) setDraft(null)
  }, [doc, draft])

  const flash = (text, isError = false) => {
    clearTimeout(noticeTimer.current)
    setNotice({ text, error: isError })
    noticeTimer.current = setTimeout(() => setNotice(null), isError ? 8000 : 3000)
  }

  const applyDraft = () => {
    if (!dirty) return
    setDoc(draft)
    setDraft(null)
  }
  applyDraftRef.current = applyDraft

  /** A preset brings its style; the card stays where you put it. */
  const loadPreset = (p) => {
    presetMenuRef.current?.removeAttribute('open')
    setDoc(card ? setCardKeys(p.doc, { lat: card.lat, lng: card.lng }) : p.doc)
    setDraft(null)
    flash(`Loaded ${p.name}`)
  }

  const importFile = async (file) => {
    if (!file) return
    setDoc(await file.text())
    setDraft(null)
    flash(`Loaded ${file.name}`)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([shown], { type: 'application/yaml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'postcard.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown)
      flash('YAML copied')
    } catch {
      flash('The browser blocked the clipboard', true)
    }
  }

  const resize = (e) => {
    e.preventDefault()
    setExpanded(false)
    const move = (ev) => setWidth(clampWidth(window.innerWidth - ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w))
        return w
      })
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const groups = drawing?.groups ?? []
  const strokes = useMemo(() => groups.reduce((n, [, s]) => n + s, 0), [groups])
  const empty = groups.filter(([, n]) => n === 0).map(([id]) => id)

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
          ? `Drawn in ${drawing.ms} ms · ${strokes.toLocaleString('en-US')} strokes · ${(drawing.svg.length / 1e6).toFixed(1)} MB`
          : 'Not drawn yet'

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-40 flex h-[85vh] min-h-0 w-full min-w-0 flex-col border-t border-black bg-white px-[2ch] transition-transform duration-200 lg:relative lg:z-auto lg:h-full lg:w-[var(--side-w)] lg:shrink-0 lg:translate-y-0 lg:pointer-events-auto lg:border-t-0 lg:border-l ${
        open ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      }`}
      style={{ color: '#000', backgroundColor: '#fff', '--side-w': `${expanded ? clampWidth(Infinity) : width}px` }}
    >
      <Panel
        title="Postcards"
        className="shrink-0"
        aside={(
          <>
            <a is-="button" {...KEY} href={REPO} target="_blank" rel="noreferrer" title={REPO}>
              GitHub
            </a>
            <button type="button" aria-label="Close" {...KEY} className="lg:hidden" onClick={onClose}>✕</button>
          </>
        )}
      >
        <p className="mb-[0.5lh] opacity-60">
          Map postcards drawn for a pen plotter. Put the card where you want it
          on the map, then generate it; the config below is the whole card.
        </p>
        <div className="relative flex shrink-0 flex-wrap gap-[1ch]">
          <button type="button" {...KEY} title="Open a YAML config" onClick={() => fileRef.current?.click()}>
            import
          </button>
          <button type="button" {...KEY} title="Save as postcard.yaml" onClick={download}>
            download
          </button>
          {/* Static, so the menu opens under the whole row rather than this button. */}
          <details ref={presetMenuRef} is-="popover" className="static">
            <summary is-="button" {...KEY} title="Replace the style with a ready-made one; the card stays where it is">
              presets ▾
            </summary>
            <div className="z-30 w-full border border-black bg-white">
              <ul className="max-h-[60vh] divide-y divide-black overflow-y-auto">
                {PRESETS.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      size-="small"
                      variant-="background0"
                      className="h-auto w-full flex-col items-start justify-start px-[1ch] py-[0.5lh] text-left hover:bg-black hover:text-white hover:no-underline"
                      onClick={() => loadPreset(p)}
                    >
                      <span className="font-bold">{p.name}</span>
                      <span className="opacity-60">{p.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,.txt"
            className="hidden"
            onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }}
          />
        </div>
        {notice && (
          <p className={`mt-[0.5lh] shrink-0 break-words ${notice.error ? 'font-bold' : 'opacity-60'}`}>
            {notice.error ? `✗ ${sentence(notice.text)}` : sentence(notice.text)}
          </p>
        )}
      </Panel>

      <Panel
        title={dirty ? 'Config ●' : 'Config'}
        className="flex min-h-0 flex-1 flex-col"
        aside={(
          <span
            className={`min-w-0 truncate ${dirty || failed ? 'font-bold' : 'opacity-60'}`}
            title={dirty ? undefined : statusText}
          >
            {dirty ? 'Edited, not applied' : failed ? `✗ ${statusText}` : `${drawing ? '●' : '○'} ${statusText}`}
          </span>
        )}
      >
        <div className="flex shrink-0 gap-[1ch]">
          <button type="button" {...KEY} disabled={!dirty} onClick={() => setDraft(null)}>
            revert
          </button>
          <button type="button" size-="small" variant-={dirty ? 'foreground0' : 'background1'} disabled={!dirty} title="⌘/Ctrl + Enter" onClick={applyDraft}>
            apply
          </button>
          <button type="button" {...KEY} title="Copy the config" onClick={copy}>
            copy
          </button>
          <button
            type="button"
            size-="small"
            variant-={busy ? 'background1' : 'foreground0'}
            className="ml-auto"
            disabled={busy || !card}
            onClick={onDraw}
          >
            {drawing ? 'REGENERATE CARD' : 'GENERATE CARD'}
          </button>
        </div>
        {!dirty && empty.length > 0 && (
          <p className="mt-[0.5lh] shrink-0 break-words">! Nothing drawn for {empty.join(', ')}</p>
        )}
        <div className="relative mt-[0.5lh] min-h-0 flex-1 overflow-hidden border border-black pt-[0.5lh]">
          <button
            type="button"
            {...KEY}
            className="absolute top-[0.25lh] right-[1ch] z-10 hidden lg:inline-flex"
            title={expanded ? 'Back to the column width' : 'Widen the editor'}
            aria-label={expanded ? 'Narrow the editor' : 'Widen the editor'}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? '⤡' : '⤢'}
          </button>
          <Editor
            height="100%"
            language="yaml"
            theme={EDITOR_THEME}
            value={shown}
            onChange={(v) => setDraft(v ?? '')}
            beforeMount={defineEditorTheme}
            onMount={(editor, monaco) => {
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
      </Panel>

      <details className="group shrink-0 border-t border-black py-[0.5lh]">
        <summary className="flex cursor-pointer list-none items-center gap-[1ch] select-none">
          <span className="font-bold">Map data</span>
          <span className="min-w-0 truncate opacity-60">OpenStreetMap · Overpass · OpenFreeMap · Mapbox</span>
          <span className="ml-auto transition-transform group-open:rotate-90">›</span>
        </summary>
        <ul className="mt-[0.5lh] opacity-60">
          <li>Features: © OpenStreetMap contributors, through Overpass.</li>
          <li>Sea: © OpenMapTiles © OpenStreetMap contributors, tiles from OpenFreeMap.</li>
          <li>Basemap: © Mapbox © OpenStreetMap.</li>
        </ul>
      </details>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the column"
        title="Drag to resize · double-click to reset"
        className="absolute inset-y-0 left-0 z-10 hidden w-[7px] -translate-x-1/2 cursor-col-resize hover:bg-black/10 lg:block"
        onPointerDown={resize}
        onDoubleClick={() => {
          setExpanded(false)
          setWidth(448)
          localStorage.removeItem(WIDTH_KEY)
        }}
      />
    </aside>
  )
}
