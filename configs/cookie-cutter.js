// Cookie cutter: one state's silhouette, on a 4 × 6 in portrait card, its relief
// in one ink and one pattern. Every height belt is hatched with the same
// lines, closer together the higher it lies, and outlined where it meets the
// next. Nothing is drawn outside the border; the border is its own layer
// (`cut`), the line a knife or a laser follows to cut the card into the shape.
//
// Change STATE (any Natural Earth admin-1 name) and move the card onto it.
//
//   drawland map configs/cookie-cutter.js -o exports/state-cut.svg

title("Cookie cutter · boolean cut")
output({
  width: "4in",
  height: "6in",
  scale: "1:10500000",
  projection: "webmercator",
  lat: 37.4,
  lng: -119.4,
  bearing: 0,
  padding: "0.2in",
  tileZoom: 6,
})

// ── 1. PARAMETERS & STYLE PALETTE ───────────────────────────────────────

const STATE = "California"
const STATES = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lakes.geojson"

// One pen for everything.
const INK = "#1b1b1b"

// Height belts, low to high, in metres: a belt is the land from `from` up to
// the next one. One pattern for all, its spacing the only thing that changes:
// the higher, the closer the lines.
// Across the Sierra, not along it: the belts read as steps, not stripes.
/** @type {FillStyle} */
const PATTERN = { pattern: "lines", angle: -45 }
const BELTS = [
  { from: -100, spacing: 3.2 },
  { from: 200, spacing: 2.2 },
  { from: 600, spacing: 1.6 },
  { from: 1000, spacing: 1.2 },
  { from: 1500, spacing: 0.9 },
  { from: 2000, spacing: 0.68 },
  { from: 2600, spacing: 0.5 },
  { from: 3200, spacing: 0.36 },
]
// Smooth belts, not pixels: the terrain is blurred before it is cut.
const BELT_BLUR = 6

// One pen, one width, for every line. A line that should read heavier is
// drawn twice, the second a little inside the first: the border is the cut
// and a ring DOUBLE inside it.
const STROKE = { color: INK, width: 0.15 }
const DOUBLE = "0.35mm"
const FONT = "futural"

// Name and key in page millimetres, where the state leaves the card free
// (laid out for California; move them for another state).
/** @type {ShapeAt} */
const NAME_AT = ["50%", 141]
const KEY = { x: 64, top: 26, step: 5.2, swatch: 3.6 }

// ── 2. FEATURE EXTRACTION & GEOMETRY PIPELINE ───────────────────────────

const state = areas.polygons(features.where(features.geojson(STATES), { name: STATE }))
// The relief stops at the border's inner line.
const inner = areas.grow(state, `-${DOUBLE}`)
// The belts, each the land between its height and the next belt's.
const belts = BELTS.map((b, i) => {
  const next = BELTS[i + 1]
  const band = areas.band(next ? { elevMin: b.from, elevMax: next.from } : { elevMin: b.from }, { blur: BELT_BLUR })
  return { ...b, area: areas.intersect(band, inner) }
})
// One outline per level: the edge of the land above it, inside the border,
// so no edge is drawn twice.
const inside = areas.grow(inner, "-0.1mm")
const levels = BELTS.slice(1).map((b) =>
  lines.clip(lines.rings(areas.intersect(areas.band({ elevMin: b.from }, { blur: BELT_BLUR }), inner)), inside),
)

// ── 3. DRAW LAYERS ──────────────────────────────────────────────────────

belts.forEach((b, i) =>
  draw({ id: `relief_${i}`, from: fills.fill({ in: b.area, ...PATTERN, spacing: `${b.spacing}mm` }), stroke: STROKE }),
)
levels.forEach((l, i) => draw({ id: `level_${i + 1}`, from: l, stroke: STROKE }))
draw({ id: "name", from: lines.text({ at: NAME_AT, text: STATE.toUpperCase(), size: "2.6mm", font: FONT }), stroke: STROKE })

// The key: each belt's hatch in a swatch, highest on top, its lower height beside it.
;[...belts].reverse().forEach((b, i) => {
  const y = KEY.top + i * KEY.step
  const swatch = areas.shape({ at: [KEY.x, y], rect: [KEY.swatch, KEY.swatch] })
  draw({ id: `key_${i}`, from: fills.fill({ in: swatch, ...PATTERN, spacing: `${b.spacing}mm` }), stroke: STROKE })
  draw({ id: `key_edge_${i}`, from: lines.rings(swatch), stroke: STROKE })
  draw({ id: `key_text_${i}`, from: lines.text({ at: [KEY.x + 9, y], text: `${Math.max(0, b.from)} m`, size: "1.3mm", font: FONT }), stroke: STROKE })
})
// The border, doubled: its inner line, then the cut (a layer of its own for the knife).
draw({ id: "border_inner", from: lines.rings(inner), stroke: STROKE })
draw({ id: "cut", from: lines.rings(state), stroke: STROKE })
