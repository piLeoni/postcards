import { useCallback, useEffect, useRef, useState } from 'react'
import { C, Code } from './Bits'
import { GROUP_OF, NAV, SECTION_IDS } from './nav'

/**
 * The documentation page: a column on the left with the index, a reading
 * column on the right. Plain prose and code, no build step: the page reads
 * the same library the editor does, and says so where it does.
 *
 * The reader can link to a section (`#ink`), which the page follows as the
 * column is scrolled.
 */
export default function Docs() {
  const active = useScrollSpy(SECTION_IDS)
  return (
    <div className="docs-scroll min-h-0 w-full flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col lg:flex-row">
        <nav className="docs-scroll shrink-0 border-black px-[2ch] py-[2lh] lg:sticky lg:top-0 lg:max-h-screen lg:w-[30ch] lg:overflow-y-auto lg:border-r">
          <Index active={active} />
        </nav>
        <article className="min-w-0 flex-1 px-[2ch] py-[3lh] lg:px-[4ch]">
          <Body />
        </article>
      </div>
    </div>
  )
}

/** The index: one link per section, the group's sections indented under it. */
function Index({ active }) {
  return (
    <ul className="flex flex-col gap-[0.5lh]">
      {NAV.map((group) => (
        <li key={group.id}>
          <a
            href={`#${group.sub[0] ?? group.id}`}
            className={`font-bold no-underline hover:underline ${active === group.id ? '' : 'opacity-80'}`}
          >
            {active === group.id ? '● ' : ''}
            {group.title}
          </a>
          {group.sub.length ? (
            <ul className="mt-[0.25lh] ml-[1.5ch] flex flex-col border-l border-black/20 pl-[1.5ch]">
              {group.sub.map((id) => (
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

/** The titles the index shows for nested sections. */
const TITLES = {
  profiles: 'Profiles',
  engine: 'Script and engine',
  kinds: 'Handles',
  walkthrough: 'A whole map',
  'features-tiles': 'Vector tiles',
  'features-osm': 'OpenStreetMap',
  'features-where': 'features.where',
  areas: 'areas',
  lines: 'lines',
  fills: 'fills.fill',
  modules: 'modules.roads',
  terrain: 'Terrain and contours',
  ink: 'Colour and width',
  draw: 'draw',
  compose: 'compose',
  output: 'output and title',
  lengths: 'Lengths',
  errors: 'Errors',
  graph: 'The graph',
  'language-rust': 'Rust',
  'language-cli': 'Command line',
  'language-python': 'Python',
  libraries: 'The three libraries',
  projects: 'Where to read more',
}

/**
 * Which section the reader is in: the last one whose heading is above the
 * middle of the reading column, recomputed as the page is scrolled. A section
 * too short to pass the middle is still entered when it is the last above it.
 */
function useScrollSpy(ids) {
  const [current, setCurrent] = useState(ids[0])
  useEffect(() => {
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
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [ids])
  return GROUP_OF[current] ?? current
}

/** A heading with an anchor: linking to it scrolls here and marks the line. */
function H({ id, children, level = 2 }) {
  const Tag = `h${level}`
  return (
    <Tag id={id} className={`group scroll-mt-[2lh] ${level === 2 ? 'mt-[3lh] mb-[1lh] text-[1.4em]' : 'mt-[2lh] mb-[0.5lh] text-[1.15em]'} font-bold`}>
      <a href={`#${id}`} className="no-underline hover:underline">
        {children}
        <span className="ml-[1ch] opacity-0 group-hover:opacity-40">#</span>
      </a>
    </Tag>
  )
}

function P({ children }) {
  return <p className="my-[1lh] max-w-[80ch] leading-relaxed">{children}</p>
}

function UL({ children }) {
  return <ul className="my-[1lh] flex max-w-[80ch] flex-col gap-[0.5lh]">{children}</ul>
}

function LI({ children }) {
  return <li className="leading-relaxed">{children}</li>
}

/** A name and its meaning, on one line, for the tight lists. */
function T({ children }) {
  return <span className="font-bold">{children}</span>
}

function Note({ children }) {
  return (
    <p className="thin my-[1lh] max-w-[80ch] bg-[var(--background1)] px-[1ch] py-[1ch] leading-relaxed">
      {children}
    </p>
  )
}

function Body() {
  return (
    <>
      <Header />
      <Start />
      <Building />
      <Features />
      <Geometry />
      <Ink />
      <H id="reference">Reference</H>
      <H id="output">output and title</H>
      <P>
        <C>output(&#123;...&#125;)</C> says where the map is and on what paper. When its values are written
        literally on one line, the page edits them for you: dragging the frame rewrites <C>lat</C>/<C>lng</C>,
        the scale menu rewrites <C>scale</C>. Computed values work everywhere, but the page then shows the
        output as read-only.
      </P>
      <Code>{`title("Golden Gate")   // the profile's name; the page uses it for the download's file name

output({
  lat: 37.8199, lng: -122.4783,   // the centre; or address: "Piazza Maggiore, Bologna"
  width: "6in", height: "4in",    // the paper; default 6in × 4in
  scale: "1:25000",               // or the denominator alone
  bearing: 0,                     // degrees clockwise
  projection: "webmercator",      // or "utm", or a PROJ string with {lat} and {lng}
  padding: "4mm",                 // blank margin inside the edge; or [across, down]
  slices: { columns: 2, rows: 1, gutter: "2mm" },   // the output cut into sheets
  tileZoom: 14,                   // the vector tiles' zoom, up to 14
  warp: { wave: { amplitude: "1mm", wavelength: "8mm" } },   // fisheye, twirl, wave; or a list
})`}</Code>

      <H id="lengths">Lengths</H>
      <P>
        Anywhere a size is asked for, a length is a number of millimetres or a string with a unit:{' '}
        <C>"0.5mm"</C>, <C>"2cm"</C>, <C>"6in"</C>, <C>"1m"</C>.
      </P>

      <H id="errors">Errors</H>
      <P>
        Every node the library creates records the script line that created it, so an error names your own
        call, even when it happens inside a helper you wrote:
      </P>
      <Code lang="text" title="an error, as the page shows it">{`line 12 column 3: areas.union expects an area (from areas.*, engine.* or a module's .area), got lines`}</Code>
      <P>
        The same position carries through to errors the engine finds later, such as a fill pattern it does not
        know. The page underlines that line in the editor as you draw.
      </P>

      <H id="graph">The graph</H>
      <P>
        What the engine runs is the graph as JSON: one entry per node in four typed sections, plus the draws,
        the composition and the output. Each node keeps the script position that made it. Nobody writes it by
        hand, but it is what a preset ships pre-built, and <C>drawland map --dump-graph</C> prints it.
      </P>
      <Code lang="bash">{`drawland map configs/postcard.js --lat 37.8771 --lng -122.2562 --dump-graph | head -40`}</Code>
    </>
  )
}

function Languages() {
  return (
    <>
      <H id="languages">Languages</H>
      <P>
        The document is one typed graph, and languages are front ends that emit it. JavaScript is the front end
        this page uses because it is what runs in a browser; the engine neither knows nor cares which one you
        used. Below is where each front end stands today, honestly.
      </P>
      <H id="language-rust">Rust</H>
      <P>
        The engine is a library, and the graph is Rust types. <C>drawland-core</C> is free of I/O: a host reads
        bytes and hands them in. A Rust front end builds the graph with the typed API and runs it, or saves it
        as JSON.
      </P>
      <Code lang="toml" title="Cargo.toml">{`[dependencies]
drawland-core = { path = "../drawland/crates/drawland-core" }
drawland-script = { path = "../drawland/crates/drawland-script" }   # to run a JavaScript profile`}</Code>
      <Code lang="rust" title="a graph, built by hand (the shape of the API)">{`use drawland_core::{grammar, grammar_run, output::Output};

let grammar = grammar::from_json(saved_graph)?;                 // a graph, from JSON
let output = Output::from_profile(&grammar.output, /* … */)?;   // where and on what paper
let svg = grammar_run::run(&grammar, &output, inputs)?;         // SVG text`}</Code>
      <Note>
        Honest state: the shapes above are stable and the graph JSON round-trips, but the crate is not published
        on crates.io yet and the graph is documented in the source (
        <C>crates/drawland-core/src/grammar.rs</C>), not in rustdoc. Running a JavaScript profile from Rust
        already works: <C>drawland_script::evaluate</C> returns the graph.
      </Note>

      <H id="language-cli">Command line</H>
      <P>The <C>drawland</C> binary runs a profile, fetches what it reads, and writes the SVG.</P>
      <Code lang="bash">{`# A profile, and where to put it on the map.
cargo run --release -p drawland-cli -- map web/src/presets/parks.js --lat 37.8771 --lng -122.2562 -o map.svg

# An address, looked up with Nominatim.
cargo run --release -p drawland-cli -- map --address "Piazza Maggiore, Bologna" -o map.svg

# A saved graph runs as is: no interpreter, no script.
cargo run --release -p drawland-cli -- map graph.json -o map.svg

# The graph a profile builds, and stop.
cargo run --release -p drawland-cli -- map profile.js --dump-graph`}</Code>
      <div className="thin my-[1lh] max-w-[80ch] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--background1)] text-left">
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Argument</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Does</th>
            </tr>
          </thead>
          <tbody>
            <Row a="profile" b=".js" c="the profile script (default configs/postcard.js), or a saved graph (.json)" />
            <Row a="--address" b="" c="where, looked up with Nominatim; overrides the profile's output" />
            <Row a="--lat --lng" b="" c="where; overrides the profile's output" />
            <Row a="--dump-graph" b="" c="print the graph the profile builds, as JSON, and stop" />
            <Row a="-o" b="" c="output SVG (default map.svg)" />
            <Row a="--cache" b="" c="response cache (default cache/)" />
            <Row a="--offline" b="" c="use cached responses only" />
          </tbody>
        </table>
      </div>

      <H id="language-python">Python</H>
      <P>
        There is no Python front end. This is deliberate: draw.land is Rust only, and the older Python pipeline
        that drew these maps now lives in <C>reference/python/</C> to read, not to run. The reason is in{' '}
        <C>docs/plan.md</C>: the pipeline's per-theme logic was ported to Rust, one theme at a time, and the
        parity work is there to read.
      </P>
      <Code lang="python" title="what a Python front end would look like (not built)">{`# NOT AVAILABLE. This is the shape, not the API.
from drawland import Profile, fills, draw

p = Profile(lat=37.8771, lng=-122.2562, width="6in", height="4in", scale=8000)
parks = p.tiles("landcover:park,garden").polygons()
draw(p, id="park", source=fills.fill(parks, pattern="dots", spacing="0.45mm"))
p.save("map.svg")`}</Code>
      <P>
        The path to one is a binding over the same core, in the shape <C>docs/front-ends.md</C> sets out:
        emit the graph, then run it. Until then, Python users can generate a graph elsewhere and run it from
        the command line.
      </P>
    </>
  )
}

function Libraries() {
  return (
    <>
      <H id="libraries">Libraries</H>
      <P>
        draw.land is the first big user of a family of our own libraries. They are separate projects, with
        their own users and their own tests, and draw.land depends on them by path.
      </P>
      <div className="thin my-[1lh] max-w-[80ch] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--background1)] text-left">
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Library</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">What it gives draw.land</th>
            </tr>
          </thead>
          <tbody>
            <Row a="terramask" b="map and terrain tiles" c="the sea, landcover, parks and buildings as polygons; elevation and depth bands" />
            <Row a="penfill" b="pattern fills" c="the lines inside an area: dots, zigzag, waves, wood, and the rest" />
            <Row a="burin-map" b="pen-and-ink terrain" c="the hatching and stippling of elevation, in its own language" />
          </tbody>
        </table>
      </div>
      <P>
        They form a chain rather than peers: <T>terramask</T> turns tiles into polygons and grids,{' '}
        <T>burin-map</T> turns a surface into engraved marks, and draw.land turns marks into a deliverable. All
        three are on GitHub, and burin-map has front ends of its own (a CLI, Python and Node bindings, a web
        page) for people who want only terrain.
      </P>

      <H id="projects">Where to read more</H>
      <UL>
        <LI>
          <T>crates/drawland-script/drawland.d.ts</T>: the exact description of the JavaScript library, and what
          the page's editor autocompletes and type-checks against. Every name and option in this document is in
          that file.
        </LI>
        <LI>
          <T>docs/library.md</T>: the reference this page is written from, in the repository.
        </LI>
        <LI>
          <T>docs/front-ends.md</T>: the document model, and where each language front end stands.
        </LI>
        <LI>
          <T>docs/plan.md</T>: the Rust rewrite, its decisions and its history.
        </LI>
      </UL>
    </>
  )
}

function Header() {
  return (
    <header id="start" className="scroll-mt-[2lh] border-b border-black pb-[1lh]">
      {/* The wordmark is just the name: the header carries the link back to the
          map, so nothing here is a second navigation. */}
      <h1 className="text-[2em] font-bold">draw.land</h1>
      <P>
        draw.land turns any place on Earth into a <T>layered pen-and-ink SVG</T>, in paper millimetres, ready for
        a plotter, a laser cutter or a vector editor. This page builds one; this document is everything behind
        it.
      </P>
      <P>
        A drawing is described by a short <T>profile</T>: a JavaScript program that says where the map is and on
        what paper, which map data to read, what to make of it, and how to ink and stack it. The script only
        builds a graph of operations; the engine fetches what the graph reads and runs it in Rust. Nothing is
        drawn by the script, so a script runs in milliseconds whatever it asks for.
      </P>
      <P>
        Every function on this page is real today. Where something is not built yet, it says so in place.
      </P>
    </header>
  )
}

function Start() {
  return (
    <>
      <H id="start-first">The shortest way in</H>
      <P>A postcard in nine lines. Each call adds a layer; later layers go on top.</P>
      <Code title="a postcard">{`title("Berkeley")
output({ width: "6in", height: "4in", scale: "1:8000", lat: 37.8771, lng: -122.2562 })

const buildings = areas.polygons(features.tiles("buildings"))
const parks = areas.polygons(features.tiles("landcover:park,garden"))

draw({ id: "park", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm" }) })
draw({ id: "walls", from: fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm" }) })
draw({ id: "outline", from: lines.rings(buildings), stroke: "solid" })`}</Code>
      <P>
        Open the page's editor and paste that, or press the play button under one of the presets: they are
        profiles too, and every one of them is a file you can read.
      </P>
    </>
  )
}

function Building() {
  return (
    <>
      <H id="building">Building a map</H>
      <H id="profiles">Profiles</H>
      <P>
        A profile is plain modern JavaScript: <C>const</C>, loops, functions, arrow functions, destructuring,
        template strings, spread. It has no I/O: no <C>fetch</C>, no files, no <C>Date</C>, no{' '}
        <C>Math.random</C>, so the same script always draws the same map, and opening someone else's profile is
        safe. A loop that runs away stops with an error after a million iterations.
      </P>
      <P>
        Where a profile lives depends on the front end: in the page's editor, as a <C>.js</C> file for the
        command line, or inside a Rust or Python program (<T>Languages</T> below).
      </P>

      <H id="engine">Script and engine</H>
      <P>
        The script runs once, in milliseconds, before any data is fetched. It does not draw: each call adds a
        node to a <T>graph</T> and returns a handle to that node. <C>areas.polygons(...)</C> returns a handle,
        not polygons; the engine then fetches what the graph reads and runs it in Rust. Twenty park kinds from
        a loop cost nothing at draw time beyond the twenty fills they ask for.
      </P>
      <Code lang="text" title="the shape of it">{`profile.js ──▶ graph of operations ──▶ validate ──▶ run in Rust ──▶ SVG
             (JSON, typed nodes)`}</Code>

      <H id="kinds">Handles</H>
      <P>Three kinds of handle, and every function says which one it takes.</P>
      <div className="thin my-[1lh] max-w-[80ch] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--background1)] text-left">
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Kind</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Made by</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Used for</th>
            </tr>
          </thead>
          <tbody>
            <Row a="Features" b="features.*" c="choosing what to build from; never drawn on its own" />
            <Row a="Area" b="areas.*, engine.*, modules.roads().area" c="fills, masks, rings, clipping" />
            <Row a="Lines" b="lines.*, fills.fill, modules.roads().outlines" c="draw" />
          </tbody>
        </table>
      </div>

      <H id="walkthrough">A whole map</H>
      <P>
        A city block, layer by layer: the sea and the river, then parks, then buildings each hatched on its own,
        then the road network with its bridges, then the walls drawn once where buildings share them.
      </P>
      <Code title="walkthrough">{`title("A block of the city")
output({ lat: 48.8575, lng: 2.2945, width: "6in", height: "4in", scale: "1:10000", bearing: 0 })

// Map data. Tiles are fast and cached; OSM has every tag but is slower.
const bldg = features.tiles("buildings")
const green = features.tiles("landcover:park,garden,grass")
const wet = features.tiles("water")
const oceanTiles = features.tiles("ocean")
const ways = features.tiles("roads", "paths")

// Polygons from the features, merged: one area each.
const buildings = areas.polygons(bldg)
const parks = areas.polygons(green)
const frame = engine.frame()
const ocean = areas.extendToFrame(areas.grow(areas.intersect(areas.polygons(oceanTiles), frame), "0.35mm"), frame)
const water = areas.union(areas.polygons(wet), ocean)

// Lines: rings for outlines, patterns from penfill for fills.
const bldgFill = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })
const parkFill = fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.2mm" })
const waterFill = fills.fill({ in: water, pattern: "waves", spacing: "0.75mm" })

// Roads with real widths, crossings and bridges, from the ways.
const roads = modules.roads({ from: ways })

// Bottom to top. The id names the SVG group: a plotter can give each its own pen.
draw({ id: "water", from: waterFill, stroke: { color: "#6b8fa3", width: 0.2 } })
draw({ id: "park", from: parkFill, stroke: { color: "#7a8b5a", width: 0.15 } })
draw({ id: "bldg", from: bldgFill, stroke: { color: "#444", width: 0.12 } })
draw({ id: "bldg_out", from: lines.rings(buildings), stroke: { color: "#000", width: 0.3 } })
draw({ id: "roads", from: roads.outlines, stroke: "solid" })
draw({ id: "roads_center", from: roads.centerlines, stroke: { style: "dash", dash: "0.3mm", gap: "0.35mm" } })
draw({ id: "trails", from: roads.trails, stroke: { style: "dotted", mark: "0.15mm", gap: "0.4mm" } })

// Buildings and the water hide the ink under them, wherever it was drawn.
compose.mask({ name: "on_buildings", from: buildings, occludes: ["roads", "park", "water"] })
compose.mask({ name: "on_water", from: water, occludes: ["roads", "park"] })`}</Code>
    </>
  )
}

function Features() {
  return (
    <>
      <H id="features">Reading map data</H>
      <P>
        Two sources, and a profile can use either or both. <T>features.tiles</T> is fast and cached;{' '}
        <T>features.osm</T> has every tag but is slower and often busy.
      </P>
      <H id="features-tiles">Vector tiles</H>
      <P>
        <C>features.tiles(...items)</C> reads OpenFreeMap's vector tiles, through the <T>terramask</T> library.
        An item is a preset or a rule. Each feature arrives whole, mended across tile edges.
      </P>
      <Code>{`const bldg = features.tiles("buildings")
const green = features.tiles("landcover:park,garden")      // layer:class,class
const lawns = features.tiles("landcover:grass/grass")      // class/subclass
const both = features.tiles(["buildings", "roads"])        // a list, or several arguments`}</Code>
      <P>
        Presets: <C>buildings</C>, <C>roads</C>, <C>paths</C>, <C>rail</C>, <C>water</C>, <C>lakes</C>,{' '}
        <C>rivers</C>, <C>ocean</C>, <C>land</C>, <C>forest</C>, <C>grass</C>, <C>parks</C>, <C>farmland</C>,{' '}
        <C>wetland</C>, <C>sand</C>, <C>rock</C>, <C>glacier</C>, <C>urban</C>. A rule names a class or a
        subclass on one of OpenMapTiles' layers.
      </P>
      <H id="features-osm">OpenStreetMap</H>
      <P>
        <C>features.osm(tags)</C> fetches OSM features with any of these tags, from Overpass.
      </P>
      <Code>{`const parks = features.osm({ leisure: ["park", "garden"] })
const walls = features.osm({ barrier: true, except: { barrier: "fence" } })
const metro = features.osm({ railway: ["subway", "light_rail"], underground: true })`}</Code>
      <UL>
        <LI>
          <T>tags</T>: any key with a value, a list of values, or <C>true</C> for present.
        </LI>
        <LI>
          <T>except</T>: drop features another tag selected.
        </LI>
        <LI>
          <T>underground</T>: keep tunnels and <C>layer &lt; 0</C>, dropped by default.
        </LI>
      </UL>
      <P>
        Roads are the usual reason to mix the two sources: OSM carries <C>width</C> and <C>lanes</C>, which
        give real widths, and the tiles do not.
      </P>
      <div className="thin my-[1lh] max-w-[80ch] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--background1)] text-left">
              <th className="border-b border-black px-[1ch] py-[0.25lh]">OSM tag</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Tiles</th>
            </tr>
          </thead>
          <tbody>
            <Row a="building=*" b={'"buildings"'} />
            <Row a="leisure=park / garden" b={'"landcover:park,garden"'} />
            <Row a="landuse=grass, natural=wood" b={'"landcover:grass/grass,wood"'} />
            <Row a="water=*, natural=water" b={'"water:lake,river,pond,dock"'} />
            <Row a="highway=*" b={'"roads", "paths"'} />
          </tbody>
        </table>
      </div>
      <H id="features-where">features.where</H>
      <P>
        <C>features.where(of, tags)</C> keeps the features whose tags pass every test: a value, a list,{' '}
        <C>true</C> or <C>false</C> for present or absent, or a <T>range</T> on a number. This is how a map
        gets its data varied: band a set by its own attributes and ink each band its own way.
      </P>
      <Code>{`const bldg = features.tiles("buildings")
const roads = features.tiles("roads")

// Height bands: min is included, max is not, so bands sit side by side.
const low  = features.where(bldg, { render_height: { max: 15 } })
const mid  = features.where(bldg, { render_height: { min: 15, max: 40 } })
const tall = features.where(bldg, { render_height: { min: 40 } })

// Values work the same.
const major = features.where(roads, { class: ["motorway", "trunk", "primary"] })
const unpaved = features.where(roads, { surface: "unpaved" })`}</Code>
      <P>
        The tags are the feature's own: the vector tile's attributes (<C>render_height</C>, <C>class</C>,{' '}
        <C>subclass</C>, <C>rank</C>, <C>brunnel</C>) or, for <C>features.osm</C>, the OSM tags (
        <C>building:levels</C>, <C>width</C>, <C>lanes</C>). A value that is missing, or not a number, fails a
        range, so the bands never overlap: <C>&#123; min: 15 &#125;</C> and <C>&#123; max: 15 &#125;</C> cover
        a set exactly once.
      </P>
    </>
  )
}

function Geometry() {
  return (
    <>
      <H id="geometry">Areas and lines</H>
      <P>Features become polygons, polygons become lines, and lines go on paper.</P>
      <H id="areas">areas</H>
      <P>
        <C>areas.polygons(features)</C> is the way in. Everything else works on areas.
      </P>
      <Code>{`const buildings = areas.polygons(features.tiles("buildings"))

const one = areas.union(a, b)                    // or areas.union([a, b])
const ring = areas.difference(parks, water)      // base without the cuts
const shore = areas.intersect(buildings, water)
const solid = areas.fillHoles(blocks)            // yards in blocks, lakes in parks
const fat = areas.grow(roads.area, "0.3mm")      // negative shrinks
areas.extendToFrame(sea, frame)                 // west/east to the card when tiles stop short

engine.frame()                                   // the paper's rectangle
engine.ocean()                                   // shorthand for ocean tiles + grow + extendToFrame`}</Code>
      <P>
        <C>areas.grow</C> is the workhorse of cheap effects: a grown area minus itself is a ring, a grown river
        gives distance bands, a shrunk area insets a fill. Look at the <T>ink by distance</T> preset in the
        index for the second one.
      </P>

      <H id="lines">lines</H>
      <Code>{`lines.rings(area, { exteriorOnly })   // the polygons' outlines, holes too by default
lines.of(features)                   // the features' own lines (roads, walls)
lines.segments(features)             // every edge; shared walls come twice
lines.dedupe(lines)                  // the same segment drawn twice, once
lines.merge(lines)                   // lines that meet end to end, joined
lines.join(a, b, ...)                // several sets as one
lines.clip(lines, area, { invert })  // keep the parts inside (outside with invert)`}</Code>

      <H id="fills">fills.fill</H>
      <P>
        <C>fills.fill(&#123; in: area, pattern, ... &#125;)</C> fills an area with one of penfill's patterns and
        returns the lines. It is the main source of texture in a drawing.
      </P>
      <Code>{`draw({ id: "park", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.2mm" }) })

// One pattern per building instead of one over the union: each roof hatched on its own.
const walls = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })

// Any lines can be a fill's content, cut to the area.
const gardens = fills.fill({ in: parks, content: lines.terrain({ style: { line_space: 6 } }) })`}</Code>
      <UL>
        <LI>
          <T>pattern</T>: <C>rectilinear</C>, <C>zigzag</C>, <C>lines</C>, <C>grid</C>, <C>triangles</C>,{' '}
          <C>honeycomb</C>, <C>dots</C>, <C>waves</C>, <C>wave_grid</C>, <C>scales</C>, <C>sunburst</C>,{' '}
          <C>spiral</C>, <C>concentric</C>, <C>hilbert</C>, <C>stipple</C>, <C>grass</C>, <C>gravel</C>,{' '}
          <C>scribble</C>, <C>truchet</C>, <C>marble</C>, <C>wood</C>, <C>cracks</C>, <C>terrazzo</C>,{' '}
          <C>chess</C>, <C>pat</C> (a classic hatch by <C>name</C>), <C>none</C>.
        </LI>
        <LI>
          <T>spacing</T> (default 0.5mm), <T>angle</T> (degrees), <T>mark</T> (dot size), <T>inset</T>,{' '}
          <T>seed</T> (the random patterns).
        </LI>
        <LI>
          <T>anchor</T>: <C>"global"</C> (default) lays one lattice over the whole map, so neighbouring areas
          meet without a seam; <C>"local"</C> places it on each shape. <T>shift</T> moves it, <T>centre</T>{' '}
          places a sunburst or spiral.
        </LI>
        <LI>
          Per pattern: <C>lattice</C> (dots), <C>line_width</C> (honeycomb), <C>hatch</C> (terrazzo),{' '}
          <C>cell</C> (chess), <C>name</C> and <C>scale</C> (pat).
        </LI>
        <LI>
          <T>source</T>: <C>&#123; file, size, position, repeat &#125;</C> draws an SVG into the area instead.
        </LI>
      </UL>

      <H id="modules">modules.roads</H>
      <P>
        <C>modules.roads(&#123; from &#125;)</C> builds the road network with real widths, crossings and
        bridges, from OSM's <C>highway</C> features or from tile roads. Call it once.
      </P>
      <Code>{`const roads = modules.roads({ from: features.tiles("roads", "paths") })

draw({ id: "roads", from: roads.outlines })                          // the carriageway's edge
draw({ id: "center", from: roads.centerlines, stroke: "dash" })
draw({ id: "trails", from: roads.trails })
compose.mask({ from: roads.area, occludes: ["park", "water"] })       // the strip they cover`}</Code>
      <div className="thin my-[1lh] max-w-[80ch] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--background1)] text-left">
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Output</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">Kind</th>
              <th className="border-b border-black px-[1ch] py-[0.25lh]">What</th>
            </tr>
          </thead>
          <tbody>
            <Row a="roads.area" b="area" c="the carriageway and the strip each trail covers: the mask" />
            <Row a="roads.outlines" b="lines" c="the carriageway's edge" />
            <Row a="roads.centerlines" b="lines" c="a centre line down each road 6 m wide or more" />
            <Row a="roads.details" b="lines" c="the centre lines already dashed, and the seams" />
            <Row a="roads.trails" b="lines" c="footways, paths, tracks, steps, cycleways" />
            <Row a="roads.seams" b="lines" c="where a bridge deck crosses the road below" />
          </tbody>
        </table>
      </div>
      <P>
        Widths come from OSM's <C>width</C> or <C>lanes</C> (3 m a lane). Tile roads have neither, so their
        class decides. The module's lines can be drawn, not transformed:{' '}
        <C>lines.clip(roads.outlines, ...)</C> is an error.
      </P>

      <H id="terrain">Terrain and contours</H>
      <P>
        Two ways to draw from elevation. <C>lines.terrain(options)</C> draws pen-and-ink hatching along the
        slope, by the <T>burin-map</T> library, over the elevation under the output. It runs the same language
        burin does, so a burin document can be written here whole.
      </P>
      <Code>{`// Hatching, denser in shadow.
draw({ id: "relief", from: lines.terrain({ color: "#8a7a5c", style: { line_space: 6 } }) })

// Stippled sea, denser towards the shore, plus the shore itself.
draw({ id: "sea", from: lines.terrain({ draw: "dots", where: { depthMax: 0 }, color: "#7aa6c2" }) })

// A whole burin document: its own language, evaluated here.
const natural = burin.terrain((b) => {
  b.batch({ angle: 90, shade: b.lerp("#c9bda6", "#3a2c1c", b.tone), style: { space: 2.4, space_dark: 0.8 } })
  b.shore({ color: "#3a2c1c", lines: 2 })
})
draw({ id: "natural", from: natural })`}</Code>
      <P>
        <T>lines.contours(&#123; from, to &#125;)</T> is a flat fill of a height band, the cheapest way to draw
        elevation as a stack. Call it in a loop, one layer per belt, and ink each belt by its height:
      </P>
      <Code title="a contour map, 40 m at a time">{`const step = 40, top = 800
const colors = ["#2a9d8f", "#8ab17d", "#e9c46a", "#bc6c25", "#5c3a21"]
// The frame's own edge closes every belt; a hair inside it, only the contours stay.
const inside = areas.grow(engine.frame(), "-0.3mm")

for (let h = 0; h < top; h += step) {
  const t = ink.at(h, 0, top)
  const index = h % (step * 5) === 0
  draw({
    id: \`c\${h}\`,
    from: lines.clip(lines.contours({ from: h }), inside),
    stroke: { color: ink.ramp(colors, t), width: index ? ink.width(0.3, 0.6, t) : ink.width(0.1, 0.25, t) },
  })
}`}</Code>
      <Note>
        Terrain reads elevation tiles, which the host fetches on its own when a profile draws terrain, so a
        profile that never asks costs nothing.
      </Note>
    </>
  )
}

function Ink() {
  return (
    <>
      <H id="ink">Ink and stacking</H>
      <H id="ink-colour">Colour, width and cap</H>
      <P>
        A stroke is a style keyword or an object. The object carries the dashes and the ink: a colour, a width
        in millimetres, and how the ends of a dash look.
      </P>
      <Code>{`draw({ id: "outline", from: lines.rings(buildings), stroke: "solid" })

draw({
  id: "roads_center",
  from: roads.centerlines,
  stroke: { style: "dash", dash: "0.3mm", gap: "0.35mm", color: "#8B0000", width: "0.2mm", cap: "butt" },
})`}</Code>
      <UL>
        <LI>
          <T>style</T>: <C>solid</C> (default), <C>dash</C>, <C>dotted</C>, <C>none</C>.
        </LI>
        <LI>
          <T>dash</T>, <T>gap</T>, <T>mark</T>: the sizes of the dashes; a length of millimetres.
        </LI>
        <LI>
          <T>color</T>: any CSS colour the SVG takes.
        </LI>
        <LI>
          <T>width</T>: a length of millimetres; 0.1 mm is a fine pen, 0.5 mm a marker.
        </LI>
        <LI>
          <T>cap</T>: <C>round</C>, <C>square</C> or <C>butt</C>.
        </LI>
      </UL>
      <P>
        A group's ink is written on the SVG group and inherited by its lines, so a vector editor or a plotter
        sees each layer's colour and pen width directly.
      </P>

      <H id="ink-by-data">Ink worked out from data</H>
      <P>
        Because a profile is a program, a layer's ink can be computed. <C>ink</C> is three small helpers for
        the arithmetic that comes up: a colour along a ramp, a width between two sizes, and where a value sits
        in a range. Pair them with <C>features.where</C> and a set draws itself in bands.
      </P>
      <Code title="ink by building height">{`const heights = [0, 15, 30, 60, 120, 250, 600]
const colors = ["#e9c46a", "#e76f51", "#9d3c5b", "#2b1d3f"]
const bldg = features.tiles("buildings")

for (let i = 0; i < heights.length - 1; i++) {
  const [lo, hi] = [heights[i], heights[i + 1]]
  const t = i / (heights.length - 2)                      // 0 at the shortest band, 1 at the tallest
  const band = areas.polygons(features.where(bldg, { render_height: { min: lo, max: hi } }))

  // Taller: a warmer, darker colour and a heavier outline.
  const color = ink.ramp(colors, t)
  draw({ id: \`h\${lo}_fill\`, from: fills.fill({ in: band, per: "feature", pattern: "lines", spacing: "0.6mm" }),
         stroke: { color, width: ink.width(0.1, 0.18, t) } })
  draw({ id: \`h\${lo}_ring\`, from: lines.rings(band),
         stroke: { color, width: ink.width(0.12, 0.6, t), cap: "square" } })
}`}</Code>
      <Code lang="js" title="the three helpers">{`ink.ramp(["#fde68a", "#7c2d12"], 0.5)   // a colour between two, along evenly spaced stops
ink.width(0.1, 0.6, 0.5)             // "0.35mm": a width between two
ink.at(120, 0, 600)                  // 0.2: where a value sits between two ends, kept to 0 to 1`}</Code>
      <P>
        Nothing here is special to colour or width: it is arithmetic on ordinary numbers, so a table, a
        function of the position, or a value read from the data all work the same way. What is not in the
        helpers is quick to write.
      </P>
      <Note>
        A colour or width that varies along a single line, dash by dash, is not in the JavaScript library yet.
        burin's own terrain does vary its colour and width per dash, but draw.land currently draws those lines
        as plain lines and loses the variation.
      </Note>

      <H id="draw">draw</H>
      <P>
        <C>draw(&#123; id, from, stroke &#125;)</C> puts lines on paper as one SVG group and returns its id.
        Groups are written in draw order, which cuts nothing; masks do.
      </P>
      <Code>{`const group = draw({ id: "walls", from: lines.dedupe(lines.segments(bldg)), stroke: "solid" })
compose.mask({ from: buildings, occludes: [group] })`}</Code>
      <P>
        Since <C>draw</C> returns the id, groups collect naturally in an array, which is what masks want.
      </P>

      <H id="compose">compose</H>
      <P>
        Later layers go on top, but that is only order: it does not stop ink showing through from below. A
        mask does, by hiding exactly the groups it names, wherever they sit in the order.
      </P>
      <Code>{`compose.order("water", "park", "bldg", "roads")   // the sequence groups are written in; cuts nothing

compose.mask({ name: "on_buildings", from: buildings, occludes: ["roads", "park"] })
compose.mask({ name: "on_water", from: water, occludes: ["roads"] })

compose.clip("auto")     // which masks cut: "auto" (default), "none", or exactly these areas`}</Code>
      <P>
        A group no mask lists is never cut, so a second ink meant to stay whole is drawn last and listed by
        none. A mask that should spare part of another is area work first:{' '}
        <C>from: areas.difference(parks, water)</C>.
      </P>
    </>
  )
}

function Row({ a, b, c }) {
  return (
    <tr>
      <td className="border-b border-black/20 px-[1ch] py-[0.25lh] align-top">
        <T>{a}</T>
      </td>
      <td className="border-b border-black/20 px-[1ch] py-[0.25lh] align-top">
        <C>{b}</C>
      </td>
      <td className="border-b border-black/20 px-[1ch] py-[0.25lh] align-top opacity-80">{c}</td>
    </tr>
  )
}
export { C, Code, H, P, UL, LI, T, Note }
