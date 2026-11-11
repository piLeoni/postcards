import cityGrain from './examples/lite-city-grain.js?raw'
import napkinSketch from './examples/lite-napkin-sketch.js?raw'
import karlTheFog from './examples/lite-karl-the-fog.js?raw'
import shakyGround from './examples/lite-shaky-ground.js?raw'
import LITE from './examples/lite.json'
import { PRESETS } from '../lib/presets'
import { C, Code, Figure, H, LI, P, UL } from './Bits.jsx'

/**
 * Four gallery styles cut down to 40–70 lines: the bridge between the
 * tutorial's card and the presets' full scripts. The scripts are
 * `examples/lite-*.js` (type-checked by `npm test`), their pictures drawn by
 * `web/scripts/render-docs.sh`; `lite.json` says what each one teaches.
 */
const SOURCES = { 'lite-city-grain': cityGrain, 'lite-napkin-sketch': napkinSketch, 'lite-karl-the-fog': karlTheFog, 'lite-shaky-ground': shakyGround }

export const LITE_IDS = LITE.map((l) => l.id)
export const LITE_TITLES = Object.fromEntries(LITE.map((l) => [l.id, l.title.replace(/ \(lite\)$/, '')]))

export default function Lite({ onOpen }) {
  return (
    <>
      <H id="lite">Styles, simplified</H>
      <P>
        The gallery's presets run to hundreds of lines, because a finished style handles every case a map can
        throw at it. Each of these keeps one style's signature idea in a page of code you can read top to
        bottom: the same layout as the presets (the palette first, then the data, the layers, the masks), with
        the reasons in the comments.
      </P>
      {LITE.map((l) => {
        const src = SOURCES[l.id]
        const preset = PRESETS.find((p) => p.id === l.preset)
        return (
          <section key={l.id}>
            <H id={l.id} level={3}>
              {LITE_TITLES[l.id]}
            </H>
            <Figure src={`/docs/examples/${l.id}.webp`} alt={l.title} />
            <UL>
              {l.teaches.map((t) => (
                <LI key={t}>{inline(t)}</LI>
              ))}
            </UL>
            <div className="my-[0.5lh] flex flex-wrap items-center gap-[1ch]">
              {onOpen ? (
                <button type="button" size-="small" variant-="background1" onClick={() => onOpen(src)}>
                  open on the map
                </button>
              ) : null}
              {preset && onOpen ? (
                <button type="button" size-="small" variant-="background0" onClick={() => onOpen(preset.doc)}>
                  the full {preset.name}
                </button>
              ) : null}
              <span className="opacity-60">{l.lines} lines</span>
            </div>
            <Code title={`${l.id}.js`}>{src}</Code>
          </section>
        )
      })}
    </>
  )
}

/** A line of prose with its code names set as code: the names that look like calls or options. */
function inline(text) {
  const parts = text.split(/(\b(?:[a-z]+\.[a-zA-Z]+(?:\([^)]*\))?|[a-z]+-[a-z-]+|geom:z|pen\(k\)|ground\(m\))\b)/g)
  return parts.map((p, i) => (i % 2 ? <C key={i}>{p}</C> : p))
}
