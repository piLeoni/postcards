import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchDocs } from '../lib/docSearch.js'

/**
 * The documentation's search: a button at the top of the index that opens a
 * sheet over the page, its input and results in it. It searches the page as
 * rendered (`sectionsOf`): every heading with an id and the text under it,
 * so the tutorial, the patterns and each reference entry are found without
 * an index kept beside them. Picking a result closes the sheet and scrolls to
 * that heading.
 *
 * `/` or ⌘/Ctrl-K opens it; arrows move, Enter opens a result, Escape or a
 * click on the scrim closes it.
 */
export default function DocSearch({ articleRef }) {
  const [open, setOpen] = useState(false)
  // Read once, on the first query: the page's sections do not change.
  const sectionsRef = useRef(null)
  const sections = useCallback(() => (sectionsRef.current ??= sectionsOf(articleRef.current)), [articleRef])

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {/* A key, not a field: the typing happens in the sheet it opens. */}
      <button
        type="button"
        size-="small"
        variant-="background1"
        className="mb-[1lh] gap-[1ch]"
        title="Search the documentation (/ or ⌘K)"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden>⌕</span>
        <span>search</span>
        <kbd className="text-[10px] opacity-50">/</kbd>
      </button>
      {/* On the body: the index is sticky, a stacking context of its own, and
          the page's cards would paint over a sheet left inside it. */}
      {open ? createPortal(<SearchSheet sections={sections} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}

/** The sheet over the page: the query and its results. Mounted while open, so each opening starts empty. */
function SearchSheet({ sections, onClose }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const listRef = useRef(null)

  const results = useMemo(() => {
    if (!query.trim()) return []
    return searchDocs(sections(), query)
  }, [query, sections])

  useEffect(() => setAt(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const go = (id) => {
    onClose()
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
    // The heading in the address bar, as its own link would put it, without
    // a navigation (with `#docs`, a new hash would leave the page).
    if (location.pathname.startsWith('/docs')) history.replaceState(null, '', `#${id}`)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') setAt((i) => Math.min(i + 1, results.length - 1))
    else if (e.key === 'ArrowUp') setAt((i) => Math.max(i - 1, 0))
    else if (e.key === 'Enter' && results[at]) go(results[at].id)
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search the documentation"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--overlay-scrim)] p-6 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="chrome-surface chrome-modal-shadow flex max-h-[76vh] w-full max-w-[min(72ch,100%)] flex-col">
        <label className="chrome-border flex shrink-0 items-center gap-[1ch] border-b px-[2ch] py-[0.5lh]">
          <span aria-hidden className="shrink-0 opacity-60">⌕</span>
          <input
            autoFocus
            type="search"
            value={query}
            placeholder="search the docs…"
            aria-label="Search the documentation"
            aria-controls="doc-search-results"
            className="min-w-0 flex-1 appearance-none bg-transparent outline-none placeholder:opacity-50 [&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="shrink-0 text-[10px] opacity-40">esc</kbd>
        </label>
        {query.trim() ? (
          <ul ref={listRef} id="doc-search-results" role="listbox" className="min-h-0 overflow-y-auto py-[0.5lh]">
            {results.length ? (
              results.map((r, i) => (
                <li key={r.id} role="option" aria-selected={i === at}>
                  <a
                    href={`#${r.id}`}
                    className={`block px-[2ch] py-[0.4lh] no-underline hover:bg-[var(--background1)] ${i === at ? 'bg-[var(--background1)]' : ''}`}
                    onMouseEnter={() => setAt(i)}
                    onClick={(e) => {
                      e.preventDefault()
                      go(r.id)
                    }}
                  >
                    <span className="block font-bold">{r.title}</span>
                    {r.parent ? <span className="block text-[10px] tracking-[0.15em] uppercase opacity-50">{r.parent}</span> : null}
                    <span className="mt-[0.15lh] block text-[0.9em] leading-snug opacity-70">
                      {r.snippet.before}
                      {r.snippet.match ? <mark className="bg-transparent font-bold underline">{r.snippet.match}</mark> : null}
                      {r.snippet.after}
                    </span>
                  </a>
                </li>
              ))
            ) : (
              <li className="px-[2ch] py-[0.5lh] opacity-60">nothing found</li>
            )}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The page's sections: each `h2`/`h3` with an id and the text up to the next
 * one. An `h3`'s parent is the `h2` above it.
 */
function sectionsOf(article) {
  if (!article) return []
  const headings = [...article.querySelectorAll('h2[id], h3[id]')]
  let parent = ''
  return headings.map((h, i) => {
    // The heading's own text, without the `#` its anchor shows on hover.
    const title = h.textContent.replace(/\s*#\s*$/, '').trim()
    if (h.tagName === 'H2') parent = title
    const range = document.createRange()
    range.setStartAfter(h)
    if (headings[i + 1]) range.setEndBefore(headings[i + 1])
    else range.setEndAfter(article.lastChild)
    return { id: h.id, title, parent: h.tagName === 'H3' ? parent : '', text: textIn(range) }
  })
}

/**
 * The text in `range`, a space between blocks: `range.toString()` runs a
 * swatch's name into its description ("them.grassScattered").
 */
function textIn(range) {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root.nodeType === 1 ? root : root.parentNode, NodeFilter.SHOW_TEXT)
  let text = ''
  let block = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue
    const b = blockOf(n.parentElement)
    text += (b === block ? '' : ' ') + n.data
    block = b
  }
  return text
}

/**
 * The block a text node is laid out in: its nearest ancestor that is not
 * inline. Read from the layout, not the tag, since the swatches' name and
 * description are spans in a flex column, and so blocks.
 */
function blockOf(el) {
  while (el.parentElement && /^(inline|contents)$/.test(getComputedStyle(el).display)) el = el.parentElement
  return el
}
