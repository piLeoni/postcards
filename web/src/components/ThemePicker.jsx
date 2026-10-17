import { useRef } from 'react'
import { THEME_LIST } from '../lib/themes'

const KEY = { 'size-': 'small', 'variant-': 'background1' }

/** Three paper shades on the inverted key (reads like the palette swatch). */
function PaletteMark() {
  return (
    <span className="inline-flex items-baseline gap-0 leading-none tracking-tighter" aria-hidden>
      <span style={{ color: 'var(--background3)' }}>■</span>
      <span style={{ color: 'var(--background2)' }}>■</span>
    </span>
  )
}

export default function ThemePicker({ value, onChange }) {
  const rootRef = useRef(null)

  const pick = (id) => {
    onChange(id)
    rootRef.current?.removeAttribute('open')
  }

  return (
    <details ref={rootRef} is-="popover" className="relative">
      <summary is-="button" {...KEY} title="Colour palette" aria-label="Colour palette">
        <span className="inline-flex items-center gap-[0.35ch]">
          <PaletteMark />
          <span className="text-[10px] leading-none opacity-60" aria-hidden>▾</span>
        </span>
      </summary>
      <div
        position-="bottom baseline-right"
        className="chrome-surface chrome-border z-50 mt-[0.25lh] min-w-[12rem] border"
      >
        <ul className="m-0 list-none divide-y divide-[color:var(--chrome-divider)] p-0">
          {THEME_LIST.map((t) => (
            <li key={t.id} className="flex items-stretch">
              <button
                type="button"
                size-="small"
                variant-="background0"
                aria-current={value === t.id || undefined}
                className={`h-auto w-full min-w-0 justify-start px-[1ch] py-[0.5lh] text-left hover:bg-[var(--foreground0)] hover:text-[var(--background0)] hover:no-underline ${
                  value === t.id ? 'bg-[var(--foreground0)]! text-[var(--background0)]!' : ''
                }`}
                onClick={() => pick(t.id)}
              >
                <span className={value === t.id ? 'font-bold' : ''}>{value === t.id ? `● ${t.label}` : t.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
