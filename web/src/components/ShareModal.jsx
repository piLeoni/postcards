import { useEffect, useMemo, useState } from 'react'
import { hasStore, shareOptions, storeScript } from '../lib/share'

/** WebTUI button looks, the same key the other dialogs use. */
const KEY = { 'size-': 'small', 'variant-': 'background1' }

/**
 * The share sheet: the two ways to share the applied script, each with what it
 * is for. A dialog in the middle of the app — the same sheet the load and
 * search panels wear, one white page on a dimmed map — because the choice
 * needs a sentence of explanation, and the chosen link is worth showing before
 * it is copied.
 *
 * The link that carries the script in it is the one whose length matters (it
 * has to fit in a URL), so it is the only one that shows a length. The short
 * link names a stored copy and is short by construction.
 */
export default function ShareModal({ open, onClose, doc }) {
  const [copied, setCopied] = useState(null)   // the option id last copied
  const [busy, setBusy] = useState(null)       // the option id being prepared
  const [short, setShort] = useState(null)     // the resolved short link, once asked for
  const [error, setError] = useState(null)

  // A fresh sheet every time it opens: the script may have changed, and a link
  // from the last open would be a stale answer.
  useEffect(() => {
    if (open) {
      setCopied(null)
      setBusy(null)
      setShort(null)
      setError(null)
    }
  }, [open])

  // Escape closes from anywhere, like the other dialogs.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const options = useMemo(() => (open ? shareOptions(doc) : []), [open, doc])
  if (!open) return null

  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setError(null)
    } catch {
      setError('The browser blocked the clipboard')
    }
  }

  const doCopy = async (o) => {
    // The short link is only made when it is asked for: storing is the one
    // action here that touches the network, and the URL form needs none.
    if (o.id !== 'stored' || short) return copy(short ?? o.link, 'stored')
    setBusy('stored')
    setError(null)
    try {
      const link = await storeScript(doc)
      if (!link) throw new Error('refused')
      setShort(link)
      await copy(link, 'stored')
    } catch {
      setError('Couldn’t make the short link. The full link still works.')
    } finally {
      setBusy(null)
    }
  }

  const linkOf = (o) => (o.id === 'stored' && short ? short : o.link)
  const storedReady = hasStore()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share this script"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/25 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[min(88ch,100%)] flex-col bg-white font-mono text-[12px]"
        style={{ boxShadow: '0 0 0 1px #000, 0 16px 44px rgb(0 0 0 / 0.3)' }}
      >
        <div className="flex shrink-0 items-center gap-[1ch] border-b border-black py-[0.5lh] pr-[1ch] pl-[2ch]">
          <span className="font-bold tracking-[0.2em]">SHARE</span>
          <span className="min-w-0 truncate opacity-60">send this script to someone</span>
          <button type="button" {...KEY} className="ml-auto" aria-label="Close" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* One choice per row, not side by side: a row is the same shape
            whether its link is there or not, so the two never have to line up. */}
        <div className="grid min-h-0 gap-0 overflow-y-auto">
          {options.map((o) => {
            const link = linkOf(o)
            const ready = o.id === 'stored' ? storedReady : o.ok
            return (
              <div key={o.id} className="flex min-w-0 flex-col gap-[0.5lh] border-b border-black/20 p-[2ch] last:border-b-0">
                <div className="flex items-baseline gap-[1ch]">
                  <span className="font-bold">{o.title}</span>
                  <span className="min-w-0 truncate opacity-70">{o.hint}</span>
                  {/* Only the full link's length matters: it has to fit a URL. */}
                  {o.id === 'url' && o.ok && link && (
                    <span className="ml-auto shrink-0 opacity-50">{link.length} characters</span>
                  )}
                </div>

                <div className="flex items-center gap-[1ch]">
                  {/* A link is one line, like a line in the editor: it scrolls
                      sideways rather than wrapping down. Without a link it
                      holds a dimmed stand-in, so the row is the same shape. */}
                  <input
                    readOnly
                    value={link ?? o.placeholder ?? ''}
                    spellCheck={false}
                    aria-label={o.id === 'stored' ? 'The short link' : 'The link'}
                    title={link ?? undefined}
                    placeholder='#'
                    onFocus={(e) => link && e.target.select()}
                    onClick={(e) => link && e.target.select()}
                    className={`m-0 h-auto min-w-0 flex-1 border border-black px-[1ch] py-[0.4lh] font-mono text-[10px] leading-snug outline-none ${
                      link ? 'bg-black/[0.03] text-black/80 focus:border-black' : 'bg-black/[0.02] text-black/30'
                    }`}
                  />
                  <button
                    type="button"
                    size-="small"
                    variant-={ready ? 'foreground0' : 'background1'}
                    disabled={!ready || busy === o.id}
                    title={ready ? 'Copy this link' : undefined}
                    onClick={() => doCopy(o)}
                  >
                    {busy === o.id ? 'making…' : copied === o.id ? 'copied ✓' : 'copy'}
                  </button>
                </div>

                {o.why && <p className="m-0 text-black/50">{o.why}</p>}
              </div>
            )
          })}
        </div>

        {/* The footer only ever says something when a copy failed; the two
            choices explain themselves above it. */}
        {error && (
          <p className="shrink-0 border-t border-black py-[0.5lh] pr-[2ch] pl-[2ch] font-bold">{error}</p>
        )}
      </div>
    </div>
  )
}
