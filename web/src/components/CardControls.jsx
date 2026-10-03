import { lengthText } from '../lib/frame'
import { angleModel, countModel, degreesModel, Field, groundModel, groundText, lengthModel, Lock, Scrub, scaleModel, Section, SNAP_DEG } from './controls'

/** Degrees the map turns per pixel a label is dragged. */
const PX_PER_DEG = 2.5

/** The `slices:` key for a cut; the default (one sheet, no gutter) leaves it out. */
function slicesKey({ columns, rows, gutter }) {
  const cut = columns > 1 || rows > 1 || gutter.mm > 0
  return cut ? `{ columns: ${columns}, rows: ${rows}, padding: ${lengthText(gutter.mm, gutter.unit)} }` : null
}

/**
 * The `card:` block as controls, in two sections: where the card is on the
 * map (move, rotate, scale), and the paper (size, slices, margins). Every
 * label drags its value sideways and every field takes it typed. A change
 * goes out as `onEdit(patch)`, keys of `card:` as YAML text (`null` removes
 * one), so the panel works wherever the document does: the map's transform
 * menu now, a sidebar later.
 *
 * Paper × scale = ground. The document holds the scale or the ground width,
 * whichever is locked; the other follows from the paper and is shown muted.
 * Typing into the muted one takes the lock.
 *
 * `onMove`, when given, is the pointer-down of a drag that moves the card on
 * the map; the move label uses it.
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
  const groundLocked = Boolean(card.ground_locked)

  const lat = degreesModel(85)
  const lng = degreesModel(180)
  const paperW = lengthModel(u.width, { min: 1 })
  const paperH = lengthModel(u.height, { min: 1 })
  const margin = lengthModel(u.padding)
  const gap = lengthModel(u.gutter)
  const ground = groundModel(u.ground)

  const setWidth = (v) => onEdit({ width: lengthText(v.mm, v.unit) })
  const setHeight = (v) => onEdit({ height: lengthText(v.mm, v.unit) })
  const setPadding = (v) => onEdit({ padding: v.mm > 0 ? lengthText(v.mm, v.unit) : null })
  const setScale = (v) => onEdit({ scale: `"1:${Math.round(v)}"`, ground: null })
  const setGround = (g) => onEdit({ ground: groundText(g.m, g.unit), scale: null })
  const setSlices = (patch) => onEdit({ slices: slicesKey({ columns, rows, gutter, ...patch }) })
  const setBearing = (b) => onEdit({ bearing: b })

  return (
    <div className="w-max font-mono text-[10px]">
      <Section title="place" cols="grid-cols-[auto_13ch_13ch]" first>
        <Scrub icon="✥" label="move" title="Drag to move the card across the map" onPointerDown={onMove} />
        <Field label="latitude" title="Latitude of the card's centre" model={lat} value={card.lat} onChange={(v) => onEdit({ lat: v })} />
        <Field label="longitude" title="Longitude of the card's centre" model={lng} value={card.lng} onChange={(v) => onEdit({ lng: v })} />

        <Scrub
          icon="↻"
          label="rotate"
          title={`Drag left or right to turn the map under the card; hold Shift for ${SNAP_DEG}° steps`}
          model={angleModel}
          value={card.bearing ?? 0}
          sign={-1}
          px={PX_PER_DEG}
          onChange={setBearing}
        />
        <Field label="bearing" title={`Degrees clockwise; arrows step 1°, Shift ${SNAP_DEG}°`} model={angleModel} value={card.bearing ?? 0} onChange={setBearing} />
        <span />

        <Scrub icon="⤡" label="scale" title="Drag to change the scale; the paper keeps its size" model={scaleModel} value={card.scale} onChange={setScale} />
        <span className="flex items-center gap-0.5">
          <Lock
            locked={!groundLocked}
            title={groundLocked ? 'Hold the scale instead: a new paper size shows more or less ground' : 'The scale is held: a new paper size shows more or less ground'}
            onToggle={() => groundLocked && setScale(card.scale)}
          />
          <Field label="scale" title="The scale, 1:N" model={scaleModel} value={card.scale} muted={groundLocked} onChange={setScale} />
        </span>
        <span className="flex items-center gap-0.5">
          <Lock
            locked={groundLocked}
            title={groundLocked ? 'The ground is held: a new paper size changes the scale' : 'Hold the ground instead: a new paper size changes the scale'}
            onToggle={() => !groundLocked && setGround(groundW)}
          />
          <Field label="ground" title="The ground across the card: m, km, mi or ft" model={ground} value={groundW} muted={!groundLocked} onChange={setGround} />
        </span>
      </Section>

      <Section title="paper" cols="grid-cols-[auto_8ch_auto_8ch]">
        <Scrub label="width" title="Drag or type the paper's width: mm, cm or in" model={paperW} value={width} onChange={setWidth} />
        <Field label="paper width" model={paperW} value={width} onChange={setWidth} />
        <Scrub label="height" title="Drag or type the paper's height: mm, cm or in" model={paperH} value={height} onChange={setHeight} />
        <Field label="paper height" model={paperH} value={height} onChange={setHeight} />

        <Scrub label="columns" title="Sheets across" model={countModel} value={columns} px={12} onChange={(v) => setSlices({ columns: v })} />
        <Field label="columns" model={countModel} value={columns} onChange={(v) => setSlices({ columns: v })} />
        <Scrub label="rows" title="Sheets down" model={countModel} value={rows} px={12} onChange={(v) => setSlices({ rows: v })} />
        <Field label="rows" model={countModel} value={rows} onChange={(v) => setSlices({ rows: v })} />

        <Scrub label="padding" title="Blank margin inside the paper's edge" model={margin} value={padding} onChange={setPadding} />
        <Field label="padding" model={margin} value={padding} onChange={setPadding} />
        <Scrub label="gutter" title="Blank margin inside every sheet" model={gap} value={gutter} onChange={(v) => setSlices({ gutter: v })} />
        <Field label="gutter" model={gap} value={gutter} onChange={(v) => setSlices({ gutter: v })} />
      </Section>
    </div>
  )
}
