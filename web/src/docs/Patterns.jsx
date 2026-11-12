import { useState } from 'react'
import catalog from './catalog.json'
import swatches from './pattern-swatches.json'
import { C, Code, H, LI, Note, P, T, Table, UL } from './Bits.jsx'

/**
 * The patterns, from penfill's own description of its catalogue
 * (`catalog.json`) and swatches drawn by the CLI (`pattern-swatches.json`,
 * `public/docs/patterns/`), both written by `web/scripts/render-patterns.mjs`.
 * Nothing here lists a pattern by hand: a new material, generator or symbol
 * appears once the script is run.
 */
const GROUPS = catalog.groups.filter((g) => catalog.materials.some((m) => m.group === g.id))

export const PATTERNS_NAV = {
  id: 'patterns',
  title: 'Patterns',
  sub: [...GROUPS.map((g) => `patterns-${g.id}`), 'patterns-generators', 'patterns-symbols', 'patterns-custom'],
}

export const PATTERNS_TITLES = {
  ...Object.fromEntries(GROUPS.map((g) => [`patterns-${g.id}`, g.title])),
  'patterns-generators': 'Generators',
  'patterns-symbols': 'Symbols',
  'patterns-custom': 'Make your own',
}

const byFile = Object.fromEntries(swatches.map((s) => [s.file, s]))

export default function Patterns() {
  return (
    <>
      <H id="patterns">Patterns</H>
      <P>
        A fill's <C>pattern</C> is a <T>material</T> or a <T>generator</T>. A material is a named recipe, chosen
        by what it is for: <C>gravel</C>, <C>marsh</C>, <C>limestone</C>, <C>orchard</C>. A generator is the
        algorithm under it: <C>hatch</C>, <C>scatter</C>, <C>cells</C>, <C>tile</C>, <C>waves</C>, and a few with
        a look of their own. Pick a material to get a look; drop to its generator to change anything about it.
        Every swatch below is drawn by the engine at the pattern's own spacing; click one to copy its call.
      </P>
      <P>Every pattern reads the same few options the same way:</P>
      <UL>
        <LI>
          <T>spacing</T>: the distance between neighbouring elements, centre to centre (lines, marks, cells), in
          paper millimetres. Each pattern has its own default; on a material it scales the whole recipe.
        </LI>
        <LI>
          <T>angle</T>, <T>seed</T>, <T>inset</T>, <T>fray</T>, and <T>edge</T>: <C>clip</C> cuts at the
          border, <C>inside</C> keeps every mark whole inside it, <C>overflow</C> lets the pattern bulge past.
        </LI>
        <LI>
          <T>anchor</T>: global by default, so neighbouring areas share one pattern without a seam, and a card
          moved over the map keeps its marks where they were.
        </LI>
        <LI>
          <T>mark</T>, <T>jitter</T>, <T>vary</T>: the size of one element, how far elements wander, how much
          their sizes differ.
        </LI>
        <LI>
          <T>density</T> with <C>contrast</C> and <C>feature</C>: the tone across the area (<C>edge</C>,{' '}
          <C>centre</C>, <C>noise</C>, <C>gradient</C>). A pen cannot draw grey, so tone is drawn by thinning:
          fewer marks, broken lines, cross layers that drop out.
        </LI>
      </UL>
      <Note>
        A mistake says what to write: an option a pattern does not take is an error naming the ones it does,
        and a value out of range gives the range. The editor checks the same thing as you type: with{' '}
        <C>pattern: "scatter"</C> it offers exactly scatter's options.
      </Note>

      {GROUPS.map((g) => (
        <section key={g.id}>
          <H id={`patterns-${g.id}`} level={3}>
            {g.title}
          </H>
          <P>{g.about}</P>
          <Grid>
            {catalog.materials
              .filter((m) => m.group === g.id)
              .map((m) => (
                <Swatch key={m.name} file={`m-${m.name}`} title={m.name} about={m.about} call={{ pattern: m.name }} recipe={recipe(m)} />
              ))}
          </Grid>
        </section>
      ))}

      <H id="patterns-generators" level={3}>
        Generators
      </H>
      <P>
        Each generator with what its options do, and every option it takes. Lengths are millimetres on paper;
        a default written <C>× spacing</C> follows the spacing.
      </P>
      {catalog.generators.map((g) => (
        <Generator key={g.name} g={g} />
      ))}

      <H id="patterns-symbols" level={3}>
        Symbols
      </H>
      <P>
        The marks <C>scatter</C> places by name (<C>motif</C>), drawn as a careful map engraver would at 1–3 mm.
        Each instance varies a little, so a field of them does not look stamped. With{' '}
        <C>rotate: "upright"</C> trees, reeds and graves stand up whatever the pattern's angle.
      </P>
      <Grid small>
        {swatches
          .filter((s) => s.kind === 'mark')
          .map((s) => (
            <Swatch key={s.file} file={s.file} title={s.name} call={{ pattern: 'scatter', motif: s.name }} />
          ))}
      </Grid>

      <Custom />
    </>
  )
}

/** A material's recipe, as one line: the generator and what it sets. */
function recipe(m) {
  if (m.alias) return `the ${m.name} generator`
  return m.layers
    .map((l) => {
      const set = Object.entries(l.set)
        .map(([k, v]) => `${k}: ${typeof v === 'object' && v && 'timesSpacing' in v ? `${fmt(v.timesSpacing)}×` : JSON.stringify(v)}`)
        .join(', ')
      return set ? `${l.generator} { ${set} }` : l.generator
    })
    .join(' + ')
}

const fmt = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v))

function Generator({ g }) {
  const variants = swatches.filter((s) => s.kind === 'generator' && s.name === g.name)
  return (
    <section className="my-[2lh]">
      <h4 id={`gen-${g.name}`} className="scroll-mt-[2lh] font-bold">
        <C>{g.name}</C>
      </h4>
      <P>
        {g.about} Default spacing {g.spacing} mm.
      </P>
      <Grid>
        {variants.map((s) => (
          <Swatch key={s.file} file={s.file} title={label(s.options)} call={{ pattern: g.name, ...s.options }} />
        ))}
      </Grid>
      {g.options.length ? (
        <Table
          head={['option', 'takes', 'default', 'what it does']}
          rows={g.options.map((o) => [<C key="k">{o.key}</C>, kind(o.kind), deflt(o.default), o.doc])}
        />
      ) : null}
    </section>
  )
}

function label(options) {
  const parts = Object.entries(options).map(([k, v]) => `${k}: ${Array.isArray(v) && Array.isArray(v[0]) ? 'polylines' : JSON.stringify(v)}`)
  return parts.length ? parts.join(', ') : 'defaults'
}

function kind(k) {
  switch (k.type) {
    case 'length':
      return 'length'
    case 'lengths':
      return 'length, or [a, b]'
    case 'number':
      return `${k.min}–${k.max}`
    case 'count':
      return `${k.min}–${k.max}, whole`
    case 'flag':
      return 'true / false'
    case 'choice':
      return k.values.map((v) => `"${v}"`).join(' ')
    case 'motif':
      return k.values.length > 12 ? 'a symbol name, or polylines' : `${k.values.map((v) => `"${v}"`).join(' ')}, or polylines`
    case 'numberOr':
      return `degrees, or ${k.values.map((v) => `"${v}"`).join(' ')}`
    default:
      return 'text'
  }
}

function deflt(d) {
  if (d === null || d === undefined) return '—'
  if (typeof d === 'object' && 'timesSpacing' in d) return `${fmt(d.timesSpacing)} × spacing`
  return JSON.stringify(d)
}

function Grid({ children, small = false }) {
  return (
    <div className={`my-[1lh] grid max-w-[120ch] gap-[1.5ch] ${small ? 'grid-cols-[repeat(auto-fill,minmax(14ch,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(20ch,1fr))]'}`}>
      {children}
    </div>
  )
}

/** One swatch: the picture on white, its name, what it is, and a click that copies its call. */
function Swatch({ file, title, about, call, recipe }) {
  const [copied, setCopied] = useState(false)
  const text = `fills.fill({ in: area, ${Object.entries(call)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ')} })`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  if (!byFile[file]) return null
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && copy()}
      title={`Copy ${text}`}
      className="thin flex cursor-pointer flex-col gap-[0.25lh] hover:opacity-80"
    >
      <img src={`/docs/patterns/${file}.svg`} alt={title} loading="lazy" className="block aspect-square w-full border border-black/30 bg-white" />
      <span className="font-bold">{copied ? 'copied' : title}</span>
      {about ? <span className="leading-snug opacity-70">{about}</span> : null}
      {recipe ? <span className="text-[0.85em] leading-snug opacity-50">{recipe}</span> : null}
    </div>
  )
}

function Custom() {
  return (
    <>
      <H id="patterns-custom" level={3}>
        Make your own
      </H>
      <P>
        Most new looks are a new combination of options, not new code: every generator's options are open,
        and two fills drawn into the same area layer like a material's recipe. Beyond that, a profile can bring
        its own shapes.
      </P>
      <P>
        <T>Your own symbol.</T> <C>motif</C> takes polylines in millimetres around the origin, or any lines drawn
        with <C>lines.*</C> (a shape, a word in a stroke font), which the engine centres for you:
      </P>
      <Code>{`// A star, written out: one closed polyline.
const star = [[[0, -1.2], [0.35, -0.35], [1.2, 0], [0.35, 0.35], [0, 1.2], [-0.35, 0.35], [-1.2, 0], [-0.35, -0.35], [0, -1.2]]]
draw({ id: "stars", from: fills.fill({ in: sky, pattern: "scatter", motif: star, spacing: 4, rotate: "random", vary: 0.3 }) })

// Anything lines.* draws: a shape, or a letter in a stroke font.
const triangle = lines.shape({ sides: 3, r: 1 })
draw({ id: "marks", from: fills.fill({ in: meadow, pattern: "scatter", motif: triangle, spacing: 4, rotate: "random" }) })`}</Code>
      <P>
        <T>Your own tile.</T> <C>tile</C> repeats a motif on a lattice: <C>size</C> is its box, <C>stagger</C>{' '}
        shifts every other row (0.5 is a brick bond). Or give it a CAD hatch in the <C>.pat</C> format, by
        built-in name or written out:
      </P>
      <Code>{`fills.fill({ in: yard, pattern: "tile", motif: [[[-1, 0], [1, 0]], [[0, -1], [0, 1]]], size: [3, 3], stagger: 0.5 })

// .pat: angle, x, y, dx, dy, then dashes (pen down positive, up negative)
fills.fill({ in: plot, pattern: "tile", spacing: 1, pat: "*MINE\\n45, 0,0, 0,3, 2,-1\\n135, 0,0, 0,3, 2,-1" })`}</Code>
      <P>
        <T>Lines made elsewhere.</T> <C>content</C> fills an area with any lines (a burin terrain, contours, a
        pattern drawn for another area), cut to it; <C>source</C> fills it with an SVG file.
      </P>
      <P>
        <T>In code.</T> penfill's own Rust, Python and Node APIs take a function as a pattern: it gets the area,
        the parameters and a toolkit (anchored lattices, blue-noise scatter, Voronoi cells, isolines of any
        field, the symbol library) and returns lines. That is how every generator above is written; see{' '}
        <a href="https://github.com/pileoni/penfill#build-your-own-pattern">penfill's guide</a>.
      </P>
    </>
  )
}
