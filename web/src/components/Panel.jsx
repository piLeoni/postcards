/**
 * A section of the sidebar: a title, optionally controls on its right, then
 * the content. Sections after the first are set off by a rule above.
 * With `collapsible`, the title row toggles the body (accordion).
 */
export default function Panel({
  title,
  aside,
  className = '',
  collapsible = false,
  open = true,
  onOpenChange,
  children,
}) {
  const toggle = () => onOpenChange?.(!open)

  return (
    <section className={`border-[color:var(--chrome-divider)] py-[0.5lh] not-first:border-t ${className}`}>
      {(title || aside || collapsible) && (
        <header className="mb-[0.5lh] flex min-h-[1lh] shrink-0 items-center gap-[1ch]">
          {collapsible ? (
            <span
              role="button"
              tabIndex={0}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-[1ch] select-none hover:underline"
              aria-expanded={open}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle()
                }
              }}
            >
              <span
                className="shrink-0 text-[1.1em] leading-none transition-transform"
                style={{ transform: open ? 'rotate(90deg)' : undefined }}
                aria-hidden
              >
                ›
              </span>
              {title && <h2 className="m-0 min-w-0 truncate font-bold">{title}</h2>}
            </span>
          ) : (
            title && <h2 className="shrink-0 truncate font-bold">{title}</h2>
          )}
          {aside && <div className="ml-auto flex min-w-0 shrink-0 items-center gap-[1ch]">{aside}</div>}
        </header>
      )}
      {(!collapsible || open) && children}
    </section>
  )
}
