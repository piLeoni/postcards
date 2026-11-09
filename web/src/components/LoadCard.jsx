import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import DrawActionButton from './DrawActionButton'

/**
 * The draw's progress, as a card laid over the map: the lines the engine's
 * `Board` lays out, the very ones the command line paints in the terminal.
 * It sits over the map, not on the card, so a redraw does not put anything
 * inside the drawing that is about to be replaced. While the draw runs it
 * carries the same STOP as the card's DRAW button and the script column.
 */
export default function LoadCard({ load, onMin, onStop }) {
  const [now, setNow] = useState(() => performance.now())
  const scrollRef = useRef(null)
  const running = load.board.running()
  useEffect(() => {
    if (!running) return undefined
    let id = requestAnimationFrame(function tick() {
      setNow(performance.now())
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [running])

  const { tree, logs } = load.board.layout(now)
  const lines = [...tree, ...logs]

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines.length, running, now])

  return (
    <div className="chrome-surface pointer-events-auto w-full max-w-[48rem] p-[2ch] text-[11px] leading-snug chrome-modal-shadow">
      <div className="chrome-border mb-[0.5lh] flex items-center gap-[1ch] border-b pb-[0.5lh]">
        <span className="mr-auto font-bold">Drawing</span>
        {running && onStop && <DrawActionButton busy onStop={onStop} className="shrink-0" />}
        {onMin && (
          <span
            role="button"
            tabIndex={0}
            title="Put the card away into the corner; click it there to bring it back"
            aria-label="Put the progress card away"
            className="map-chip map-chip-bordered shrink-0 cursor-pointer border px-[0.4ch] font-mono"
            onClick={onMin}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onMin()
              }
            }}
          >
            −
          </span>
        )}
      </div>
      <div ref={scrollRef} className="editor-scroll max-h-[70vh] overflow-y-auto overflow-x-hidden">
        {lines.map((runs, i) => (
          <div key={i} className="overflow-hidden text-ellipsis whitespace-pre">
            {runs.map((r, j) => (
              <span
                key={j}
                className={r.bold ? 'font-bold' : ''}
                style={r.dim ? { color: 'var(--foreground2)' } : undefined}
              >
                {r.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
