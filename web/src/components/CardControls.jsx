import { lengthText } from '../lib/frame'
import {
  angleModel,
  countModel,
  degreesModel,
  Field,
  groundModel,
  groundText,
  lengthModel,
  Lock,
  Scrub,
  scaleModel,
  Section,
  SNAP_DEG,
  textModel,
} from './controls'

/** Degrees the map turns per pixel a label is dragged. */
const PX_PER_DEG = 2.5

const PROJECTIONS = ['webmercator', 'utm']
const CUSTOM_PROJ = '+proj=laea +lat_0={lat} +lon_0={lng}'

/** The `slices:` key for a cut; the default (one sheet, no gutter) leaves it out. */
function slicesKey({ columns, rows, gutter }) {
  const cut = columns > 1 || rows > 1 || gutter.mm > 0
  return cut ? `{ columns: ${columns}, rows: ${rows}, padding: ${lengthText(gutter.mm, gutter.unit)} }` : null
}

/**
 * The `card:` block as controls, in sections: place, paper, terrain,
 * orientation, slices. Every label drags its value sideways and every field
 * takes it typed. A change goes out as `onEdit(patch)`, keys of `card:` as
 * YAML text (`null` removes one), so the panel works wherever the document
 * does: the map's transform menu now, a sidebar later.
 *
 * Paper × scale = ground. The document holds the scale or the ground width,
 * whichever is locked; the other follows from the paper and is shown muted.
 * Typing into the muted one takes the lock.
 *
 * `onMove`, when given, is the pointer-down of a drag that moves the card on
 * the map; the place's label uses it.
 */
export default function CardControls({ card, units, onEdit, onMove }) {
  const u = { width: 'mm', height: 'mm', padding: 'mm', gutter: 'mm', ground: 'km', ...units }
  const width = { mm: card.width_mm, unit: u.width }
  const height = { mm: card.height_mm, unit: u.height }
  const padding = { mm: card.padding_mm ?? 0, unit: u.padding }
  const gutter = { mm: card.slice_padding_mm ?? 0, unit: u.gutter }
  const columns = card.columns ?? 1
  const rows = card.rows ?? 1
  const groundW = { m: (card.width_mm / 1000) * card.scale, unit: u.ground }
  const groundH = { m: (card.height_mm / 1000) * card.scale, unit: u.ground }
  const groundLocked = Boolean(card.ground_locked)
  const projection = card.projection ?? 'webmercator'
  const custom = !PROJECTIONS.includes(projection)

  const lat = degreesModel(85)
  const lng = degreesModel(180)
  const paper = lengthModel(u.width, { min: 1 })
  const paperH = lengthModel(u.height, { min: 1 })
  const margin = lengthModel(u.padding)
  const gap = lengthModel(u.gutter)
  const ground = groundModel(u.ground)

  const setScale = (v) => onEdit({ scale: `"1:${Math.round(v)}"`, ground: null })
  const setGround = (g) => onEdit({ ground: groundText(g.m, g.unit), scale: null })
  const setSlices = (patch) => onEdit({ slices: slicesKey({ columns, rows, gutter, ...patch }) })

  return (
    <div className="grid w-max grid-cols-[auto_11ch_11ch] items-center gap-x-1.5 gap-y-1 font-mono text-[10px]">
      <Section title="place" first />
      <Scrub icon="✥" label="move" title="Drag to move the card across the map" onPointerDown={onMove} />
      <Field label="latitude" title="Latitude of the card's centre" model={lat} value={card.lat} onChange={(v) => onEdit({ lat: v })} />
      <Field label="longitude" title="Longitude of the card's centre" model={lng} value={card.lng} onChange={(v) => onEdit({ lng: v })} />

      <Section title="paper" />
      <Scrub icon="↔" label="width" title="Drag or type the paper's width: mm, cm or in" model={paper} value={width} onChange={(v) => onEdit({ width: lengthText(v.mm, v.unit) })} />
      <Field label="paper width" model={paper} value={width} onChange={(v) => onEdit({ width: lengthText(v.mm, v.unit) })} />
      <span />
      <Scrub icon="↕" label="height" title="Drag or type the paper's height: mm, cm or in" model={paperH} value={height} onChange={(v) => onEdit({ height: lengthText(v.mm, v.unit) })} />
      <Field label="paper height" model={paperH} value={height} onChange={(v) => onEdit({ height: lengthText(v.mm, v.unit) })} />
      <span />
      <Scrub icon="▢" label="padding" title="Blank margin inside the paper's edge" model={margin} value={padding} onChange={(v) => onEdit({ padding: v.mm > 0 ? lengthText(v.mm, v.unit) : null })} />
      <Field label="padding" model={margin} value={padding} onChange={(v) => onEdit({ padding: v.mm > 0 ? lengthText(v.mm, v.unit) : null })} />
      <span />

      <Section title="terrain" />
      <Scrub icon="⤡" label="scale" title="Drag or type the scale; the paper keeps its size" model={scaleModel} value={card.scale} onChange={setScale}>
        <Lock
          locked={!groundLocked}
          title={groundLocked ? 'Hold the scale instead: a new paper size shows more or less ground' : 'The scale is held: a new paper size shows more or less ground'}
          onToggle={() => groundLocked && setScale(card.scale)}
        />
      </Scrub>
      <Field label="scale" model={scaleModel} value={card.scale} muted={groundLocked} onChange={setScale} />
      <span />
      <Scrub icon="⟷" label="ground" title="Drag or type the ground across the card: m, km, mi or ft" model={ground} value={groundW} onChange={setGround}>
        <Lock
          locked={groundLocked}
          title={groundLocked ? 'The ground is held: a new paper size changes the scale' : 'Hold the ground instead: a new paper size changes the scale'}
          onToggle={() => !groundLocked && setGround(groundW)}
        />
      </Scrub>
      <Field label="ground width" model={ground} value={groundW} muted={!groundLocked} onChange={setGround} />
      <Field
        label="ground height"
        title="The ground down the card; it follows the paper's shape"
        model={ground}
        value={groundH}
        muted
        onChange={(g) => setGround({ m: (g.m * card.width_mm) / card.height_mm, unit: g.unit })}
      />

      <Section title="orientation" />
      <Scrub
        icon="↻"
        label="rotate"
        title={`Drag left or right to turn the map under the card; hold Shift for ${SNAP_DEG}° steps`}
        model={angleModel}
        value={card.bearing ?? 0}
        sign={-1}
        px={PX_PER_DEG}
        onChange={(b) => onEdit({ bearing: b })}
      />
      <Field label="bearing" title={`Degrees clockwise; arrows step 1°, Shift ${SNAP_DEG}°`} model={angleModel} value={card.bearing ?? 0} onChange={(b) => onEdit({ bearing: b })} />
      <span />
      <Scrub label="projection" title="How the ground lands on the paper" />
      <select
        aria-label="projection"
        value={custom ? 'custom' : projection}
        className="col-span-2 h-auto border border-black bg-white px-0.5 font-mono text-[10px] leading-[1.6]"
        onChange={(e) => onEdit({ projection: e.target.value === 'custom' ? `"${CUSTOM_PROJ}"` : e.target.value })}
      >
        <option value="webmercator">webmercator · like the web map</option>
        <option value="utm">utm · true distances</option>
        <option value="custom">PROJ string…</option>
      </select>
      {custom && (
        <>
          <span />
          <Field
            label="PROJ string"
            title="Any projection proj4rs knows; {lat} and {lng} stand for the card's centre"
            model={textModel((s) => s.trim().startsWith('+proj='))}
            value={projection}
            className="col-span-2 text-left"
            onChange={(s) => onEdit({ projection: `"${s.trim()}"` })}
          />
        </>
      )}

      <Section title="slices" />
      <Scrub icon="⫼" label="columns" title="Sheets across" model={countModel} value={columns} px={12} onChange={(v) => setSlices({ columns: v })} />
      <Field label="columns" model={countModel} value={columns} onChange={(v) => setSlices({ columns: v })} />
      <span />
      <Scrub icon="☰" label="rows" title="Sheets down" model={countModel} value={rows} px={12} onChange={(v) => setSlices({ rows: v })} />
      <Field label="rows" model={countModel} value={rows} onChange={(v) => setSlices({ rows: v })} />
      <span />
      <Scrub icon="▦" label="gutter" title="Blank margin inside every sheet" model={gap} value={gutter} onChange={(v) => setSlices({ gutter: v })} />
      <Field label="gutter" model={gap} value={gutter} onChange={(v) => setSlices({ gutter: v })} />
      <span />
    </div>
  )
}
