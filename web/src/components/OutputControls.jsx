import { useRef, useState } from 'react'
import { lengthText } from '../lib/frame'
import { angleModel, Choice, countModel, degreesModel, Field, lengthModel, MAX_SCALE, MIN_SCALE, Scrub, scaleModel, Section, SNAP_DEG, terrainModel, tileZoomModel } from './controls'

/** Degrees the map turns per pixel a label is dragged. */
const PX_PER_DEG = 2.5

/** Where the scale switch is remembered: what a new scale changes, `terrain` or `paper`. */
const SCALE_CHANGES_KEY = 'drawland.scaleChanges'

/** The smallest side a new scale may leave the paper, in mm. */
const MIN_PAPER_MM = 1

/** Both sections share one shape so their fields line up: a label, two values. */
const COLS = 'grid-cols-[10ch_15ch_15ch]'

/** `5mm` for one length both ways, `[5mm, 3mm]` (across, down) for two. */
function xyText({ x, y }) {
  const [a, b] = [lengthText(x.mm, x.unit), lengthText(y.mm, y.unit)]
  return a === b ? a : [a, b]
}

const some = ({ x, y }) => x.mm > 0 || y.mm > 0

/** The `slices` key for a cut; the default (one sheet, no gutter) leaves it out. */
function slicesKey({ columns, rows, gutter }) {
  if (columns === 1 && rows === 1 && !some(gutter)) return null
  return some(gutter) ? { columns, rows, gutter: xyText(gutter) } : { columns, rows }
}

/**
 * The output as controls, in two sections: where it is on the
 * map (move, rotate, scale, the terrain it covers) and the paper (the
 * paper's size, slices, margins and gutter). Every label drags its row's
 * values sideways, together; every field's ↔ drags it alone, and every field
 * takes it typed. A change goes out as
 * `onEdit(patch)`, keys of the output as plain values (`null` removes one), so the
 * panel works wherever the document does: the map's transform menu now, a
 * sidebar later.
 *
 * Paper × scale = terrain. A new terrain is a new scale on the same paper,
 * and a new paper size takes in more or less terrain at the same scale. A
 * new scale changes the terrain, or, with the switch beside it on paper,
 * the paper around the same terrain.
 *
 * `onMove`, when given, is the pointer-down of a drag that moves the output on
 * the map; the move label uses it.
 */
export default function OutputControls({ output, units, onEdit, onMove }) {
  const u = { width: 'mm', height: 'mm', padding: 'mm', gutter: 'mm', terrain: 'km', ...units }
  const width = { mm: output.width_mm, unit: u.width }
  const height = { mm: output.height_mm, unit: u.height }
  const padding = { x: { mm: output.padding_x_mm ?? 0, unit: u.padding }, y: { mm: output.padding_y_mm ?? 0, unit: u.padding } }
  const gutter = { x: { mm: output.gutter_x_mm ?? 0, unit: u.gutter }, y: { mm: output.gutter_y_mm ?? 0, unit: u.gutter } }
  const columns = output.columns ?? 1
  const rows = output.rows ?? 1
  const terrainW = { m: (output.width_mm / 1000) * output.scale, unit: u.terrain }
  const terrainH = { m: (output.height_mm / 1000) * output.scale, unit: u.terrain }

  const lat = degreesModel(85)
  const lng = degreesModel(180)
  const paperW = lengthModel(u.width, { min: 1 })
  const paperH = lengthModel(u.height, { min: 1 })
  const margin = lengthModel(u.padding)
  const gap = lengthModel(u.gutter)
  const terrain = terrainModel(u.terrain)
  const tileZoom = tileZoomModel

  const setWidth = (v) => onEdit({ width: lengthText(v.mm, v.unit) })
  const setHeight = (v) => onEdit({ height: lengthText(v.mm, v.unit) })
  const setPadding = (patch) => {
    const p = { ...padding, ...patch }
    onEdit({ padding: some(p) ? xyText(p) : null })
  }
  const setGutter = (patch) => setSlices({ gutter: { ...gutter, ...patch } })
  const [scaleChanges, setScaleChanges] = useState(() => (localStorage.getItem(SCALE_CHANGES_KEY) === 'paper' ? 'paper' : 'terrain'))
  const chooseScaleChanges = (v) => {
    setScaleChanges(v)
    localStorage.setItem(SCALE_CHANGES_KEY, v)
  }
  const scaleText = (v) => `1:${Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)))}`
  const setScale = (v) => onEdit({ scale: scaleText(v) })
  // The terrain a paper-mode scale keeps, held across a drag: read back from
  // the paper each step, it would carry that step's rounding into the next, and
  // the paper would wobble. A terrain changed some other way is taken afresh.
  const keptGroundRef = useRef(null)
  const keptGround = () => {
    const g = keptGroundRef.current
    const near = (a, b) => Math.abs(a / b - 1) < 0.05
    if (g && near(g.w, terrainW.m) && near(g.h, terrainH.m)) return g
    return (keptGroundRef.current = { w: terrainW.m, h: terrainH.m })
  }
  // The scale row: the same paper over new terrain, or new paper around the same terrain.
  const newScale = (v) => {
    if (scaleChanges === 'terrain') return setScale(v)
    const g = keptGround()
    const s = Math.min(v, (Math.min(g.w, g.h) * 1000) / MIN_PAPER_MM)
    onEdit({
      scale: scaleText(s),
      width: lengthText((g.w * 1000) / s, u.width),
      height: lengthText((g.h * 1000) / s, u.height),
    })
  }
  const setBearing = (b) => onEdit({ bearing: b })
  // The tile zoom the output reads at, or automatic (`null` removes the key).
  const setTileZoom = (v) => onEdit({ tileZoom: v.z })
  const setSlices = (patch) => onEdit({ slices: slicesKey({ columns, rows, gutter, ...patch }) })
  // Dragging a row's label moves both its values: sizes keep their shape.
  // The terrain width or height on its own: at the same scale, that side of the
  // paper grows to cover that much ground, and the other side stays put. The
  // unit it was typed in becomes the terrain's.
  const growTerrainWidth = (t) => onEdit({ width: lengthText((t.m * 1000) / output.scale, u.width) }, t.unit)
  const growTerrainHeight = (t) => onEdit({ height: lengthText((t.m * 1000) / output.scale, u.height) }, t.unit)
  const growTerrain = (t) => setScale((output.scale * t.m) / terrainW.m)
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
        <Scrub icon="✥" label="move" title="Drag to move the output across the map" onPointerDown={onMove} />
        <Field label="latitude" title="Latitude of the output's centre" model={lat} value={output.lat} onChange={(v) => onEdit({ lat: v })} />
        <Field label="longitude" title="Longitude of the output's centre" model={lng} value={output.lng} onChange={(v) => onEdit({ lng: v })} />

        <Scrub
          icon="↻"
          label="rotate"
          title={`Drag left or right to turn the map under the output; hold Shift for ${SNAP_DEG}° steps`}
          model={angleModel}
          value={output.bearing ?? 0}
          sign={-1}
          px={PX_PER_DEG}
          onChange={setBearing}
        />
        <Field label="bearing" title={`Degrees clockwise; arrows step 1°, Shift ${SNAP_DEG}°`} model={angleModel} value={output.bearing ?? 0} px={PX_PER_DEG} onChange={setBearing} />
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
          value={output.scale}
          onChange={newScale}
        />
        <Field
          label="scale"
          title={scaleChanges === 'terrain' ? 'The scale, 1:N; the paper keeps its size' : 'The scale, 1:N; the terrain stays, the paper follows'}
          model={scaleModel}
          value={output.scale}
          onChange={newScale}
        />
        <Choice
          label="a new scale changes"
          title="What a new scale changes: the terrain on the same paper, or the paper around the same terrain"
          options={[
            ['terrain', 'terrain'],
            ['paper', 'paper'],
          ]}
          value={scaleChanges}
          onChange={chooseScaleChanges}
        />

        <Scrub icon="▭" label="terrain" title="Drag to take in more or less terrain on the same paper: the scale follows" model={terrain} value={terrainW} sign={-1} onChange={growTerrain} />
        <Field
          label="terrain width"
          title="The terrain across the output: m, km, mi or ft; the paper follows, the other side stays put"
          model={terrain}
          value={terrainW}
          onChange={growTerrainWidth}
        />
        <Field
          label="terrain height"
          title="The terrain down the output: m, km, mi or ft; the paper follows, the other side stays put"
          model={terrain}
          value={terrainH}
          onChange={growTerrainHeight}
        />

        <Scrub
          icon="▦"
          label="tile"
          title="Drag to change the vector tiles' zoom: coarser or finer data, more or fewer tiles on the map"
          model={tileZoom}
          value={{ z: output.tileZoom ?? null }}
          sign={-1}
          onChange={setTileZoom}
        />
        <Field
          label="tile zoom"
          title="The vector tiles' zoom (0–14), or 'auto': the grid of the tiles the output reads is drawn on the map"
          model={tileZoom}
          value={{ z: output.tileZoom ?? null }}
          onChange={setTileZoom}
        />

        <Choice
          label="tile zoom"
          title="The vector tiles' zoom: automatic (the deepest that fits), or set to a number"
          options={[
            ['auto', 'auto'],
            ['set', 'set'],
          ]}
          value={output.tileZoom == null ? 'auto' : 'set'}
          onChange={(v) => v === 'auto' && onEdit({ tileZoom: null })}
        />
      </Section>

      <Section title="paper" cols={COLS}>
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
