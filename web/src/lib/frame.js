/**
 * Where the output sits on the map. An output is a rectangle on the ground:
 * `width_mm × height_mm` at a scale `1:N`, so its ground size is
 * `mm × N` metres, centred on a lon/lat and turned by `bearing`.
 *
 * The map is only a window onto it: the rectangle sits centred, and the
 * drawing is stretched to cover exactly that rectangle, the same way the
 * CLI draws it in millimetres.
 */

/** Web Mercator, as the web map uses. */
const EARTH_M = 40075016.686
const R = 6378137
const TILE_PX = 512

/** Space kept around the output on screen, px. */
export const FIT_PAD = 48

/** The output's ground size in km: `[width, height]`. */
export function groundKm(output) {
  if (!output || !(output.scale > 0)) return null
  return [(output.width_mm * output.scale) / 1e6, (output.height_mm * output.scale) / 1e6]
}

/** Height over width. */
export function aspectOf(output) {
  if (!output || !(output.height_mm > 0)) return 1
  return output.height_mm / output.width_mm
}

function toMerc(lon, lat) {
  return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))]
}

function fromMerc(x, y) {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)]
}

/** Degrees box of the output, built in Mercator so its proportions match the map. */
export function outputBounds(output) {
  const g = groundKm(output)
  if (!g) return null
  const [cx, cy] = toMerc(output.lng, output.lat)
  const s = 1 / Math.cos((output.lat * Math.PI) / 180)
  // width_mm is the output's width before bearing; for bearing 0 the axes line up.
  const hw = (g[0] * 1000 * s) / 2
  const hh = (g[1] * 1000 * s) / 2
  const [west, south] = fromMerc(cx - hw, cy - hh)
  const [east, north] = fromMerc(cx + hw, cy + hh)
  return { west, south, east, north }
}

/** Ground width in km that `px` screen pixels span at `zoom` and latitude `lat`. */
export function groundWidthAt(lat, zoom, px) {
  const cos = Math.cos((lat * Math.PI) / 180)
  return (px * EARTH_M * cos) / (TILE_PX * 2 ** zoom) / 1000
}

/** Zoom at which the output's ground width spans `boxPx` screen pixels. */
export function zoomFor(lat, groundWkm, boxPx) {
  const cos = Math.cos((lat * Math.PI) / 180)
  return Math.log2((EARTH_M * cos * boxPx) / (TILE_PX * groundWkm * 1000))
}

/** How much to zoom, in levels, for the output to fill the map; 0 without an output. */
export function zoomToFit(map, output) {
  const g = groundKm(output)
  if (!g) return 0
  const el = map.getContainer()
  const kmPerPx = groundWidthAt(output.lat, map.getZoom(), 1)
  const k = Math.min(
    (el.clientWidth - 2 * FIT_PAD) / (g[0] / kmPerPx),
    (el.clientHeight - 2 * FIT_PAD) / (g[1] / kmPerPx),
  )
  return k > 0 ? Math.log2(k) : 0
}

/** The output rectangle's screen box: `{ x, y, w, h }` in CSS px. */
export function outputBox(map, output) {
  const g = groundKm(output)
  if (!g || !map) return null
  const el = map.getContainer()
  const kmPerPx = groundWidthAt(output.lat, map.getZoom(), 1)
  const w = g[0] / kmPerPx
  const h = g[1] / kmPerPx

  // Where the output's centre lands on screen, so dragging keeps it under the cursor.
  const c = map.project([output.lng, output.lat])
  return { x: c.x - w / 2, y: c.y - h / 2, w, h }
}

/**
 * The output's sheets in output mm, as the engine cuts them (`sheets.rs`): each
 * `{ at, inner }` as `[x0, y0, x1, y1]`, `inner` being the part drawn on.
 */
export function sheetsOf(output) {
  const cols = Math.max(1, output.columns ?? 1)
  const rows = Math.max(1, output.rows ?? 1)
  const [px, py] = [output.padding_x_mm ?? 0, output.padding_y_mm ?? 0]
  const [hx, hy] = [(output.gutter_x_mm ?? 0) / 2, (output.gutter_y_mm ?? 0) / 2]
  const [w, h] = [output.width_mm, output.height_mm]
  const [sw, sh] = [w / cols, h / rows]
  const out = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x0, y0] = [c * sw, r * sh]
      out.push({
        at: [x0, y0, x0 + sw, y0 + sh],
        inner: [
          c === 0 ? px : x0 + hx,
          r === 0 ? py : y0 + hy,
          c === cols - 1 ? w - px : x0 + sw - hx,
          r === rows - 1 ? h - py : y0 + sh - hy,
        ],
      })
    }
  }
  return out
}

/** Whether the output is cut or padded at all. */
export function hasLayout(output) {
  return (output?.columns ?? 1) > 1 || (output?.rows ?? 1) > 1 || (output?.padding_x_mm ?? 0) > 0 || (output?.padding_y_mm ?? 0) > 0
}

/** Standard paper sizes, named in the output's label; landscape, in their own units. */
const PAPERS = [
  { name: 'A6', w: 148, h: 105, unit: 'mm' },
  { name: 'A5', w: 210, h: 148, unit: 'mm' },
  { name: 'A4', w: 297, h: 210, unit: 'mm' },
  { name: 'A3', w: 420, h: 297, unit: 'mm' },
  { name: '6×4 in', w: 6, h: 4, unit: 'in' },
  { name: '7×5 in', w: 7, h: 5, unit: 'in' },
  { name: '10×8 in', w: 10, h: 8, unit: 'in' },
  { name: 'Letter', w: 11, h: 8.5, unit: 'in' },
  { name: '12×9 in', w: 12, h: 9, unit: 'in' },
]
/** Millimetres in each unit an output length may be written in. */
export const MM_PER = { mm: 1, cm: 10, in: 25.4 }

/** Both orientations of every paper, in mm. */
function papers() {
  return PAPERS.flatMap((p) => {
    const k = MM_PER[p.unit]
    const flat = { ...p, w_mm: p.w * k, h_mm: p.h * k }
    return p.w === p.h ? [flat] : [flat, { ...p, w: p.h, h: p.w, w_mm: p.h * k, h_mm: p.w * k }]
  })
}

/** The paper the output is cut to, if it is a standard one: "A6". */
export function paperName(output) {
  const p = papers().find((p) => Math.abs(p.w_mm - output.width_mm) < 0.3 && Math.abs(p.h_mm - output.height_mm) < 0.3)
  return p?.name ?? null
}

/** Decimals a paper length keeps: a tenth of a millimetre, a hundredth of a cm or inch. */
const LENGTH_DECIMALS = { mm: 1, cm: 2, in: 2 }

/** A length in mm written in `unit`, to its decimals: `6.35, 'in'` → "0.25in". */
export const lengthText = (mm, unit = 'mm') => {
  const f = 10 ** LENGTH_DECIMALS[unit]
  return `${Math.round((mm / MM_PER[unit]) * f) / f}${unit}`
}

/** Three significant figures: 24873 → 24900. */
export function sig3(x) {
  if (!Number.isFinite(x) || x === 0) return x
  const d = Math.ceil(Math.log10(Math.abs(x)))
  const f = 10 ** (3 - d)
  return Math.round(x * f) / f
}
