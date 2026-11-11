import { C, Code, H, LI, Note, P, T, Table, UL } from './Bits.jsx'

/**
 * The rules the tutorial uses without stopping on them, each in one place:
 * the language, the three kinds of value, lengths and scale, map data, order
 * and masks, pens, errors; then recipes for what the tutorial leaves out.
 */
export const CONCEPTS_IDS = ['concept-language', 'concept-handles', 'concept-lengths', 'concept-data', 'concept-masks', 'concept-pens', 'concept-errors', 'concept-recipes']
export const CONCEPTS_TITLES = {
  'concept-language': 'The language',
  'concept-handles': 'Features, areas, lines',
  'concept-lengths': 'Paper and ground',
  'concept-data': 'Where data comes from',
  'concept-masks': 'Order and masks',
  'concept-pens': 'One pen, one width',
  'concept-errors': 'Errors',
  'concept-recipes': 'Recipes',
}

export default function Concepts() {
  return (
    <>
      <H id="concepts">Concepts</H>

      <H id="concept-language" level={3}>
        The language
      </H>
      <P>
        A profile is plain modern JavaScript: <C>const</C>, loops, functions, arrow functions, destructuring,
        template strings, spread. What it adds is the draw.land library (<C>features</C>, <C>areas</C>,{' '}
        <C>lines</C>, <C>fills</C>, <C>modules</C>, <C>draw</C>, <C>compose</C>, <C>output</C>), and what it
        takes away is everything that would make a map differ from one run to the next: no <C>fetch</C>, no
        files, no <C>Date</C>, no <C>Math.random</C>. The same script on the same data always draws the same
        map, and opening someone else's profile is safe. A loop that runs away stops with an error.
      </P>
      <P>
        The script runs once, before any data is fetched, and does not draw. Each library call adds a step to a
        plan (a graph of operations) and returns a handle to it; the engine reads the plan, fetches what it
        needs, and runs it in Rust. The web page and <C>drawland map</C> run the same engine, so a profile draws
        the same in both. The patterns that look random take a <C>seed</C>: the same seed draws the same lines.
      </P>
      <Code lang="text" title="the shape of it">{`profile.js ──▶ plan (graph of operations) ──▶ fetch tiles, OSM, terrain ──▶ run in Rust ──▶ layered SVG`}</Code>

      <H id="concept-handles" level={3}>
        Features, areas, lines
      </H>
      <P>Three kinds of handle, and every function says which one it takes and returns.</P>
      <Table
        head={['Kind', 'Made by', 'Used for']}
        rows={[
          ['Features', <C key="f">features.*</C>, 'choosing what to build from; never drawn on its own'],
          ['Area', <C key="a">areas.*, engine.frame(), fills.cover, a module's .area</C>, 'fills, masks, outlines, clipping'],
          ['Lines', <C key="l">lines.*, fills.fill, a module's line outputs</C>, 'draw'],
        ]}
      />
      <P>
        The flow is always the same direction: features become areas (<C>areas.polygons</C>,{' '}
        <C>areas.around</C>) or lines (<C>lines.of</C>); areas become lines (<C>lines.rings</C>,{' '}
        <C>fills.fill</C>); lines become areas again only by <C>areas.buffer</C>, a strip round them. Modules
        (<C>roads</C>, <C>labels</C>, <C>graticule</C>) return an object of named outputs, each one of these
        kinds.
      </P>

      <H id="concept-lengths" level={3}>
        Paper and ground
      </H>
      <P>
        Everything is measured on the paper. A length is a number of millimetres or a string with a unit:{' '}
        <C>0.5</C>, <C>"0.5mm"</C>, <C>"2cm"</C>, <C>"6in"</C>. A hatch's spacing, a mask's clearance, a
        title's size stay the same on the card whatever the scale, which is what a pen needs.
      </P>
      <P>
        When something has a real size on the ground, convert it: <C>engine.scale()</C> is the scale's
        denominator, so <C>metres * 1000 / engine.scale()</C> is millimetres on paper. Road widths are the
        exception that does this for you: <C>modules.roads</C> takes ground metres by default (
        <C>widthMode: "ground"</C>), so a wider road is wider on any card.
      </P>
      <Code>{`output({ lat: 37.802, lng: -122.263, width: "6in", height: "4in", scale: "1:8000" })

// A tree crown 6 m across, whatever the scale: 0.75 mm at 1:8000.
const crown = (6 * 1000) / engine.scale()`}</Code>
      <P>
        <C>output</C> holds the rest of the sheet: <C>bearing</C> turns the map, <C>padding</C> leaves a blank
        margin, <C>slices</C> cuts it into sheets (a poster in tiles), <C>projection</C> chooses web mercator
        (what the page's map shows) or UTM (true distances), and <C>warp</C> bends the ground under a fixed
        frame. When its values are written literally, the page edits them for you as you drag and scale the
        card.
      </P>

      <H id="concept-data" level={3}>
        Where data comes from
      </H>
      <UL>
        <LI>
          <T>features.tiles</T>: OpenFreeMap's vector tiles, through terramask. Fast and cached: a card is a
          handful of tiles. Presets (<C>"buildings"</C>, <C>"water"</C>, <C>"parks"</C>, <C>"roads"</C>,{' '}
          <C>"road_names"</C>…) or rules on the OpenMapTiles layers (<C>"landcover:park,garden"</C>,{' '}
          <C>"landcover:grass/grass"</C> for a subclass). Every preset in the gallery reads from tiles.
        </LI>
        <LI>
          <T>features.osm</T>: any OpenStreetMap tag, from Overpass. Slower and sometimes busy, but it has
          everything: <C>{'{ barrier: true, except: { barrier: "fence" } }'}</C>, tunnels with{' '}
          <C>underground: true</C>, and the <C>width</C> and <C>lanes</C> that give roads their real widths.
        </LI>
        <LI>
          <T>features.geojson</T>: a dataset by URL, by a file beside the profile, or written inline. Its
          properties become tags; a point's third coordinate is <C>geom:z</C>. In the browser, drop a{' '}
          <C>.geojson</C> on the page and read it by its file name.
        </LI>
        <LI>
          <T>features.json</T>: points from plain JSON, such as a live API: dot-paths say where the items, the
          latitude and the longitude are. Cached 15 minutes, so a map of live data moves when drawn again.
        </LI>
        <LI>
          <T>Elevation</T>: <C>lines.terrain</C>, <C>lines.contours</C>, <C>areas.band</C> and{' '}
          <C>burin.terrain</C> read terrain tiles, fetched only when a profile asks for them.
        </LI>
      </UL>
      <P>
        <C>features.where(set, tests)</C> narrows any of them by their tags: a value, a list, <C>true</C> /{' '}
        <C>false</C> for present or absent, or a range <C>{'{ min, max }'}</C> with <C>min</C> included and{' '}
        <C>max</C> not. A missing or non-numeric value fails a range, so bands side by side cover a set exactly
        once.
      </P>
      <Table
        head={['OSM tag', 'Tiles']}
        rows={[
          ['building=*', <C key="1">"buildings"</C>],
          ['leisure=park / garden', <C key="2">"landcover:park,garden" or "parks"</C>],
          ['landuse=grass, natural=wood', <C key="3">"landcover:grass/grass,wood"</C>],
          ['water=*, natural=water', <C key="4">"water" (or "lakes", "rivers", "ocean")</C>],
          ['highway=*', <C key="5">"roads", "paths"</C>],
          ['railway=*', <C key="6">"rail"</C>],
        ]}
      />

      <H id="concept-masks" level={3}>
        Order and masks
      </H>
      <P>
        Layers are written in the order they are drawn, first at the bottom; <C>compose.order(...ids)</C>{' '}
        rearranges them. Order cuts nothing: on paper, a line drawn on top does not hide the line under it.{' '}
        <C>compose.mask({'{ from, occludes }'})</C> does: it hides the layers it lists, inside the area, wherever
        they sit in the order. A layer no mask lists is never cut, so a second ink meant to stay whole is simply
        listed by none.
      </P>
      <P>
        A mask that should spare part of something is area work first (<C>areas.difference(parks, water)</C>
        ), and a mask a little larger than its shape keeps lines from touching it (<C>areas.grow(water, 0.3)</C>
        ). <C>fills.cover</C> gives the area a pattern really covers, for the patterns that leave clearings
        (tree crowns, clouds), so the map is cleared under the crowns and not under the gaps.
      </P>

      <H id="concept-pens" level={3}>
        One pen, one width
      </H>
      <P>
        Each <C>draw</C> is an SVG group with its ink written on it, so a vector editor or a plotter sees every
        layer's colour directly, and a colour is a pen. A pen has one width, so every style keeps one stroke
        width per ink. A line meant to read heavier is drawn twice, offset by a gap a little wider than the nib
        (<C>lines.rings(areas.grow(shape, -0.35))</C> inside an outline, <C>lines.rings(areas.buffer(lines,
        0.2))</C> either side of a line); a line meant to read solid is several passes side by side.
      </P>
      <Note>
        <C>ink.ramp</C> picks a colour along a ramp and <C>ink.width</C> a width between two; the widths are for
        output meant for print or the screen (the Schoolroom atlas). For the pen, vary the colour, the spacing
        of a hatch, or the number of lines, never the width.
      </Note>
      <P>
        The <C>compose</C> optimizers prepare the strokes for the machine and run in the order written:{' '}
        <C>linemerge</C>, <C>filter</C>, <C>deoverlap</C> (the same stroke drawn twice, once), <C>hand</C>,{' '}
        <C>simplify</C>, <C>orient</C> (strokes flowing one way, so the pen does not skip), <C>reloop</C> and{' '}
        <C>linesort</C> last. Each takes layer ids, or none for all.
      </P>

      <H id="concept-errors" level={3}>
        Errors
      </H>
      <P>
        Every handle records the line that made it, so an error names your own call, even inside a helper you
        wrote, and so do the errors the engine finds later (a pattern it does not know):
      </P>
      <Code lang="text" title="an error, as the page shows it">{`line 12 column 3: areas.union expects an area (from areas.*, engine.* or a module's .area), got lines`}</Code>
      <P>
        The page's editor checks a profile against the library's types as you write, underlining an area passed
        where lines go before anything runs, and underlines the line an error points to once it does.
      </P>

      <H id="concept-recipes" level={3}>
        Recipes
      </H>
      <P>
        <T>Contours, a belt at a time.</T> <C>lines.contours({'{ from, to }'})</C> is one belt of heights; a loop
        stacks them, each its own layer, inked along a ramp.
      </P>
      <Code title="a contour map, 40 m at a time">{`const step = 40, top = 800
const colors = ["#2a9d8f", "#8ab17d", "#e9c46a", "#bc6c25", "#5c3a21"]
// The frame's own edge closes every belt; a hair inside it, only the contours stay.
const inside = areas.grow(engine.frame(), -0.3)

for (let h = 0; h < top; h += step) {
  draw({
    id: \`c\${h}\`,
    from: lines.clip(lines.contours({ from: h, to: h + step }), inside),
    stroke: { color: ink.ramp(colors, ink.at(h, 0, top)) },
  })
}`}</Code>
      <P>
        <T>Terrain by burin.</T> <C>burin.terrain(b =&gt; …)</C> writes a burin-map document inside the profile:
        streamlines down the slope, the shore, the sea stippled or in currents. Salt and stone is all burin;
        City grain uses it for the ground under the city.
      </P>
      <Code>{`const ground = burin.terrain((b) => {
  b.batch({ angle: 90, style: { space: 3, space_dark: 0.8 } })   // hatching, closer in shadow
  b.water("dots", { follow: "shore", style: { space: 10 } })     // the sea, stippled along the coast
  b.shore({ lines: 2 })                                           // the coast, twice
}, { water: areas.polygons(features.tiles("water")) })
draw({ id: "ground", from: ground })`}</Code>
      <P>
        <T>Another place in a frame.</T> <C>view({'{ id, at, size, lat, lng, scale }'}, style)</C> draws another
        place, at its own scale, into a rectangle of the page, in a preset by name or a function of its own:
        insets, or Bonjour de France's four corners.
      </P>
      <Code>{`// The Golden Gate in a corner of the card, in City Grain. \`at\` is the top-left corner, in mm.
view({ id: "inset", at: [110, 8], size: [36, 24], lat: 37.8199, lng: -122.4783, scale: "1:40000" }, "city-grain")
// Its frame, and the page's own layers cleared under it (a view is drawn under them).
const box = areas.shape({ at: [128, 20], rect: [36, 24] })
draw({ id: "inset_frame", from: lines.rings(box) })
compose.mask({ from: box, occludes: ["buildings", "roads"] })`}</Code>
      <P>
        <T>An atlas plate.</T> <C>modules.graticule({'{ in, step, ticks }'})</C> draws meridians and parallels
        round a rectangle of the page, through the map's own projection, with a border of keys and the degrees.
        The Schoolroom atlas is built on it.
      </P>
    </>
  )
}
