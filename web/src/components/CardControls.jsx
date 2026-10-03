import { lengthText } from '../lib/frame'
import { angleModel, countModel, degreesModel, Field, lengthModel, Scrub, scaleModel, Section, SNAP_DEG, terrainModel } from './controls'

/** Degrees the map turns per pixel a label is dragged. */
const PX_PER_DEG = 2.5

/** Both sections share one shape so their fields line up: a label, two values. */
const COLS = 'grid-cols-[10ch_13ch_13ch]'

/** The `slices:` key for a cut; the default (one sheet, no gutter) leaves it out. */
function slicesKey({ columns, rows, gutter }) {
  const cut = columns > 1 || rows > 1 || gutter.mm > 0
  return cut ? `{ columns: ${columns}, rows: ${rows}, padding: ${lengthText(gutter.mm, gutter.unit)} }` : null
}

/**
 * The `card:` block as controls, in two sections: where the card is on the
 * map (move, rotate, scale, the terrain it covers) and the output (the
 * paper's size, slices and margins). Every label drags its value sideways
 * and every field takes it typed. A change goes out as `onEdit(patch)`, keys
 * of `card:` as YAML text (`null` removes one), so the panel works wherever
 * the document does: the map's transform menu now, a sidebar later.
 *
 * Output × scale = terrain, and the scale is what holds them together: a
 * new scale changes the terrain and keeps the output, a new terrain or a new
 * output changes the other at the same scale.
 *
 * `onMove`, when given, is the pointer-down of a drag that moves the card on
 * the map; the move label uses it.
 */
export default function CardControls({ card, units, onEdit, onMove }) {
  const u = { width: 'mm', height: 'mm', padding: 'mm', gutter: 'mm', terrain: 'km', ...units }
  const width = { mm: card.width_mm, unit: u.width }
  const height = { mm: card.height_mm, unit: u.height }
  const padding = { mm: card.padding_mm ?? 0, unit: u.padding }
  const gutter = { mm: card.slice_padding_mm ?? 0, unit: u.gutter }
  const columns = card.columns ?? 1
  const rows = card.rows ?? 1
  const terrainW = { m: (card.width_mm / 1000) * card.scale, unit: u.terrain }
  const terrainH = { m: (card.height_mm / 1000) * card.scale, unit: u.terrain }

  const lat = degreesModel(85)
  const lng = degreesModel(180)
  const paperW = lengthModel(u.width, { min: 1 })
  const paperH = lengthModel(u.height, { min: 1 })
  const margin = lengthModel(u.padding)
  const gap = lengthModel(u.gutter)
  const terrain = terrainModel(u.terrain)

  /** The paper for `m` metres of terrain at the card's scale. */
  const paperFor = (m, unit) => lengthText((m * 1000) / card.scale, unit)
  const setWidth = (v) => onEdit({ width: lengthText(v.mm, v.unit) })
  const setHeight = (v) => onEdit({ height: lengthText(v.mm, v.unit) })
  const setPadding = (v) => onEdit({ padding: v.mm > 0 ? lengthText(v.mm, v.unit) : null })
  const setScale = (v) => onEdit({ scale: `"1:${Math.round(v)}"` })
  const setBearing = (b) => onEdit({ bearing: b })
  const setSlices = (patch) => onEdit({ slices: slicesKey({ columns, rows, gutter, ...patch }) })
  // Dragging a row's label moves both its values: sizes keep their shape.
  const growTerrain = (t) => {
    const k = t.m / terrainW.m
    onEdit({ width: paperFor(terrainW.m * k, u.width), height: paperFor(terrainH.m * k, u.height) })
  }
  const growPaper = (v) => {
    const k = v.mm / width.mm
    onEdit({ width: lengthText(v.mm, u.width), height: lengthText(height.mm * k, u.height) })
  }
  const sheets = {
    nudge: (v, n, shift) => ({ columns: countModel.nudge(v.columns, n, shift), rows: countModel.nudge(v.rows, n, shift) }),
  }
  const margins = {
    nudge: (v, n, shift) => ({ padding: margin.nudge(v.padding, n, shift), gutter: gap.nudge(v.gutter, n, shift) }),
  }
  const setMargins = (v) =>
    onEdit({
      padding: v.padding.mm > 0 ? lengthText(v.padding.mm, v.padding.unit) : null,
      slices: slicesKey({ columns, rows, gutter: v.gutter }),
    })

  return (
    <div className="w-max font-mono text-[10px]">
      <Section title="place" cols={COLS} first>
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

        <Scrub icon="⤡" label="scale" title="Drag to change the scale: more or less terrain on the same paper" model={scaleModel} value={card.scale} onChange={setScale} />
        <Field label="scale" title="The scale, 1:N; the paper keeps its size" model={scaleModel} value={card.scale} onChange={setScale} />
        <span />

        <Scrub icon="▭" label="terrain" title="Drag to take in more or less terrain at the same scale: the paper follows" model={terrain} value={terrainW} onChange={growTerrain} />
        <Field
          label="terrain width"
          title="The terrain across the card: m, km, mi or ft; the paper's width follows"
          model={terrain}
          value={terrainW}
          onChange={(t) => onEdit({ width: paperFor(t.m, u.width) })}
        />
        <Field
          label="terrain height"
          title="The terrain down the card: m, km, mi or ft; the paper's height follows"
          model={terrain}
          value={terrainH}
          onChange={(t) => onEdit({ height: paperFor(t.m, u.height) })}
        />
      </Section>

      <Section title="output" cols={COLS}>
        <Scrub icon="□" label="size" title="Drag to grow or shrink the paper at the same scale: the terrain follows" model={paperW} value={width} onChange={growPaper} />
        <Field label="width" title="The paper's width: mm, cm or in; the terrain follows" model={paperW} value={width} onChange={setWidth} />
        <Field label="height" title="The paper's height: mm, cm or in; the terrain follows" model={paperH} value={height} onChange={setHeight} />

        <Scrub icon="⊞" label="slices" title="Drag to cut the paper into more or fewer sheets" model={sheets} value={{ columns, rows }} px={12} onChange={setSlices} />
        <Field label="columns" title="Sheets across" model={countModel} value={columns} onChange={(v) => setSlices({ columns: v })} />
        <Field label="rows" title="Sheets down" model={countModel} value={rows} onChange={(v) => setSlices({ rows: v })} />

        <Scrub icon="▣" label="margins" title="Drag to widen or narrow both margins" model={margins} value={{ padding, gutter }} onChange={setMargins} />
        <Field label="padding" title="Blank margin inside the paper's edge" model={margin} value={padding} onChange={setPadding} />
        <Field label="gutter" title="Blank margin inside every sheet" model={gap} value={gutter} onChange={(v) => setSlices({ gutter: v })} />
      </Section>
    </div>
  )
}
