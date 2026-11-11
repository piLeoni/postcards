import { useMemo, useState } from 'react'
import { highlight } from './highlight.js'

/**
 * The documentation's text and code, in the page's own style.
 *
 * Code blocks are highlighted here, not by Monaco: a block is a fixed snippet,
 * so the tokenizer (`highlight.js`) runs once and the editor's own scale is
 * applied as classes (`.flame` in `index.css`). Copying is offered because the
 * reader usually wants the snippet in the editor.
 */

/** Inline code: `text`.
 *
 * Short, and on the same line, so it cannot be clicked and is not a block: a
 * name in a sentence, not something to copy whole.
 */
export function C({ children }) {
  return <code className="thin bg-[var(--background1)] px-[0.5ch] whitespace-nowrap">{children}</code>
}

/** A code block, with a copy button.
 *
 * Long enough that the reader may want it in the editor: the whole block is
 * one click away, and the language, when it is not JavaScript, is named in
 * the corner (`rust`, `bash`, `python`, `json`, `text`).
 */
export function Code({ children, lang = 'js', title }) {
  const [copied, setCopied] = useState(false)
  const text = textOf(children)
  // Highlighted once per snippet: the page's blocks never change.
  const html = useMemo(() => ({ __html: highlight(text, lang) }), [text, lang])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // A page without the clipboard permission (or not on https) still lets
      // the reader select the text; say so rather than pretend it copied.
      setCopied(false)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <figure className="thin my-[1lh]">
      <div className="flex items-center gap-[1ch] border-b border-black bg-[var(--background1)] px-[1ch] py-[0.25lh]">
        <span className="text-[10px] tracking-[0.15em] uppercase opacity-60">{lang}</span>
        {title ? <span className="truncate opacity-60">{title}</span> : null}
        <button
          type="button"
          size-="small"
          variant-="background0"
          className="ml-auto"
          onClick={copy}
          title="Copy this block"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="flame overflow-x-auto px-[1ch] py-[0.5lh]">
        <code dangerouslySetInnerHTML={html} />
      </pre>
    </figure>
  )
}

/** The text of `children`, for the clipboard.
 *
 * The block is written as JSX (`{'…'}` in places), so React's own text is
 * read from the nodes instead of from the source.
 */
function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) return textOf(node.props.children)
  return ''
}

/** A heading with an anchor: linking to it scrolls here. */
export function H({ id, children, level = 2 }) {
  const Tag = `h${level}`
  return (
    <Tag id={id} className={`group scroll-mt-[2lh] ${level === 2 ? 'mt-[3lh] mb-[1lh] text-[1.4em]' : 'mt-[2lh] mb-[0.5lh] text-[1.15em]'} font-bold`}>
      <a href={`#${id}`} className="no-underline hover:underline">
        {children}
        <span className="ml-[1ch] opacity-0 group-hover:opacity-40">#</span>
      </a>
    </Tag>
  )
}

export function P({ children }) {
  return <p className="my-[1lh] max-w-[80ch] leading-relaxed">{children}</p>
}

export function UL({ children }) {
  return <ul className="my-[1lh] flex max-w-[80ch] flex-col gap-[0.5lh]">{children}</ul>
}

export function LI({ children }) {
  return <li className="leading-relaxed">{children}</li>
}

/** A name in bold, for the tight lists. */
export function T({ children }) {
  return <span className="font-bold">{children}</span>
}

/** An aside: a fact worth stopping on, or a limit to know about. */
export function Note({ children }) {
  return (
    <p className="thin my-[1lh] max-w-[80ch] bg-[var(--background1)] px-[1ch] py-[1ch] leading-relaxed">
      {children}
    </p>
  )
}

/** A table with a header row: `head` is the column titles, `rows` arrays of cells. */
export function Table({ head, rows }) {
  return (
    <div className="thin my-[1lh] max-w-[80ch] overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[var(--background1)] text-left">
            {head.map((h, i) => (
              <th key={i} className="border-b border-black px-[1ch] py-[0.25lh]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`border-b border-black/20 px-[1ch] py-[0.25lh] align-top ${j === 0 ? 'font-bold' : j === r.length - 1 && r.length > 2 ? 'opacity-80' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A picture rendered ahead of time by `web/scripts/render-docs.sh` (the CLI,
 * so it is what `drawland map` draws): `src` under `public/docs/`.
 */
export function Figure({ src, alt, caption, className = '' }) {
  return (
    <figure className={`thin my-[1lh] max-w-[80ch] ${className}`}>
      <img src={src} alt={alt} loading="lazy" className="block w-full border border-black/30 bg-white" />
      {caption ? <figcaption className="mt-[0.25lh] opacity-60">{caption}</figcaption> : null}
    </figure>
  )
}
