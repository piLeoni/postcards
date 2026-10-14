import { useEffect, useMemo, useState } from 'react'
import { Pick } from './controls'
import {
  joinNameParts,
  prepareDownloads,
  pxPerMmFromDpi,
  sanitizeBasename,
  saveDownloads,
  suggestExportBasename,
} from '../lib/download'

const KEY = { 'size-': 'small', 'variant-': 'background1' }

const INPUT =
  'm-0 h-auto min-w-0 flex-1 border border-black px-[1ch] py-[0.4lh] font-mono text-[10px] leading-snug outline-none bg-black/[0.03] text-black/80 focus:border-black'

const defaultOptions = (hasSlices) => ({
  format: 'svg',
  sliceMode: hasSlices ? 'slices' : 'whole',
  svgDecimals: '',
  perLayer: false,
  pngDpi: 300,
  pngBackground: 'transparent',
})

/**
 * Export sheet — same centred dialog as share and search; controls match the
 * transform panel (Choice, Pick).
 */
export default function DownloadModal({ open, onClose, doc, drawing, output }) {
  const drawnSlices = drawing?.slices?.length ?? 0
  const plannedSlices = Math.max(1, (output?.columns ?? 1) * (output?.rows ?? 1))
  const hasSlices = drawnSlices > 0
  const layerCount = drawing?.groups?.length ?? 0
  const canSplitLayers = layerCount > 1

  const [options, setOptions] = useState(() => defaultOptions(hasSlices))
  const [basename, setBasename] = useState('drawland')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setOptions(defaultOptions(hasSlices))
    setError(null)
    setBusy(false)
    suggestExportBasename(doc).then(setBasename).catch(() => setBasename('drawland'))
  }, [open, doc, hasSlices])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const ext = options.format === 'png' ? 'png' : 'svg'
  const cleanBase = useMemo(() => sanitizeBasename(basename), [basename])

  const namePreview = useMemo(() => {
    const useSlices = options.sliceMode === 'slices' && hasSlices
    const useLayers = options.format === 'svg' && options.perLayer && canSplitLayers
    const stem = useSlices ? joinNameParts(cleanBase, 'r1c1') : cleanBase
    if (useLayers) {
      const count = (useSlices ? drawnSlices : 1) * layerCount
      return `${joinNameParts(stem, '<layer>')}.${ext} (${count} files)`
    }
    if (useSlices) {
      return `${stem}.${ext} (${drawnSlices} files)`
    }
    return `${stem}.${ext}`
  }, [cleanBase, ext, options, hasSlices, drawnSlices, canSplitLayers, layerCount])

  if (!open) return null

  const set = (patch) => setOptions((o) => ({ ...o, ...patch }))
  const pxPerMm = pxPerMmFromDpi(options.pngDpi)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const files = await prepareDownloads(drawing, { ...options, basename: cleanBase })
      if (!files.length) {
        setError('Nothing to export.')
        return
      }
      await saveDownloads(files)
      onClose?.()
    } catch {
      setError('Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const sliceHint = hasSlices
    ? `${drawnSlices} sheets in this draw`
    : plannedSlices > 1
      ? 'Re-run draw after changing slices to export per sheet'
      : 'Cut the output into slices in transform ▾ to enable per-sheet files'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Download this drawing"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/25 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[min(88ch,100%)] flex-col bg-white font-mono text-[12px]"
        style={{ boxShadow: '0 0 0 1px #000, 0 16px 44px rgb(0 0 0 / 0.3)' }}
      >
        <div className="flex shrink-0 items-center gap-[1ch] border-b border-black py-[0.5lh] pr-[1ch] pl-[2ch]">
          <span className="font-bold tracking-[0.2em]">DOWNLOAD</span>
          <span className="min-w-0 truncate opacity-60">save the last draw</span>
          <button type="button" {...KEY} className="ml-auto" aria-label="Close" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-[2ch]">
          <fieldset className="m-0 mb-[1.5lh] border-0 p-0">
            <legend className="mb-[0.5lh] font-bold">File name</legend>
            <div className="flex items-center gap-[1ch]">
              <input
                className={INPUT}
                value={basename}
                spellCheck={false}
                aria-label="Download file name"
                onChange={(e) => setBasename(e.target.value)}
              />
              <span className="shrink-0 opacity-60">.{ext}</span>
            </div>
            <p className="m-0 mt-[0.5lh] opacity-60">{namePreview}</p>
          </fieldset>

          <fieldset className="m-0 mb-[1.5lh] border-0 p-0">
            <legend className="mb-[0.5lh] font-bold">Format</legend>
            <div className="flex flex-wrap gap-[1ch]">
              {['svg', 'png'].map((f) => (
                <button
                  key={f}
                  type="button"
                  size-="small"
                  variant-={options.format === f ? 'foreground0' : 'background1'}
                  onClick={() => set({ format: f })}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 mb-[1.5lh] border-0 p-0">
            <legend className="mb-[0.5lh] font-bold">Slices</legend>
            <p className="m-0 mb-[0.75lh] opacity-60">{sliceHint}</p>
            <div className="flex flex-col items-stretch gap-[0.5lh]" role="radiogroup" aria-label="How to export cut sheets">
              <Pick selected={options.sliceMode === 'whole'} onClick={() => set({ sliceMode: 'whole' })}>
                All together (one file)
              </Pick>
              <Pick
                selected={options.sliceMode === 'slices'}
                disabled={!hasSlices}
                title={hasSlices ? `Export each of the ${drawnSlices} slices` : sliceHint}
                onClick={() => set({ sliceMode: 'slices' })}
              >
                One file per slice
              </Pick>
            </div>
          </fieldset>

          {options.format === 'svg' ? (
            <>
              <fieldset className="m-0 mb-[1.5lh] border-0 p-0">
                <legend className="mb-[0.5lh] font-bold">Coordinate decimals</legend>
                <div className="flex flex-wrap items-center gap-[1ch]">
                  <input
                    type="number"
                    min={0}
                    max={6}
                    step={1}
                    className={`${INPUT} max-w-[12ch]`}
                    placeholder="full"
                    aria-label="Decimal places in SVG coordinates, empty for full precision"
                    value={options.svgDecimals}
                    onChange={(e) => set({ svgDecimals: e.target.value })}
                  />
                  <span className="opacity-60">0–6; leave empty for full precision</span>
                </div>
              </fieldset>

              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-[0.5lh] font-bold">Layers</legend>
                <Pick
                  selected={options.perLayer}
                  disabled={!canSplitLayers}
                  title={
                    canSplitLayers
                      ? `Write ${layerCount} SVG files, one per grammar layer`
                      : 'Only one layer in this drawing'
                  }
                  onClick={() => set({ perLayer: !options.perLayer })}
                >
                  One file per layer
                </Pick>
                {!canSplitLayers && (
                  <p className="m-0 mt-[0.5lh] opacity-60">This draw has only one layer.</p>
                )}
                {canSplitLayers && (
                  <p className="m-0 mt-[0.5lh] opacity-60">{layerCount} layers in this draw.</p>
                )}
              </fieldset>
            </>
          ) : (
            <>
              <fieldset className="m-0 mb-[1.5lh] border-0 p-0">
                <legend className="mb-[0.5lh] font-bold">Resolution (DPI)</legend>
                <div className="flex flex-wrap items-center gap-[1ch]">
                  <input
                    type="number"
                    min={36}
                    max={1200}
                    step={1}
                    className={`${INPUT} max-w-[12ch]`}
                    aria-label="PNG resolution in dots per inch"
                    value={options.pngDpi}
                    onChange={(e) => set({ pngDpi: e.target.value })}
                  />
                  <span className="opacity-60">≈ {pxPerMm.toFixed(2)} px/mm (long side capped at 8192 px)</span>
                </div>
              </fieldset>

              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-[0.5lh] font-bold">Background</legend>
                <div className="flex flex-wrap gap-[1ch]">
                  {[
                    ['transparent', 'Transparent'],
                    ['white', 'White'],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      size-="small"
                      variant-={options.pngBackground === v ? 'foreground0' : 'background1'}
                      onClick={() => set({ pngBackground: v })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-[1ch] border-t border-black p-[2ch]">
          <button type="button" size-="small" variant-="foreground0" disabled={busy || !drawing?.svg} onClick={run}>
            {busy ? 'Preparing…' : 'Download'}
          </button>
          {error && <p className="m-0 font-bold">{error}</p>}
        </div>
      </div>
    </div>
  )
}
