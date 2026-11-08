import { useMemo, useRef } from 'react'
import { PRESETS } from '../lib/presets'
import { injectStyleAtPlace, styleOf, titleOf } from '../lib/doc'

const PRESET_STYLES = PRESETS.map((p) => [p, styleOf(p.doc)])

/**
 * The profile's style on the map: applied script title (with · mod when it no
 * longer matches a preset verbatim). Choosing a preset injects its style here
 * and draws it (`onApplied`) once it has compiled.
 */
export default function StylePresetPicker({ doc, appliedDoc, setDoc, onNotice, onApplied }) {
  const menuRef = useRef(null)
  const shown = appliedDoc ?? doc
  const style = useMemo(() => styleOf(shown), [shown])
  const matchingPreset = PRESET_STYLES.find(([, s]) => s === style)?.[0] ?? null
  const scriptTitle = titleOf(shown)
  const presetTitle = matchingPreset ? titleOf(matchingPreset.doc) : null
  const modified =
    !matchingPreset || (scriptTitle != null && presetTitle != null && scriptTitle !== presetTitle)
  const labelBase = scriptTitle ?? matchingPreset?.name ?? 'style'
  const label = modified ? `${labelBase} · mod` : labelBase

  const flash = (text) => onNotice?.(text)

  const applyPreset = (p) => {
    menuRef.current?.removeAttribute('open')
    const text = injectStyleAtPlace(doc, p.doc)
    setDoc(text)
    // Draw the new style as soon as it has compiled: no REGEN to press.
    onApplied?.(text)
    flash(p.name)
  }

  const presetInUse = (p) => matchingPreset === p && !modified

  return (
    <details ref={menuRef} is-="popover" className="relative">
      <summary
        title="Choose a drawing style"
        className="map-chip chrome-border inline-flex cursor-pointer list-none items-center gap-[0.75ch] border px-2 py-0.5 font-mono text-[11px] font-bold whitespace-nowrap select-none"
      >
        <span>{label}</span>
        <span className="text-[10px] font-normal opacity-60" aria-hidden>▾</span>
      </summary>
      <div position-="bottom baseline-left" className="chrome-surface chrome-border z-50 mt-1 min-w-[16rem] border chrome-raised">
        <ul className="editor-scroll m-0 max-h-[60vh] list-none divide-y divide-[color:var(--chrome-divider)] overflow-y-auto p-0 font-mono text-[11px]">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                size-="small"
                variant-="background0"
                aria-current={presetInUse(p) || undefined}
                className={`h-auto w-full min-w-0 justify-start px-[1ch] py-[0.5lh] text-left font-bold hover:bg-[var(--foreground0)] hover:text-[var(--background0)] hover:no-underline ${
                  presetInUse(p) ? 'bg-[var(--foreground0)]! text-[var(--background0)]!' : ''
                }`}
                onClick={() => applyPreset(p)}
              >
                {presetInUse(p) ? `● ${p.name}` : p.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
