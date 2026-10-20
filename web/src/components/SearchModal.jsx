import PlaceSearch from './PlaceSearch'

/**
 * Address search in a centred sheet over a dimmed map (sidebar entry).
 */
export default function SearchModal({ open, onClose, onPick }) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search an address"
      className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--overlay-scrim)] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="chrome-surface flex max-h-[80vh] w-full max-w-[min(72ch,100%)] flex-col chrome-modal-shadow">
        <PlaceSearch active={open} onClose={onClose} onPick={onPick} />
      </div>
    </div>
  )
}
