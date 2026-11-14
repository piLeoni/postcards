import { PRESETS } from '../lib/presets'
import { C, H, P } from './Bits.jsx'

/**
 * How each preset is made, in a line or two: what to look for in its script.
 * The picture is `public/docs/gallery/<id>.webp`, drawn by the CLI
 * (`web/scripts/render-docs.sh gallery`). `lite` names its short version in
 * the "Styles, simplified" section, when it has one.
 */
const MADE = {
  'city-grain': {
    how: 'Every surface its own penfill pattern, tree crowns as isoline stacks, the ground under it all in burin hatching, and names that clear what they cross.',
    uses: ['fills.fill', 'fills.cover', 'burin.terrain', 'modules.labels'],
    lite: 'lite-city-grain',
  },
  'karl-the-fog': {
    how: 'City Grain under a sky of cumulus. The clouds are a pattern; their footprint masks the city, and the same footprint moved down-sun is stippled as their shadow.',
    uses: ['pattern: "clouds"', 'fills.cover', 'areas.move', 'compose.mask'],
    lite: 'lite-karl-the-fog',
  },
  'beton-brut': {
    how: 'A heavy nib: streets as parallel offset lines, weight from passes side by side rather than a wider pen, dotted building masses, frayed swells at sea.',
    uses: ['areas.buffer', 'lines.rings', 'fray', 'compose.deoverlap'],
  },
  'napkin-sketch': {
    how: 'Very little drawn, all of it loosened by compose.hand at the end: single-stroke streets, hatched blocks, scalloped waves, and one quick symbol for each kind of ground, from doodled trees to reeds on the salt marsh.',
    uses: ['compose.hand', 'pattern: "scallops"', 'pattern: "doodle-trees"', 'pattern: "marsh"'],
    lite: 'lite-napkin-sketch',
  },
  'salt-and-stone': {
    how: 'Nothing built, all burin: hand-drawn contours on the land, a concentric coast, and sea currents that curl as the flow turns.',
    uses: ['burin.terrain', 'b.batch', 'b.water', 'b.shore'],
  },
  'schoolroom-atlas': {
    how: 'A coloured physical map for print: hypsometric tints from elevation bands, depths in blue, towns generalised from everything built, a graticule and its keys round an atlas plate.',
    uses: ['areas.band', 'areas.grow', 'modules.graticule', 'lines.terrain'],
  },
  'shaky-ground': {
    how: 'Live data: the USGS feed of the last 30 days of quakes, banded by magnitude into dot sizes and by depth into inks, over Natural Earth countries.',
    uses: ['features.geojson', 'features.where', 'areas.around', 'lines.text'],
    lite: 'lite-shaky-ground',
  },
  'rush-hour': {
    how: "Boston's T as a transit map with every train where it is now: lines from GeoJSON, trains from the MBTA's plain-JSON API, beads that clear what is under them.",
    uses: ['features.json', 'features.geojson', 'areas.buffer', 'modules.labels'],
  },
  'red-pencil': {
    how: 'A GeoJSON of your own over a quiet base map, for two pens: the base map stops short of every red stroke, so the inks never touch.',
    uses: ['features.geojson', 'areas.buffer', 'compose.mask'],
  },
  'cookie-cutter': {
    how: "A state's silhouette as a die-cut card: one pattern for every height belt, closer the higher, and the border on a layer of its own for the knife.",
    uses: ['areas.band', 'fills.fill', 'areas.shape', 'lines.text'],
  },
  'sixty-five-north': {
    how: 'Four places in Iceland, each at its own scale, drawn in City Grain into four corners of one card: no names anywhere, each corner tabbed by its coordinates, the island\'s knocked out across all four.',
    uses: ['view', 'areas.text', 'compose.mask'],
  },
}

/** The gallery: every preset the page ships, as drawn, with how it is made. */
export default function Gallery({ onOpen }) {
  return (
    <>
      <H id="gallery">Gallery</H>
      <P>
        Every style the page ships, drawn by the same engine at its own place. Each one is a profile: open it on
        the map, read its script in the editor, change a number and draw it again. Under each picture is what
        to look for in its script; the four marked <C>lite</C> have a short version further down, written to be
        read.
      </P>
      <div className="my-[1lh] grid gap-[2ch] sm:grid-cols-2 xl:grid-cols-3">
        {PRESETS.map((p) => (
          <Card key={p.id} preset={p} made={MADE[p.id]} onOpen={onOpen} />
        ))}
      </div>
    </>
  )
}

function Card({ preset, made, onOpen }) {
  const src = `/docs/gallery/${preset.id}.webp`
  return (
    <article className="thin flex flex-col border border-black/30">
      <a href={src} target="_blank" rel="noreferrer" className="block aspect-[3/2] bg-white" title="The whole drawing">
        <img src={src} alt={`${preset.name}, as drawn`} loading="lazy" className="h-full w-full object-cover" />
      </a>
      <div className="flex flex-1 flex-col gap-[0.5lh] border-t border-black/30 px-[1ch] py-[0.5lh]">
        <div className="flex items-baseline gap-[1ch]">
          <span className="font-bold">{preset.name}</span>
          {made?.lite ? (
            <a href={`#${made.lite}`} className="opacity-60 hover:underline">
              lite ↓
            </a>
          ) : null}
        </div>
        <p className="leading-relaxed opacity-80">{made?.how ?? preset.hint}</p>
        {made?.uses ? (
          <p className="flex flex-wrap gap-[1ch] opacity-70">
            {made.uses.map((u) => (
              <C key={u}>{u}</C>
            ))}
          </p>
        ) : null}
        {onOpen ? (
          <div className="mt-auto pt-[0.25lh]">
            <button type="button" size-="small" variant-="background1" onClick={() => onOpen(preset.doc)}>
              open on the map
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}
