import { useAtom } from 'jotai'
import Editor from '@monaco-editor/react'
import { useMemo, useRef } from 'react'
import { GCODE_PRESETS, HBOT_MARLIN_TOML, parseGwriteToml, svgToGcode } from '../lib/gcode'
import { defineEditorTheme, EDITOR_THEME, editorFont } from '../lib/editorTheme'
import { gcodeConfigAtom } from '../lib/store'

const KEY = { 'size-': 'small', 'variant-': 'background1' }

const INPUT =
  'm-0 h-auto min-w-0 flex-1 border border-black px-[1ch] py-[0.4lh] font-mono text-[10px] leading-snug outline-none bg-black/[0.03] text-black/80 focus:border-black'

let tomlLanguageAdded = false

/** Register the small TOML subset used by vpype-gcode profiles. */
function setUpTomlEditor(monaco) {
  defineEditorTheme(monaco)
  if (tomlLanguageAdded) return
  monaco.languages.register({ id: 'toml' })
  monaco.languages.setMonarchTokensProvider('toml', {
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/\[\[?/, 'delimiter.square'],
        [/\]\]?/, 'delimiter.square'],
        [/[A-Za-z_][\w.-]*(?=\s*=)/, 'string.key'],
        [/[A-Za-z_][\w.-]*/, 'identifier'],
        [/=/, 'delimiter'],
        [/#.*$/, 'comment'],
        [/"""/, { token: 'string', next: '@multilineDouble' }],
        [/'{3}/, { token: 'string', next: '@multilineSingle' }],
        [/"([^"\\]|\\.)*$/, 'string'],
        [/'[^']*$/, 'string'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\b(true|false)\b/, 'keyword'],
        [/[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/, 'number'],
      ],
      multilineDouble: [
        [/"""/, { token: 'string', next: '@pop' }],
        [/./, 'string'],
      ],
      multilineSingle: [
        [/'{3}/, { token: 'string', next: '@pop' }],
        [/./, 'string'],
      ],
    },
  })
  tomlLanguageAdded = true
}

/**
 * Reusable `vpype-gcode` TOML configuration editor + bed placement controls.
 * Reads and persists to `gcodeConfigAtom` in `localStorage` by default, or
 * accepts controlled `config` / `onChange` props.
 */
export default function GcodeConfig({ config: controlledConfig, onChange, svgSample }) {
  const [storedConfig, setStoredConfig] = useAtom(gcodeConfigAtom)
  const config = controlledConfig ?? storedConfig
  const updateConfig = (patch) => {
    const next = { ...config, ...patch }
    if (onChange) onChange(next)
    else setStoredConfig(next)
  }

  const fileInputRef = useRef(null)
  const presetMenuRef = useRef(null)

  const tomlText = config?.toml ?? HBOT_MARLIN_TOML
  const fitMarginMm = config?.fitMarginMm ?? ''
  const ext = config?.ext === 'gcode' ? 'gcode' : 'gco'

  const diagnostics = useMemo(() => {
    try {
      const parsed = parseGwriteToml(tomlText)
      if (svgSample) {
        const res = svgToGcode(svgSample, {
          toml: tomlText,
          fitMarginMm,
          filename: `preview.${ext}`,
        })
        return { ok: true, parsed, preview: res }
      }
      return { ok: true, parsed, preview: null }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  }, [tomlText, fitMarginMm, ext, svgSample])

  const onLoadFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    updateConfig({ toml: text })
  }

  const onSaveToml = () => {
    const name = diagnostics.ok ? diagnostics.parsed.profileName : 'plotter'
    const blob = new Blob([tomlText], { type: 'application/toml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.toml`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const preview = diagnostics.ok ? diagnostics.preview : null
  const bounds = preview?.bounds

  return (
    <div className="flex flex-col gap-[1.25lh]">
      <fieldset className="m-0 border-0 p-0">
        <div className="relative mb-[0.5lh] flex flex-wrap items-center gap-[1ch]">
          <legend className="m-0 p-0 font-bold">Plotter profile (vpype-gcode TOML)</legend>
          <div className="ml-auto flex items-center gap-[0.5ch]">
            {/* Same shared popover shape as the profile preset menu. */}
            <details ref={presetMenuRef} is-="popover" className="static">
              <summary is-="button" {...KEY} title="Replace this TOML with a starter plotter profile">
                presets ▾
              </summary>
              <div className="z-30 w-full border border-black bg-white">
                <ul className="divide-y divide-black">
                  {GCODE_PRESETS.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        size-="small"
                        variant-="background0"
                        className="h-auto min-w-0 w-full justify-start px-[1ch] py-[0.5lh] text-left hover:bg-black hover:text-white hover:no-underline"
                        onClick={() => {
                          updateConfig({ toml: p.toml })
                          presetMenuRef.current?.removeAttribute('open')
                        }}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
            <button
              type="button"
              {...KEY}
              title="Load a vpype-gcode .toml profile from disk"
              onClick={() => fileInputRef.current?.click()}
            >
              load
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".toml,text/plain"
              className="hidden"
              onChange={onLoadFile}
            />
            <button
              type="button"
              {...KEY}
              title="Save this TOML profile to disk"
              onClick={onSaveToml}
            >
              save
            </button>
          </div>
        </div>

        <div className="h-[18lh] min-h-[12lh] resize-y overflow-hidden border border-black">
          <Editor
          height="100%"
          language="toml"
          path="file:///plotter.toml"
          theme={EDITOR_THEME}
          value={tomlText}
          beforeMount={setUpTomlEditor}
          onChange={(value) => updateConfig({ toml: value ?? '' })}
          options={{
            minimap: { enabled: false },
            fontFamily: editorFont(),
            fontSize: 11,
            bracketPairColorization: { enabled: false },
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            fixedOverflowWidgets: true,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            detectIndentation: false,
          }}
          />
        </div>

        {!diagnostics.ok ? (
          <p className="m-0 mt-[0.5lh] font-bold text-red-700">{diagnostics.error}</p>
        ) : (
          <div className="mt-[0.5lh] flex flex-col gap-[0.25lh] text-[11px]">
            <p className="m-0 opacity-65">
              Profile <span className="font-bold">[gwrite.{diagnostics.parsed.profileName}]</span>
              {preview && (
                <>
                  {' · '}
                  {preview.lineCount.toLocaleString()} lines ({preview.segmentCount.toLocaleString()} pts)
                </>
              )}
            </p>
            {bounds && (
              <p className={`m-0 ${bounds.outOfBounds ? 'font-bold text-red-700' : 'opacity-65'}`}>
                Spans X {bounds.minX.toFixed(1)}..{bounds.maxX.toFixed(1)} Y {bounds.minY.toFixed(1)}..
                {bounds.maxY.toFixed(1)}
                {preview.bedWidthMm > 0 && preview.bedHeightMm > 0
                  ? ` (bed ${preview.bedWidthMm}×${preview.bedHeightMm} mm)`
                  : ''}
                {bounds.outOfBounds ? ' — WARNING: outside bed, set Fit margin below to scale down' : ''}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-[2ch]">
        <fieldset className="m-0 min-w-[24ch] flex-1 border-0 p-0">
          <legend className="mb-[0.5lh] font-bold">Fit to bed margin (mm)</legend>
          <div className="flex flex-wrap items-center gap-[1ch]">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              placeholder="1:1"
              aria-label="Margin in millimetres to scale drawing to bed, empty for 1:1"
              className={`${INPUT} max-w-[12ch]`}
              value={fitMarginMm}
              onChange={(e) => updateConfig({ fitMarginMm: e.target.value })}
            />
            <span className="opacity-60">empty = 1:1 (SVG mm kept)</span>
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-[0.5lh] font-bold">Extension</legend>
          <div className="flex gap-[1ch]">
            {['gco', 'gcode'].map((e) => (
              <button
                key={e}
                type="button"
                size-="small"
                variant-={ext === e ? 'foreground0' : 'background1'}
                onClick={() => updateConfig({ ext: e })}
              >
                .{e}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  )
}
