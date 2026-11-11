import { useState } from 'react'
import { C, H, Note, P, T, Table } from './Bits.jsx'
import patterns from './pattern-swatches.json'

/**
 * The pattern catalogue: a swatch for every penfill pattern, each a 22 mm
 * square drawn by the CLI with a 0.2 mm pen. `web/scripts/render-patterns.mjs`
 * writes the swatches (`public/docs/patterns/<file>.svg`) and `pattern-swatches.json`
 * from the `Pattern` union in `drawland.d.ts`, with the options a swatch
 * needed; the per-pattern options table at the end is written by hand from
 * `FillOptions`' docs.
 */

/** The catalogue's groups, in the order the script wrote them. */
const GROUPS = (() => {
  const out = []
  for (const p of patterns) {
    let g = out.find((x) => x.id === p.group)
    if (!g) out.push((g = { id: p.group, title: p.groupTitle, items: [] }))
    g.items.push(p)
  }
  return out
})()

const groupId = (g) => `patterns-${g}`

/** For the left index (`nav.js`): the catalogue's group and its sections. */
export const PATTERNS_NAV = {
  id: 'patterns',
  title: 'Patterns',
  sub: [...GROUPS.map((g) => groupId(g.id)), 'patterns-options'],
}

/** The index's titles for those sections. */
export const PATTERNS_TITLES = {
  ...Object.fromEntries(GROUPS.map((g) => [groupId(g.id), g.title])),
  'patterns-options': 'Pattern options',
}

/** An option's value as a profile writes it; `centre` stays a placeholder. */
function value(key, v) {
  if (key === 'centre' && typeof v === 'string') return v
  return JSON.stringify(v)
}

/** `pattern: "pat", name: "BRICK"`: the options a swatch was drawn with. */
function args(p) {
  return [`pattern: "${p.name}"`, ...Object.entries(p.options).map(([k, v]) => `${k}: ${value(k, v)}`)].join(', ')
}

function Swatch({ p }) {
  const [copied, setCopied] = useState(false)
  const call = `fills.fill({ in: area, ${args(p)} })`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(call)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <figure className="m-0 flex min-w-0 flex-col">
      {/* Not a <button>: the page's buttons have a fixed height. */}
      <div
        role="button"
        tabIndex={0}
        onClick={copy}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), copy())}
        title={`Copy ${call}`}
        className="cursor-copy border border-black/30 bg-white"
      >
        <img
          src={`/docs/patterns/${p.file}.svg`}
          alt={`The ${p.name} pattern`}
          loading="lazy"
          className="block aspect-square h-auto w-full"
        />
      </div>
      <figcaption className="mt-[0.25lh] min-w-0">
        <div className="font-bold">
          {p.group === 'pat' ? p.options.name : p.name}
          {copied ? <span className="ml-[1ch] font-normal opacity-60">copied</span> : null}
        </div>
        {p.alias ? <div className="text-[11px] opacity-60">alias: {p.alias}</div> : null}
        <code className="block text-[11px] leading-snug break-words opacity-70">{`{ ${args(p)} }`}</code>
      </figcaption>
    </figure>
  )
}

/** Options that belong to one pattern (or a few), from `FillOptions`. */
const OPTION_ROWS = [
  ['dots', <><C>mark</C> dot size (default 0.2mm); <C>lattice</C> <C>"square"</C> or <C>"hexagonal"</C></>],
  ['stipple', <><C>mark</C> dot size (default 0.2mm)</>],
  ['honeycomb', <><C>line_width</C> doubles the walls this far apart</>],
  ['terrazzo', <><C>hatch</C> the hatch inside the stones</>],
  ['chess', <><C>cell</C> the size of a square</>],
  ['pat', <><C>name</C> which hatch (<C>BRICK</C>, <C>HERRINGBONE</C>, <C>BASKET</C>, <C>PARQUET</C>, <C>ANSI31</C>, <C>ANSI32</C>, <C>ANSI33</C>, <C>ANSI37</C>, <C>EARTH</C>, <C>CROSS</C>, <C>DASH</C>, <C>STAIRS</C>, <C>GRATE</C>, <C>ANGLE</C>); <C>scale</C> the hatch's size</>],
  ['sunburst, spiral', <><C>centre</C> where the pattern centres, in output millimetres</>],
  ['waves', <><C>inset</C> defaults to 0.1mm</>],
  ['curl-waves', <><C>spacing</C> is the gap between rows; <C>wavelength</C> distance between waves along a row, × spacing (1.35); <C>curl</C> radius of each curl, × the wavelength (0.2); <C>turns</C> how far each curl winds in (0.95); <C>stagger</C> shift every other row (0–1, 0); <C>flip</C> 1 breaks the other way</>],
  ['flow-waves', <><C>spacing</C> is the gap between lines; <C>wavelength</C> one swell's length, × spacing (13); <C>amplitude</C> swell height, × spacing (2.6); <C>drift</C> how fast height and phase change (1); <C>breaks</C> how broken the lines are (0–1, 0.5)</>],
  ['scallop-waves', <><C>spacing</C> is the gap between rows; <C>wavelength</C> scallop width × spacing (1.35); <C>depth</C> how far each scallop dips, × spacing (0.35); <C>round</C> below 1 rounder, above 1 more pointed (0.8)</>],
  ['doodle-trees', <><C>spacing</C> is the crown diameter; <C>loops</C> curls round each rim, × the default (1); <C>shadow</C> share of crowns with a shade crescent (0.8); <C>light_angle</C> side the shadow scribble avoids (225)</>],
  ['isoline-stack', <><C>edge</C> <C>"clip"</C> / <C>"inside"</C> / <C>"overflow"</C> (and <C>overflow</C>, how far past, ~0.4× spacing); <C>coverage</C> how patchy the crowns are (0–1, 0.6); <C>bubble</C> typical bubble radius (~0.3× spacing); <C>slices</C> rings (9); <C>jitter</C> contour displacement (0–2.5, 1.1); <C>jitter_period</C> / <C>period</C> control points per contour (0.2–4, 0.68); <C>ticks</C> slope ticks at clefts (0–1.5, 0.42); <C>elongation</C> wind sweep (0–1, 0.18); <C>lobes</C> cleft depth and lobing (0–2.5, 1); <C>light</C> sun strength (0–1, 0.82) with <C>light_angle</C> (−45), <C>light_elevation</C> (35) and <C>hatch</C> shading spacing (0.4, 0 for none). <C>isoline-stack-hatched</C> is the same, lit and hatched by default.</>],
  ['isoline-blobs', <><C>coverage</C> how patchy (0–1, 0.6); <C>contour</C> distance between contour lines (~0.045× spacing); <C>warp</C> domain warp of the field (0–1, 0.45); <C>threshold</C> field level for patches (0–1, 0.25)</>],
  ['clouds', <><C>spacing</C> is a puff's size; <C>coverage</C> share of sky; <C>cell</C> scale of the masses (8 puffs); <C>elongate</C> puffs drawn out along the run (0.35); <C>stretch</C> masses drawn out along the wind (0–0.95, 0.25); <C>wind</C> direction in degrees (15); <C>warp</C> curl and drift (0–1, 0.25); <C>height</C> 1 cumulus, 0.3 a flat sheet (1); <C>shade</C> how much is shaded (0–1, 0.45); <C>shading</C> <C>"dots"</C> or <C>"lines"</C>; <C>dot</C> dot length (0.12mm); <C>light_angle</C> (225, from the top left), <C>light_elevation</C> (30); <C>hatch</C> shade spacing at its deepest</>],
  ['growth', <><C>spacing</C> is the gap between neighbouring twigs; <C>roots</C> how many roots; <C>root_spacing</C> roots this far apart (~12× spacing); <C>variation</C> how much trees differ (0–1, 0.35); <C>trunk</C> most pen passes on a trunk (3); <C>line_width</C> the pen width, so passes sit side by side (0.15); <C>step</C> advance per step (~0.16× spacing); <C>reach</C> attractor range (~3.2× spacing); <C>kill</C> attractor consumed this close (~0.4× spacing); <C>jitter</C> steering wobble (0.1); <C>max_steps</C> a hard cap (20000)</>],
]

export default function Patterns() {
  return (
    <>
      <H id="patterns">Patterns</H>
      <P>
        <C>fills.fill(&#123; in: area, pattern, ... &#125;)</C> fills an area with one of penfill's patterns, as
        lines ready to draw. Every pattern is below, drawn by <C>drawland map</C> in a 22 mm square with a 0.2 mm
        pen; the line under each is the options it was drawn with. Click a swatch to copy the call.
      </P>
      <P>
        What every pattern reads: <T>spacing</T>, the distance between lines, rows or dots (default 0.5mm);{' '}
        <T>angle</T> in degrees (most patterns default to 0; zigzag and lines to 45); <T>mark</T>, the dot or mark
        size for <C>dots</C> and <C>stipple</C> (0.2mm); <T>inset</T>, which shrinks the area first; <T>fray</T>, a
        perimeter-aware edge fade: lines break into shorter dashes and dots and disappear before the boundary;{' '}
        <T>seed</T>, for the random patterns: the same seed draws the same lines; <T>anchor</T>,{' '}
        <C>"global"</C> (default) so neighbouring areas share one grid, or <C>"local"</C> for each shape on its
        own; <T>shift</T>, which moves the grid across and down; and <T>per: "feature"</T>, one pattern per polygon
        (each building hatched on its own) instead of one over the union.
      </P>
      <Note>
        The swatches are drawn at true size and shown larger. Where a pattern's default reads poorly in a small
        square (the soils at 0.5mm ink nearly solid, a crown or a puff wants room), the swatch sets its own{' '}
        <C>spacing</C>; the option is shown. <C>solid</C> is a flat SVG fill, not pen strokes, and <C>none</C> draws
        nothing.
      </Note>

      {GROUPS.map((g) => (
        <section key={g.id}>
          <H id={groupId(g.id)} level={3}>
            {g.title}
          </H>
          {g.id === 'pat' ? (
            <P>
              <C>pattern: "pat"</C> draws a built-in hatch, chosen with <C>name</C>.
            </P>
          ) : null}
          <div className="my-[1lh] grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-[2ch] gap-y-[1lh]">
            {g.items.map((p) => (
              <Swatch key={p.file} p={p} />
            ))}
          </div>
        </section>
      ))}

      <H id="patterns-options" level={3}>
        Pattern options
      </H>
      <P>
        Options only some patterns read; a default is in brackets. Lengths take a unit (<C>"2mm"</C>) or a number of
        millimetres; the multiples (× spacing) are plain numbers.
      </P>
      <Table
        head={['pattern', 'options']}
        rows={OPTION_ROWS.map(([name, opts]) => [<span className="whitespace-nowrap">{name}</span>, opts])}
      />
    </>
  )
}
