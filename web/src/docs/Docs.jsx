import { useEffect, useState } from 'react'
import { C, H, P, T } from './Bits.jsx'
import { GROUP_OF, NAV, SECTION_IDS, TITLES } from './nav.js'
import Gallery from './Gallery.jsx'
import Tutorial from './Tutorial.jsx'
import Lite from './Lite.jsx'
import Concepts from './Concepts.jsx'
import Patterns from './Patterns.jsx'
import Reference from './Reference.jsx'
import Developers from './Developers.jsx'

/**
 * The documentation page: the index on the left, the reading column on the
 * right. It reads in the order a newcomer needs it: look (the gallery), learn
 * (a tutorial, then four styles cut down to read), understand (the concepts),
 * look up (the patterns, drawn, and the reference, generated from the
 * library's own description). The pictures are drawn ahead of time by the CLI
 * (`web/scripts/render-docs.sh`), so they are what the engine draws.
 *
 * `onOpen(script)` puts a profile on the map and leaves the page: every
 * example here is one.
 */
export default function Docs({ onOpen }) {
  const { group, id } = useScrollSpy(SECTION_IDS)
  return (
    <div className="docs-scroll min-h-0 w-full flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col lg:flex-row">
        <nav className="docs-scroll shrink-0 border-black px-[2ch] py-[2lh] lg:sticky lg:top-0 lg:max-h-screen lg:w-[30ch] lg:overflow-y-auto lg:border-r">
          <Index group={group} active={id} />
        </nav>
        <article className="min-w-0 flex-1 px-[2ch] py-[3lh] lg:px-[4ch]">
          <Header />
          <Gallery onOpen={onOpen} />
          <Tutorial onOpen={onOpen} />
          <Lite onOpen={onOpen} />
          <Concepts />
          <Patterns />
          <H id="reference">Reference</H>
          <P>
            Every function and option of the library, generated from <C>drawland.d.ts</C>, the same description
            the page's editor autocompletes and checks against.
          </P>
          <Reference />
          <Developers />
        </article>
      </div>
    </div>
  )
}

/** The index: one link per group; the group being read opens its headings under it. */
function Index({ group, active }) {
  return (
    <ul className="flex flex-col gap-[0.5lh]">
      {NAV.map((g) => (
        <li key={g.id}>
          <a href={`#${g.id}`} className={`font-bold no-underline hover:underline ${group === g.id ? '' : 'opacity-80'}`}>
            {group === g.id ? '● ' : ''}
            {g.title}
          </a>
          {g.sub.length && group === g.id ? (
            <ul className="mt-[0.25lh] ml-[1.5ch] flex flex-col border-l border-black/20 pl-[1.5ch]">
              {g.sub.map((id) => (
                <li key={id}>
                  <a href={`#${id}`} className={`no-underline hover:underline ${active === id ? 'font-bold' : 'opacity-60'}`}>
                    {TITLES[id] ?? id}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * Which heading the reader is in: the last one above 40% of the window,
 * recomputed as the page scrolls, and the group it belongs to.
 */
function useScrollSpy(ids) {
  const [current, setCurrent] = useState(ids[0])
  useEffect(() => {
    const scroller = document.querySelector('.docs-scroll')
    const onScroll = () => {
      const middle = window.innerHeight * 0.4
      let found = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= middle) found = id
      }
      setCurrent((was) => (was === found ? was : found))
    }
    onScroll()
    // The page scrolls inside its own column, not the window.
    const targets = [window, scroller].filter(Boolean)
    targets.forEach((t) => t.addEventListener('scroll', onScroll, { passive: true }))
    return () => targets.forEach((t) => t.removeEventListener('scroll', onScroll))
  }, [ids])
  return { group: GROUP_OF[current] ?? current, id: current }
}

function Header() {
  return (
    <header id="start" className="scroll-mt-[2lh] border-b border-black pb-[1lh]">
      <h1 className="text-[2em] font-bold">draw.land</h1>
      <P>
        draw.land turns any place on Earth into a <T>layered pen-and-ink SVG</T>, in paper millimetres, ready for
        a plotter, a laser cutter or a vector editor. What is drawn, and how, is a short <T>profile</T>: a
        JavaScript program that says where the map is and on what paper, which map data to read, what to make
        of it, and how to ink and stack it.
      </P>
      <P>
        The language is JavaScript; what these pages teach is the way of drawing a map with it. Four ways in:
      </P>
      <ul className="my-[1lh] grid max-w-[100ch] gap-[1ch] sm:grid-cols-2 xl:grid-cols-4">
        <Way href="#gallery" title="Look" text="The gallery: every style the page ships, drawn, and what makes each one." />
        <Way href="#tutorial" title="Learn" text="A map of Lake Merritt in eight steps, from four calls to a card for the plotter." />
        <Way href="#lite" title="Read" text="Four gallery styles in a page of code each: clouds, terrain, live data, a sketch." />
        <Way href="#reference" title="Look up" text="Every pattern, drawn; every function and option, from the library itself." />
      </ul>
    </header>
  )
}

function Way({ href, title, text }) {
  return (
    <li>
      <a href={href} className="thin block h-full border border-black/30 px-[1ch] py-[0.5lh] no-underline hover:bg-[var(--background1)]">
        <span className="font-bold">{title} →</span>
        <span className="mt-[0.25lh] block leading-relaxed opacity-80">{text}</span>
      </a>
    </li>
  )
}
