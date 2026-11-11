import { Fragment } from 'react'
import { C, Code, H, LI, Note, P, Table, UL } from './Bits.jsx'
import reference from './library-reference.json'

/**
 * The library reference, rendered from `library-reference.json`, which
 * `web/scripts/build-reference.mjs` writes from `drawland.d.ts` (and `npm test`
 * keeps fresh). Nothing here restates the library by hand except the notes
 * and the closing section on lengths: a signature or a doc changes in the
 * d.ts, and here with it.
 */

const NAMESPACES = Object.fromEntries(reference.namespaces.map((n) => [n.name, n]))
const FUNCTIONS = Object.fromEntries(reference.functions.map((f) => [f.name, f]))
const TYPES = new Set(reference.types.map((t) => t.name))

/** The page's sections, in authoring order: a namespace, or top-level functions. */
const SECTIONS = [
  { id: 'ref-features', title: 'features', ns: 'features' },
  { id: 'ref-areas', title: 'areas', ns: 'areas' },
  { id: 'ref-lines', title: 'lines', ns: 'lines' },
  { id: 'ref-fills', title: 'fills', ns: 'fills' },
  { id: 'ref-modules', title: 'modules', ns: 'modules' },
  { id: 'ref-ink', title: 'ink', ns: 'ink' },
  { id: 'ref-draw', title: 'draw', fns: ['draw'] },
  { id: 'ref-compose', title: 'compose', ns: 'compose' },
  { id: 'ref-output', title: 'output and title', fns: ['output', 'title'] },
  { id: 'ref-view', title: 'view', fns: ['view'] },
  { id: 'ref-engine', title: 'engine', ns: 'engine' },
  { id: 'ref-burin', title: 'burin', ns: 'burin' },
]

/** For the left index (`nav.js`): the reference's group and its sections. */
export const REFERENCE_NAV = {
  id: 'reference',
  title: 'Reference',
  sub: [...SECTIONS.map((s) => s.id), 'ref-types', 'ref-lengths'],
}

/** The index's titles for those sections. */
export const REFERENCE_TITLES = {
  ...Object.fromEntries(SECTIONS.map((s) => [s.id, s.title])),
  'ref-types': 'Option types',
  'ref-lengths': 'Lengths and units',
}

const memberId = (ns, name) => `ref-${ns}-${name}`
const fnId = (name) => `ref-fn-${name}`
const typeId = (name) => `ref-type-${name}`

/** What mentions each type in its signature, for the types' "Used by" line. */
const USED_BY = (() => {
  const by = {}
  const add = (type, label, href) => (by[type] ??= []).push({ label, href })
  for (const n of reference.namespaces) {
    for (const m of n.members) for (const t of m.types ?? []) add(t, `${n.name}.${m.name}`, `#${memberId(n.name, m.name)}`)
  }
  for (const f of reference.functions) for (const t of f.types ?? []) add(t, f.name, `#${fnId(f.name)}`)
  for (const t of reference.types) {
    for (const m of t.members ?? []) for (const u of m.types ?? []) if (u !== t.name) add(u, `${t.name}.${m.name}`, `#${typeId(t.name)}`)
  }
  return by
})()

// Types used nearly everywhere: a "used by" list for them says nothing.
const UBIQUITOUS = new Set(['Length', 'Area', 'Lines', 'Features'])

/** Doc text: `code` spans as `C`, `[text](url)` as links. */
function Text({ children }) {
  const parts = String(children).split(/(`[^`]*`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <C key={i}>{part.slice(1, -1)}</C>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) return <a key={i} href={link[2]}>{link[1]}</a>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** A JSDoc comment's blocks: paragraphs, code, lists. */
function Doc({ blocks }) {
  if (!blocks?.length) return null
  return blocks.map((b, i) => {
    if (b.kind === 'code') return <Code key={i}>{b.text}</Code>
    if (b.kind === 'list') {
      return (
        <UL key={i}>
          {b.items.map((item, j) => <LI key={j}>- <Text>{item}</Text></LI>)}
        </UL>
      )
    }
    return <P key={i}><Text>{b.text}</Text></P>
  })
}

/** Doc blocks as one run of text, for a table cell. */
function CellDoc({ blocks }) {
  if (!blocks?.length) return null
  return blocks.map((b, i) => (
    <Fragment key={i}>
      {i ? ' ' : null}
      {b.kind === 'code' ? <C>{b.text}</C> : b.kind === 'list' ? b.items.map((item, j) => <Fragment key={j}>{j ? '; ' : null}<Text>{item}</Text></Fragment>) : <Text>{b.text}</Text>}
    </Fragment>
  ))
}

/** Type text with the library's own type names linked to their entries. */
function Linked({ text }) {
  return String(text).split(/([A-Za-z_]\w*)/).map((tok, i, all) =>
    TYPES.has(tok) && all[i - 1]?.slice(-1) !== '.' ? (
      <a key={i} href={`#${typeId(tok)}`} className="underline decoration-dotted">{tok}</a>
    ) : (
      <Fragment key={i}>{tok}</Fragment>
    ),
  )
}

/** A signature or a type, as a block of code whose type names are links. */
function Sig({ children }) {
  return (
    <pre className="thin my-[0.5lh] max-w-[80ch] overflow-x-auto bg-[var(--background1)] px-[1ch] py-[0.5lh] whitespace-pre-wrap">
      <code><Linked text={children} /></code>
    </pre>
  )
}

/** Inline type text that may wrap: a table's type column. */
function TypeText({ children }) {
  return (
    <code className="thin bg-[var(--background1)] px-[0.5ch] break-words">
      <Linked text={children} />
    </code>
  )
}

/** Extra words a few entries carry beyond their d.ts doc. */
const PATTERNS_LINK = (
  <>See the <a href="#patterns">pattern catalogue</a> for every pattern, drawn.</>
)

/** Properties as a table: option · type · what it does. */
function Options({ owner, members }) {
  if (!members?.length) return null
  return (
    <Table
      head={['option', 'type', 'what it does']}
      rows={members.map((m) => [
        <C key="n">{m.kind === 'method' ? `${m.name}()` : `${m.name}${m.optional ? '?' : ''}`}</C>,
        <TypeText key="t">{m.type}</TypeText>,
        <Fragment key="d">
          <CellDoc blocks={m.doc} />
          {owner === 'FillOptions' && m.name === 'pattern' ? <> {PATTERNS_LINK}</> : null}
        </Fragment>,
      ])}
    />
  )
}

/** The options an inline `{ … }` parameter type lists. */
function ParamOptions({ params }) {
  return (params ?? []).filter((p) => p.properties?.length).map((p) => (
    <Fragment key={p.name}>
      <P><C>{p.name}</C>:</P>
      <Options members={p.properties} />
    </Fragment>
  ))
}

function Member({ id, title, entry, children }) {
  return (
    <>
      <H id={id} level={3}>{title}</H>
      <Sig>{entry.signature}</Sig>
      <Doc blocks={entry.doc} />
      <ParamOptions params={entry.params} />
      {children}
    </>
  )
}

function Namespace({ section }) {
  const ns = NAMESPACES[section.ns]
  return (
    <section>
      <H id={section.id}>{section.title}</H>
      <Doc blocks={ns.doc} />
      {section.ns === 'ink' ? (
        <Note>
          <C>ink.width</C> is for screen and print output. A pen plotter has one nib per pen, so for the pen keep
          one width per ink, and give a line weight by drawing it twice, offset, rather than wider.
        </Note>
      ) : null}
      {ns.members.map((m) => (
        <Member key={m.name} id={memberId(ns.name, m.name)} title={`${ns.name}.${m.name}`} entry={m}>
          {ns.name === 'fills' && m.name === 'fill' ? <P>{PATTERNS_LINK}</P> : null}
        </Member>
      ))}
    </section>
  )
}

function Functions({ section }) {
  return (
    <section>
      <H id={section.id}>{section.title}</H>
      {section.fns.map((name) => (
        <Member key={name} id={fnId(name)} title={name} entry={FUNCTIONS[name]} />
      ))}
    </section>
  )
}

function TypeEntry({ type }) {
  const used = UBIQUITOUS.has(type.name) ? [] : (USED_BY[type.name] ?? [])
  const isPattern = type.name === 'Pattern'
  return (
    <>
      <H id={typeId(type.name)} level={3}>{type.name}</H>
      <Doc blocks={type.doc} />
      {type.kind === 'handle' ? (
        <P>A handle: made by the library's functions and passed back to them, never built by hand.</P>
      ) : null}
      {isPattern ? <P>{PATTERNS_LINK}</P> : null}
      {!isPattern && type.values?.length ? (
        <P>
          {type.values.map((v, i) => <Fragment key={v}>{i ? ' ' : null}<C>{`"${v}"`}</C></Fragment>)}
          {type.others?.filter((o) => !o.startsWith('{')).map((o) => <Fragment key={o}> or <TypeText>{o}</TypeText></Fragment>)}
          {type.members?.length ? ' or an object:' : null}
        </P>
      ) : null}
      {type.kind === 'type' && !type.values?.length && !type.members?.length ? <Sig>{`type ${type.name} = ${type.text}`}</Sig> : null}
      {type.extends?.length ? (
        <P>
          Also takes {type.extends.map((e, i) => <Fragment key={e}>{i ? ', ' : null}<TypeText>{e}</TypeText></Fragment>)}.
        </P>
      ) : null}
      <Options owner={type.name} members={type.members} />
      {used.length ? (
        <P>
          Used by{' '}
          {used.map((u, i) => <Fragment key={`${u.label}${i}`}>{i ? ', ' : null}<a href={u.href}><C>{u.label}</C></a></Fragment>)}.
        </P>
      ) : null}
    </>
  )
}

export default function Reference() {
  return (
    <>
      {SECTIONS.map((s) => (s.ns ? <Namespace key={s.id} section={s} /> : <Functions key={s.id} section={s} />))}
      <section>
        <H id="ref-types">Option types</H>
        <P>
          The objects a profile fills in, the values a string option takes, and the objects the modules return. An
          option marked <C>?</C> may be left out.
        </P>
        {reference.types.map((t) => <TypeEntry key={t.name} type={t} />)}
      </section>
      <section>
        <H id="ref-lengths">Lengths and units</H>
        <P>
          Every size is on paper. A bare number is millimetres; a string carries its unit: <C>"0.5mm"</C>,{' '}
          <C>"2cm"</C>, <C>"6in"</C> (see <a href={`#${typeId('Length')}`}><C>Length</C></a>). Page positions are
          millimetres from the top-left corner, across then down.
        </P>
        <P>
          A distance on the ground converts to paper at the output's scale: <C>metres * 1000 / engine.scale()</C>{' '}
          millimetres, so at <C>"1:10000"</C> ten metres is one millimetre. Call <C>output</C> before{' '}
          <C>engine.scale()</C>.
        </P>
        <P>
          Road widths are the exception: in <C>modules.roads</C> a bare number is metres on the ground, scaled with the
          map, because <C>widthMode</C> defaults to <C>"ground"</C>. Set <C>widthMode: "paper"</C> for millimetres, or
          write one measure explicitly as <C>{'{ ground: 7 }'}</C> or <C>{'{ paper: 0.4 }'}</C>. Heights and depths
          (<C>areas.band</C>, <C>lines.contours</C>) are metres; angles are degrees.
        </P>
      </section>
    </>
  )
}
