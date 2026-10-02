import { useEffect, useState } from 'react'

/**
 * The draw's progress, as a card laid over the map: the lines the engine's
 * `Board` lays out, the very ones the command line paints in the terminal.
 * It sits over the map, not on the card, so a redraw does not put anything
 * inside the drawing that is about to be replaced.
 */
export default function LoadCard({ title, load }) {
  const [now, setNow] = useState(() => performance.now())
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
  return (
    <div
      className="w-full max-w-[48rem] bg-white p-[2ch] text-[11px] leading-snug text-black"
      style={{ boxShadow: '0 0 0 1px #000, 0 12px 32px rgb(0 0 0 / 0.18)' }}
    >
      <div className="mb-[0.5lh] flex gap-[1ch] border-b border-black pb-[0.5lh]">
        <span className="mr-auto font-bold">Drawing</span>
        <span className="truncate">{title}</span>
      </div>
      <div className="max-h-[70vh] overflow-hidden">
        {lines.map((runs, i) => (
          <div key={i} className="overflow-hidden text-ellipsis whitespace-pre">
            {runs.map((r, j) => (
              <span key={j} className={r.bold ? 'font-bold' : ''} style={r.dim ? { color: '#555' } : undefined}>
                {r.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
