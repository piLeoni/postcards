import { useMemo, useRef } from 'react'
import { PRESETS } from '../lib/presets'
import { injectStyleAtPlace, outputOf, styleOf, titleOf } from '../lib/doc'

const KEY = { 'size-': 'small', 'variant-': 'background1' }
const PRESET_STYLES = PRESETS.map((p) => [p, styleOf(p.doc)])

/**
 * The profile's style on the map: preset name when it matches, else the title
 * from the script. Opens the same preset list the sidebar used to carry.
 */
export default function StylePresetPicker({ doc, setDoc, onPlaceMap, onNotice }) {
  const menuRef = useRef(null)
  const style = useMemo(() => styleOf(doc), [doc])
  const preset = PRESET_STYLES.find(([, s]) => s === style)?.[0] ?? null
  const label = preset?.name ?? titleOf(doc) ?? 'style'

  const flash = (text) => onNotice?.(text)

  const loadPreset = (p) => {
    menuRef.current?.removeAttribute('open')
    setDoc(p.doc)
    const o = outputOf(p.doc)
    if (o?.kind === 'literal' && Number.isFinite(o.value?.lat) && Number.isFinite(o.value?.lng)) {
      onPlaceMap?.({ lat: o.value.lat, lng: o.value.lng, bearing: o.value.bearing })
    }
    flash(`Loaded ${p.name}`)
  }

  const injectPreset = (p) => {
    menuRef.current?.removeAttribute('open')
    const text = injectStyleAtPlace(doc, p.doc)
    setDoc(text)
    flash(`Injected ${p.name} here`)
  }

  return (
    <details ref={menuRef} is-="popover" className="relative">
      <summary
        title="Choose a drawing style"
        className="map-chip chrome-border inline-flex max-w-[min(45vw,20rem)] cursor-pointer list-none items-center gap-[0.75ch] border px-2 py-0.5 font-mono text-[11px] whitespace-nowrap select-none"
      >
        <span className="truncate font-bold">{preset ? preset.name : label}</span>
        <span className="text-[10px] opacity-60" aria-hidden>▾</span>
      </summary>
      <div position-="bottom baseline-left" className="chrome-surface chrome-border z-50 mt-1 min-w-[16rem] border chrome-raised">
        <ul className="editor-scroll m-0 max-h-[60vh] list-none divide-y divide-[color:var(--chrome-divider)] overflow-y-auto p-0 font-mono text-[11px]">
          {PRESETS.map((p) => (
            <li key={p.id} className="flex items-stretch">
              <button
                type="button"
                size-="small"
                variant-="background0"
                aria-current={p === preset || undefined}
                className={`h-auto min-w-0 flex-1 flex-col items-start justify-start px-[1ch] py-[0.5lh] text-left hover:bg-[var(--foreground0)] hover:text-[var(--background0)] hover:no-underline ${
                  p === preset ? 'bg-[var(--foreground0)]! text-[var(--background0)]!' : ''
                }`}
                onClick={() => loadPreset(p)}
              >
                <span className="font-bold">{p === preset ? `● ${p.name}` : p.name}</span>
                <span className="opacity-60">{p === preset ? `in use · ${p.hint}` : p.hint}</span>
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
                inject
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
