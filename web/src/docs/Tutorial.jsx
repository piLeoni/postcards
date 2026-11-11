import { useState } from 'react'
import step1 from './examples/tutorial-01-hello.js?raw'
import step2 from './examples/tutorial-02-texture.js?raw'
import step3 from './examples/tutorial-03-roads.js?raw'
import step4 from './examples/tutorial-04-masks.js?raw'
import step5 from './examples/tutorial-05-data.js?raw'
import step6 from './examples/tutorial-06-names.js?raw'
import step7 from './examples/tutorial-07-pens.js?raw'
import step8 from './examples/tutorial-08-hand.js?raw'
import { C, Code, Figure, H, LI, Note, P, T, UL } from './Bits.jsx'

/**
 * The tutorial: one map of Lake Merritt, Oakland, built in eight steps. Each
 * step is a whole profile in `examples/` (type-checked by `npm test`, drawn by
 * `web/scripts/render-docs.sh`), so what the page shows is what runs. A step
 * shows the lines it adds to the one before; the whole profile is a click away.
 */
export const TUTORIAL_STEPS = [
  { id: 'tutorial-01-hello', title: '1 · Hello, map', src: step1, body: Hello },
  { id: 'tutorial-02-texture', title: '2 · Texture', src: step2, body: Texture },
  { id: 'tutorial-03-roads', title: '3 · Roads', src: step3, body: Roads },
  { id: 'tutorial-04-masks', title: '4 · Masks', src: step4, body: Masks, pair: ['tutorial-03-roads', 'tutorial-04-masks'] },
  { id: 'tutorial-05-data', title: '5 · Drawn from data', src: step5, body: Data },
  { id: 'tutorial-06-names', title: '6 · Names', src: step6, body: Names },
  { id: 'tutorial-07-pens', title: '7 · Pens and the plotter', src: step7, body: Pens },
  { id: 'tutorial-08-hand', title: '8 · By hand', src: step8, body: Hand, pair: ['tutorial-07-pens', 'tutorial-08-hand'] },
]

export default function Tutorial({ onOpen }) {
  return (
    <>
      <H id="tutorial">Tutorial: a map in eight steps</H>
      <P>
        One map, built a step at a time: Lake Merritt in Oakland, on a 6 × 4 inch card at 1:8000. Each step adds
        one idea and is a whole profile you can open on the map. The code shows what the step adds; the
        pictures are what the engine draws.
      </P>
      {TUTORIAL_STEPS.map((s, i) => (
        <Step key={s.id} step={s} prev={TUTORIAL_STEPS[i - 1]} onOpen={onOpen} />
      ))}
      <H id="tutorial-next" level={3}>
        Where next
      </H>
      <UL>
        <LI>
          <T>Styles, simplified</T> (below): four of the gallery's styles in 40 to 70 lines each, the same ideas at
          work on clouds, terrain, live data and a hand-drawn sketch.
        </LI>
        <LI>
          <T>Concepts</T>: the rules the tutorial used without stopping on them: lengths and scale, where data
          comes from, why order does not hide.
        </LI>
        <LI>
          <T>Patterns</T>: every fill, drawn. <T>Reference</T>: every function and option.
        </LI>
      </UL>
    </>
  )
}

function Step({ step, prev, onOpen }) {
  const [whole, setWhole] = useState(false)
  const Body = step.body
  const shown = prev && !whole ? added(prev.src, step.src) : step.src
  return (
    <section>
      <H id={step.id} level={3}>
        {step.title}
      </H>
      <Body />
      <Code title={prev && !whole ? `what step ${step.title.split(' ')[0]} adds` : `${step.id}.js`}>{shown}</Code>
      <div className="my-[0.5lh] flex flex-wrap gap-[1ch]">
        {prev ? (
          <button type="button" size-="small" variant-="background1" onClick={() => setWhole((w) => !w)}>
            {whole ? 'only what this step adds' : 'the whole profile'}
          </button>
        ) : null}
        {onOpen ? (
          <button type="button" size-="small" variant-="background1" onClick={() => onOpen(step.src)}>
            open on the map
          </button>
        ) : null}
      </div>
      {step.pair ? (
        <div className="my-[1lh] grid max-w-[80ch] grid-cols-2 gap-[1ch]">
          {step.pair.map((id, i) => (
            <Figure key={id} className="my-0" src={`/docs/examples/${id}.detail.webp`} alt={`${id}, a detail`} caption={i === 0 ? 'before' : 'after'} />
          ))}
        </div>
      ) : null}
      <Figure src={`/docs/examples/${step.id}.webp`} alt={`Lake Merritt after ${step.title}`} />
    </section>
  )
}

/**
 * The lines of `next` that are not in `prev`, in runs, with `// …` where
 * unchanged lines are left out: a longest common subsequence over lines, which
 * for profiles a step apart is exactly what was written.
 */
export function added(prev, next) {
  const a = prev.split('\n')
  const b = next.split('\n')
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const keep = new Array(m).fill(false)
  for (let i = 0, j = 0; j < m; ) {
    if (i < n && a[i] === b[j]) {
      i++
      j++
    } else if (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++
    } else {
      keep[j] = true
      j++
    }
  }
  // The header comment and title change every step; what is new starts below them.
  const out = []
  let gap = false
  b.forEach((line, j) => {
    if (j < 2 && line.startsWith('//')) return
    if (keep[j] && line.trim() !== '') {
      if (gap && out.length) out.push('// …')
      gap = false
      out.push(line)
    } else if (keep[j]) {
      if (out.length && out[out.length - 1] !== '') out.push('')
    } else {
      gap = true
    }
  })
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

function Hello() {
  return (
    <>
      <P>
        Four calls make a map. <C>output</C> says where and on what paper: the centre, the sheet's size, and the
        scale, so that 1 mm on the card is 8 m on the ground. <C>features.tiles("buildings")</C> picks map data
        from the vector tiles; <C>areas.polygons</C> makes polygons of it; <C>lines.rings</C> makes their
        outlines into lines; <C>draw</C> puts the lines on paper as a layer.
      </P>
      <P>
        Those are the three kinds of value in a profile, and each function says which it takes:{' '}
        <T>features</T> (what to build from, never drawn), <T>areas</T> (polygons: what gets filled, masked,
        outlined), and <T>lines</T> (what a pen draws). Passing lines where an area goes is an error the editor
        underlines before anything runs.
      </P>
      <Note>
        The script does not draw. It runs once, in milliseconds, and each call adds a step to a plan; the engine
        then fetches the tiles the plan reads and runs it. That is why a script can loop over twenty kinds of
        park for free: the cost is the twenty fills, not the loop.
      </Note>
    </>
  )
}

function Texture() {
  return (
    <>
      <P>
        <C>fills.fill</C> fills an area with one of penfill's patterns and returns the lines: waves for the lake,
        dots for the parks, hatching for the roofs. Sizes are millimetres <T>on the paper</T>, whatever the
        scale: <C>spacing: "0.6mm"</C> is the gap between two lines of ink, so a pattern looks the same on a
        street plan and on a map of a country.
      </P>
      <P>
        <C>per: "feature"</C> fills each building on its own instead of laying one hatch over all of them, so
        each roof starts its own lines. Layers stack in the order they are drawn, the first at the bottom. Every
        pattern is in the <a href="#patterns">catalogue</a>, drawn.
      </P>
    </>
  )
}

function Roads() {
  return (
    <>
      <P>
        <C>modules.roads</C> is a module: a recipe with several outputs. From the road features it builds the
        carriageways at their real width (in metres on the ground: a wider road is wider on any card), joins the
        crossings, lays bridges over what they cross, and keeps the footpaths as single lines. Draw what you
        need of it: <C>roads.outlines</C>, <C>roads.trails</C>, <C>roads.centerlines</C>, <C>roads.rails</C>.
      </P>
      <P>
        A stroke can be <C>"solid"</C>, <C>"dash"</C>, <C>"dotted"</C>, or an object with the sizes. Now look
        closely at the picture: the park's dots run straight under the roads and out over the lake. Drawing on
        top does not hide anything, which is the next step.
      </P>
    </>
  )
}

function Masks() {
  return (
    <>
      <P>
        A pen plotter has no white paint. A layer drawn later goes on top, but the ink underneath is still
        there, so nothing is ever hidden by order. What hides is a <T>mask</T>: an area, and the layers it cuts.
        It cuts exactly the layers it names, wherever they are in the order, and nothing else.
      </P>
      <P>
        <C>roads.area</C> is the strip the roads cover, so the dots and waves under it go. The buildings clear
        everything beneath them. <C>areas.grow</C> by a hair keeps the dots off the shore line rather than
        touching it: masks are area arithmetic, and <C>grow</C>, <C>difference</C>, <C>union</C> and{' '}
        <C>intersect</C> shape them.
      </P>
    </>
  )
}

function Data() {
  return (
    <>
      <P>
        A profile is plain JavaScript, so a map can be computed. <C>features.where</C> keeps the features whose
        tags pass a test; tiles carry <C>render_height</C> for buildings, and ranges side by side split them into
        bands that never overlap. Each band gets its own hatch spacing: the taller, the closer the lines.
      </P>
      <P>
        <C>draw</C> returns the layer's id, so the loop's ids collect in <C>roofs</C>, which is what a mask
        wants.
      </P>
      <Note>
        A pen has one width. To make the tallest buildings read heavier, the profile draws a second outline
        0.35 mm inside the first and masks the hatch out of the strip between: weight from a double line, never
        from a wider stroke. This holds for every style the page ships.
      </Note>
    </>
  )
}

function Names() {
  return (
    <>
      <P>
        <C>modules.labels</C> writes names from the data: along each road, bent where it curves, and level inside
        the parks, sized by how much each feature matters and placed so that none covers another. Its{' '}
        <C>.lines</C> are the letters; its <C>.area</C> is what they cover, to mask the map under them.
      </P>
      <P>
        A title of your own is <C>lines.text</C>, with <C>areas.text</C> for what it covers. Positions can be
        millimetres or a share of the sheet (<C>["74%", "50%"]</C>), and <C>areas.shape</C> draws a rectangle, a
        circle or a polygon on the page. The plate masks the whole map, names included: listing the layers in{' '}
        <C>map</C> once keeps the masks short.
      </P>
    </>
  )
}

function Pens() {
  return (
    <>
      <P>
        Every layer is an SVG group, and a stroke's <C>color</C> is written on it, so a plotter's software can
        give each colour its own pen. Two pens here: blue for the water, black for the rest.
      </P>
      <P>
        The <C>compose</C> calls at the end are for the machine, not the eye. They run in the order written:{' '}
        <C>linemerge</C> joins strokes that meet end to end, <C>filter</C> drops the crumbs a pen would only dab,{' '}
        <C>simplify</C> removes points no one can see, and <C>linesort</C> orders the strokes so the pen spends
        less time in the air. Each can be given layer ids to work on, or none for all.
      </P>
    </>
  )
}

function Hand() {
  return (
    <>
      <P>
        <C>compose.hand</C> redraws every stroke as if by hand: a slow tremble shared by all of them (so lines
        that meet still meet), straight runs that bow, ends that overshoot, rings that miss closing, and with the{' '}
        <C>"sketch"</C> preset, corners drawn as crossing lines and long lines in several strokes. It goes after{' '}
        <C>linemerge</C>, so joined strokes tremble as one, and before <C>simplify</C> and <C>linesort</C>.
      </P>
    </>
  )
}
