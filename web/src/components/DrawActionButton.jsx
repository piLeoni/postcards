const RAISED = 'chrome-raised'

/**
 * DRAW / REGEN / STOP on the map card and in the script column — same chrome.
 */
export default function DrawActionButton({ busy, drawing, disabled, onDraw, onStop, className = '' }) {
  const act = busy ? onStop : onDraw
  const title = busy ? 'Stop the draw' : drawing ? 'Draw the selection again' : 'Draw the selection'

  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      title={title}
      aria-label={busy ? 'Stop the draw' : 'Draw the selection'}
      aria-disabled={disabled || undefined}
      className={`chrome-border inline-flex cursor-pointer items-center gap-[0.6ch] border px-2 py-0.5 font-mono text-[11px] font-bold whitespace-nowrap select-none ${
        busy ? 'map-chip' : 'map-chip-strong'
      } ${RAISED} ${disabled ? 'pointer-events-none opacity-45' : ''} ${className}`}
      onClick={disabled ? undefined : act}
      onKeyDown={(e) => {
        if (disabled || !act) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          act()
        }
      }}
    >
      {busy ? (
        <svg aria-hidden viewBox="0 0 12 12" className="h-[0.95em] w-[0.95em] shrink-0" fill="currentColor">
          <rect x="2" y="2" width="8" height="8" />
        </svg>
      ) : drawing ? (
        <svg aria-hidden viewBox="0 0 12 12" className="h-[0.95em] w-[0.95em] shrink-0">
          <path d="M10 6A4 4 0 1 1 8 2.54" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.56 3.44L6.68 3.62L8.28 0.85z" fill="currentColor" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 12 12" className="h-[0.95em] w-[0.95em] shrink-0" fill="currentColor">
          <path d="M2.5 1.5v9l8-4.5z" />
        </svg>
      )}
      {busy ? 'STOP' : drawing ? 'REGEN' : 'DRAW'}
    </span>
  )
}
