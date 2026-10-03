import { useState } from 'react'
import { lengthText } from '../lib/frame'
import { angleModel, Choice, countModel, degreesModel, Field, lengthModel, MAX_SCALE, MIN_SCALE, Scrub, scaleModel, Section, SNAP_DEG, terrainModel } from './controls'

/** Degrees the map turns per pixel a label is dragged. */
const PX_PER_DEG = 2.5

/** Where the scale switch is remembered: what a new scale changes, `terrain` or `output`. */
const SCALE_CHANGES_KEY = 'drawland.scaleChanges'

/** The smallest side a new scale may leave the paper, in mm. */
const MIN_PAPER_MM = 1

/** Both sections share one shape so their fields line up: a label, two values. */
const COLS = 'grid-cols-[10ch_15ch_15ch]'

/** `5mm` for one length both ways, `[5mm, 3mm]` (across, down) for two. */
function xyText({ x, y }) {
  const [a, b] = [lengthText(x.mm, x.unit), lengthText(y.mm, y.unit)]
  return a === b ? a : `[${a}, ${b}]`
}

const some = ({ x, y }) => x.mm > 0 || y.mm > 0

/** The `slices:` key for a cut; the default (one sheet, no gutter) leaves it out. */
function slicesKey({ columns, rows, gutter }) {
  if (columns === 1 && rows === 1 && !some(gutter)) return null
  return some(gutter) ? `{ columns: ${columns}, rows: ${rows}, gutter: ${xyText(gutter)} }` : `{ columns: ${columns}, rows: ${rows} }`
}

/**
 * The `card:` block as controls, in two sections: where the card is on the
 * map (move, rotate, scale, the terrain it covers) and the output (the
 * paper's size, slices, margins and gutter). Every label drags its row's
 * values sideways, together; every field's ↔ drags it alone, and every field
 * takes it typed. A change goes out as
 * `onEdit(patch)`, keys of `card:` as YAML text (`null` removes one), so the
 * panel works wherever the document does: the map's transform menu now, a
 * sidebar later.
 *
 * Output × scale = terrain. A new terrain is a new scale on the same paper,
 * and a new output size takes in more or less terrain at the same scale. A
 * new scale changes the terrain, or, with the switch beside it on output,
 * the paper around the same terrain.
 *
 * `onMove`, when given, is the pointer-down of a drag that moves the card on
 * the map; the move label uses it.
 */
export default function CardControls({ card, units, onEdit, onMove }) {
  const u = { width: 'mm', height: 'mm', padding: 'mm', gutter: 'mm', terrain: 'km', ...units }
  const width = { mm: card.width_mm, unit: u.width }
  const height = { mm: card.height_mm, unit: u.height }
  const padding = { x: { mm: card.padding_x_mm ?? 0, unit: u.padding }, y: { mm: card.padding_y_mm ?? 0, unit: u.padding } }
  const gutter = { x: { mm: card.gutter_x_mm ?? 0, unit: u.gutter }, y: { mm: card.gutter_y_mm ?? 0, unit: u.gutter } }
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

  const setWidth = (v) => onEdit({ width: lengthText(v.mm, v.unit) })
  const setHeight = (v) => onEdit({ height: lengthText(v.mm, v.unit) })
  const setPadding = (patch) => {
    const p = { ...padding, ...patch }
    onEdit({ padding: some(p) ? xyText(p) : null })
  }
  const setGutter = (patch) => setSlices({ gutter: { ...gutter, ...patch } })
  const [scaleChanges, setScaleChanges] = useState(() => (localStorage.getItem(SCALE_CHANGES_KEY) === 'output' ? 'output' : 'terrain'))
  const chooseScaleChanges = (v) => {
    setScaleChanges(v)
    localStorage.setItem(SCALE_CHANGES_KEY, v)
  }
  const scaleText = (v) => `"1:${Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)))}"`
  const setScale = (v) => onEdit({ scale: scaleText(v) })
  // The scale row: the same paper over new terrain, or new paper around the same terrain.
  const newScale = (v) => {
    if (scaleChanges === 'terrain') return setScale(v)
    const s = Math.min(v, (Math.min(terrainW.m, terrainH.m) * 1000) / MIN_PAPER_MM)
    onEdit({
      scale: scaleText(s),
      width: lengthText((terrainW.m * 1000) / s, u.width),
      height: lengthText((terrainH.m * 1000) / s, u.height),
    })
  }
  const setBearing = (b) => onEdit({ bearing: b })
  const setSlices = (patch) => onEdit({ slices: slicesKey({ columns, rows, gutter, ...patch }) })
  // Dragging a row's label moves both its values: sizes keep their shape.
  const growTerrain = (t) => setScale((card.scale * t.m) / terrainW.m)
  const growPaper = (v) => {
    const k = v.mm / width.mm
    onEdit({ width: lengthText(v.mm, u.width), height: lengthText(height.mm * k, u.height) })
  }
  const sheets = {
    nudge: (v, n, shift) => ({ columns: countModel.nudge(v.columns, n, shift), rows: countModel.nudge(v.rows, n, shift) }),
  }
  const both = (model) => ({ nudge: (v, n, shift) => ({ x: model.nudge(v.x, n, shift), y: model.nudge(v.y, n, shift) }) })

  return (
    <div className="w-max font-mono text-[11px]">
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
        <Field label="bearing" title={`Degrees clockwise; arrows step 1°, Shift ${SNAP_DEG}°`} model={angleModel} value={card.bearing ?? 0} px={PX_PER_DEG} onChange={setBearing} />
        <span />

        <Scrub
          icon="⤡"
          label="scale"
          title={
            scaleChanges === 'terrain'
              ? 'Drag to change the scale: more or less terrain on the same paper'
              : 'Drag to change the scale: bigger or smaller paper around the same terrain'
          }
          model={scaleModel}
          value={card.scale}
          onChange={newScale}
        />
        <Field
          label="scale"
          title={scaleChanges === 'terrain' ? 'The scale, 1:N; the paper keeps its size' : 'The scale, 1:N; the terrain stays, the paper follows'}
          model={scaleModel}
          value={card.scale}
          onChange={newScale}
        />
        <Choice
          label="a new scale changes"
          title="What a new scale changes: the terrain on the same paper, or the output around the same terrain"
          options={[
            ['terrain', 'terrain'],
            ['output', 'output'],
          ]}
          value={scaleChanges}
          onChange={chooseScaleChanges}
        />

        <Scrub icon="▭" label="terrain" title="Drag to take in more or less terrain on the same paper: the scale follows" model={terrain} value={terrainW} onChange={growTerrain} />
        <Field
          label="terrain width"
          title="The terrain across the card: m, km, mi or ft; the scale follows, the paper keeps its size"
          model={terrain}
          value={terrainW}
          onChange={(t) => setScale((t.m * 1000) / card.width_mm)}
        />
        <Field
          label="terrain height"
          title="The terrain down the card: m, km, mi or ft; the scale follows, the paper keeps its size"
          model={terrain}
          value={terrainH}
          onChange={(t) => setScale((t.m * 1000) / card.height_mm)}
        />
      </Section>

      <Section title="output" cols={COLS}>
        <Scrub icon="□" label="size" title="Drag to grow or shrink the paper at the same scale: the terrain follows" model={paperW} value={width} onChange={growPaper} />
        <Field label="width" title="The paper's width: mm, cm or in; the terrain follows" model={paperW} value={width} onChange={setWidth} />
        <Field label="height" title="The paper's height: mm, cm or in; the terrain follows" model={paperH} value={height} onChange={setHeight} />

        <Scrub icon="⊞" label="slices" title="Drag to cut the paper into more or fewer sheets" model={sheets} value={{ columns, rows }} px={12} onChange={setSlices} />
        <Field label="columns" title="Sheets across" model={countModel} value={columns} px={12} onChange={(v) => setSlices({ columns: v })} />
        <Field label="rows" title="Sheets down" model={countModel} value={rows} px={12} onChange={(v) => setSlices({ rows: v })} />

        <Scrub icon="▣" label="margin" title="Drag to widen or narrow the blank margin inside the paper's edge" model={both(margin)} value={padding} onChange={setPadding} />
        <Field label="margin across" title="Blank margin at the paper's left and right edges: mm, cm or in" model={margin} value={padding.x} onChange={(x) => setPadding({ x })} />
        <Field label="margin down" title="Blank margin at the paper's top and bottom edges: mm, cm or in" model={margin} value={padding.y} onChange={(y) => setPadding({ y })} />

        <Scrub icon="‖" label="gutter" title="Drag to widen or narrow the blank space between the sheets" model={both(gap)} value={gutter} onChange={(v) => setSlices({ gutter: v })} />
        <Field label="gutter across" title="Blank space between side-by-side sheets, half on each side of the cut: mm, cm or in" model={gap} value={gutter.x} onChange={(x) => setGutter({ x })} />
        <Field label="gutter down" title="Blank space between stacked sheets, half on each side of the cut: mm, cm or in" model={gap} value={gutter.y} onChange={(y) => setGutter({ y })} />
      </Section>
    </div>
  )
}
