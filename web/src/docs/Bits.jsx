import { useMemo, useState } from 'react'
import { highlight } from './highlight'

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
