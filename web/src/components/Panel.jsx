/**
 * A section of the sidebar: a title, optionally controls on its right, then
 * the content. Sections after the first are set off by a rule above.
 */
export default function Panel({ title, aside, className = '', children }) {
  return (
    <section className={`border-black py-[1lh] not-first:border-t ${className}`}>
      {(title || aside) && (
        <header className="mb-[0.5lh] flex min-h-[1lh] shrink-0 items-center gap-[1ch]">
          {title && <h2 className="shrink-0 truncate font-bold">{title}</h2>}
          {aside && <div className="ml-auto flex min-w-0 items-center gap-[1ch]">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
