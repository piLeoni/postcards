// Shaky ground: the last 30 days of magnitude 4.5+ quakes from the USGS live
// feed, on a plain map (Natural Earth countries) with the tectonic plate
// boundaries they trace. Web mercator, like the map on the page: move or
// rescale the card and it draws whatever part of the world is under it. Dot size is the magnitude, ink the
// depth; the largest are named with their magnitude. Draw it again tomorrow
// and the dots move: the feed is re-read when the cached copy is 15 min old.
//
//   drawland map configs/shaky-ground.js -o exports/earthquakes.svg

title("Shaky ground · live data")
output({
  width: "11in",
  height: "7in",
  scale: "1:140000000",
  projection: "webmercator",
  lat: 12,
  lng: 0,
  padding: "0.25in",
  // No vector tiles are read: every layer is a dataset.
  tileZoom: 2,
})

// ── 1. PARAMETERS & STYLE PALETTE ───────────────────────────────────────

const DATA = {
  quakes: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson",
  countries: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
  // Bird (2003), An updated digital model of plate boundaries.
  plates: "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json",
}

const INK = {
  frame: "#3a3a3a",
  land: "#b9b2a6",
  border: "#c9c2b6",
  coast: "#6f675c",
  sea: "#d4e2ea",
  grid: "#c2d3dd",
  plates: "#b0563a",
  text: "#2b2b2b",
}

// Size by magnitude: each band's dot radius, and the ripple drawn round the
// strongest. Bands are [min, max): a 6.0 is in the third.
const MAG = [
  { id: "m45", min: 4.5, max: 5, r: "0.45mm" },
  { id: "m50", min: 5, max: 6, r: "0.85mm" },
  { id: "m60", min: 6, max: 7, r: "1.5mm", ripple: ["2.2mm"] },
  { id: "m70", min: 7, max: 10, r: "2.3mm", ripple: ["3.1mm", "3.9mm"] },
]

// Ink by depth (km below the surface, the feed's third coordinate): shallow
// quakes do the damage, deep ones mark slabs sinking under the trenches.
const DEPTH = [
  { id: "shallow", min: -10, max: 70, color: "#d1452b", label: "0–70 km" },
  { id: "mid", min: 70, max: 300, color: "#e0a02a", label: "70–300 km" },
  { id: "deep", min: 300, max: 1000, color: "#3f6fa8", label: "300+ km" },
]

const FILL_DOT = { pattern: "concentric", spacing: "0.22mm" }
const FILL_SEA = { pattern: "lines", spacing: "1.1mm", angle: 0 }
const GRID_STEP = 30
const LABEL_MIN_MAG = 6.5
const FONT = "futural"

// ── 2. FEATURE EXTRACTION & GEOMETRY PIPELINE ───────────────────────────

// A graticule, as GeoJSON written here (web mercator ends at ±85°).
const meridian = (lng) => Array.from({ length: 171 }, (_, i) => [lng, i - 85])
const parallel = (lat) => Array.from({ length: 361 }, (_, i) => [i - 180, lat])
const graticule = features.geojson({
  type: "MultiLineString",
  coordinates: [
    ...Array.from({ length: 360 / GRID_STEP - 1 }, (_, i) => meridian(-180 + GRID_STEP * (i + 1))),
    ...Array.from({ length: 180 / GRID_STEP - 1 }, (_, i) => parallel(-90 + GRID_STEP * (i + 1))),
  ],
})

const earth = engine.frame()
const land = areas.intersect(areas.polygons(features.geojson(DATA.countries)), earth)
const sea = areas.difference(earth, land)
const borders = lines.clip(lines.dedupe(lines.segments(features.geojson(DATA.countries))), areas.grow(land, "-0.05mm"))
const plates = lines.clip(lines.of(features.geojson(DATA.plates)), earth)

const quakes = features.geojson(DATA.quakes)
// One area per magnitude × depth cell, and the ripples per magnitude.
const cells = MAG.flatMap((m) =>
  DEPTH.map((d) => ({
    m,
    d,
    area: areas.around(features.where(quakes, { mag: { min: m.min, max: m.max }, "geom:z": { min: d.min, max: d.max } }), m.r),
  })),
)
const ripples = MAG.filter((m) => m.ripple).flatMap((m) =>
  m.ripple.map((r) => lines.rings(areas.around(features.where(quakes, { mag: { min: m.min, max: m.max } }), r))),
)

const named = modules.labels({
  from: features.where(quakes, { mag: { min: LABEL_MIN_MAG } }),
  keys: ["mag"],
  font: FONT,
  size: "1.6mm",
  minSize: "1.6mm",
  padding: "0.6mm",
  marker: "2.6mm",
})

// ── Legend and title, in page millimetres (laid out for 11 × 7 in) ───────
const W = 279.4
const H = 177.8
const PAD = 6.35
const LEG_Y = H - 17
// White bands the map stops at: the title on top, the legend below.
const TITLE_BAND = [PAD, 19]
const LEGEND_BAND = [H - 28, H - PAD]
const band = ([y0, y1]) => areas.shape({ at: [W / 2, (y0 + y1) / 2], rect: [W - 2 * PAD, y1 - y0] })
const bands = areas.union(band(TITLE_BAND), band(LEGEND_BAND))
const mapIds = []
const legend = []
MAG.forEach((m, i) => {
  const x = 26 + i * 15
  legend.push({ area: areas.shape({ at: [x, LEG_Y], circle: m.r }), color: INK.text })
  legend.push({ text: lines.text({ at: [x, LEG_Y + 6], text: `${m.min}${i === MAG.length - 1 ? "+" : ""}`, size: "1.6mm", font: FONT }) })
})
DEPTH.forEach((d, i) => {
  const x = 112 + i * 24
  legend.push({ area: areas.shape({ at: [x - 7, LEG_Y], circle: "0.85mm" }), color: d.color })
  legend.push({ text: lines.text({ at: [x + 3, LEG_Y], text: d.label, size: "1.6mm", font: FONT }) })
})

// ── 3. DRAW LAYERS ──────────────────────────────────────────────────────

mapIds.push(draw({ id: "sea", from: fills.fill({ in: sea, ...FILL_SEA }), stroke: { color: INK.sea, width: 0.12 } }))
mapIds.push(draw({ id: "graticule", from: lines.clip(lines.of(graticule), sea), stroke: { style: "dash", dash: "0.6mm", gap: "0.6mm", color: INK.grid, width: 0.12 } }))
mapIds.push(draw({ id: "land", from: fills.fill({ in: land, pattern: "lines", spacing: "0.6mm", angle: 45 }), stroke: { color: INK.land, width: 0.1 } }))
mapIds.push(draw({ id: "borders", from: borders, stroke: { color: INK.border, width: 0.15 } }))
mapIds.push(draw({ id: "coast", from: lines.rings(land), stroke: { color: INK.coast, width: 0.2 } }))
draw({ id: "neatline", from: lines.rings(areas.difference(earth, bands)), stroke: { color: INK.coast, width: 0.3 } })
mapIds.push(draw({ id: "plates", from: plates, stroke: { style: "dash", dash: "1.2mm", gap: "0.5mm", color: INK.plates, width: 0.25 } }))

// Ripples first, then dots smallest to largest so a big quake sits on top.
ripples.forEach((r, i) => mapIds.push(draw({ id: `ripple_${i}`, from: r, stroke: { color: INK.text, width: 0.12 } })))
for (const { m, d, area } of cells) {
  mapIds.push(draw({ id: `quake_${m.id}_${d.id}`, from: fills.fill({ in: area, ...FILL_DOT }), stroke: { color: d.color, width: 0.2 } }))
  mapIds.push(draw({ id: `quake_${m.id}_${d.id}_edge`, from: lines.rings(area), stroke: { color: d.color, width: 0.2 } }))
}
mapIds.push(draw({ id: "magnitudes", from: named.lines, stroke: { color: INK.text, width: 0.18 } }))

draw({ id: "title", from: lines.text({ at: [W / 2, (TITLE_BAND[0] + TITLE_BAND[1]) / 2], text: "EARTHQUAKES OF THE LAST 30 DAYS · MAGNITUDE 4.5 AND ABOVE", size: "3.2mm", font: FONT }), stroke: { color: INK.text, width: 0.3 } })
legend.forEach((l, i) => {
  if (l.area) draw({ id: `legend_dot_${i}`, from: fills.fill({ in: l.area, ...FILL_DOT }), stroke: { color: l.color, width: 0.2 } })
  else draw({ id: `legend_text_${i}`, from: l.text, stroke: { color: INK.text, width: 0.18 } })
})
draw({ id: "legend_heads", from: lines.text({ at: [48, LEG_Y - 5], text: "MAGNITUDE", size: "1.5mm", font: FONT }), stroke: { color: INK.text, width: 0.18 } })
draw({ id: "legend_depth", from: lines.text({ at: [129, LEG_Y - 5], text: "DEPTH", size: "1.5mm", font: FONT }), stroke: { color: INK.text, width: 0.18 } })
draw({ id: "legend_plates", from: lines.shape({ at: [196, LEG_Y], points: [[-7, 0], [7, 0]], closed: false }), stroke: { style: "dash", dash: "1.2mm", gap: "0.5mm", color: INK.plates, width: 0.25 } })
draw({ id: "legend_plates_text", from: lines.text({ at: [218, LEG_Y], text: "plate boundaries", size: "1.6mm", font: FONT }), stroke: { color: INK.text, width: 0.18 } })
draw({ id: "credits", from: lines.text({ at: [W / 2, H - PAD - 2.5], text: "USGS live feed · Natural Earth · plate boundaries after Bird (2003)", size: "1.2mm", font: FONT }), stroke: { color: INK.coast, width: 0.15 } })

// ── 4. OCCLUSION MASKS & LAYER ORDER ────────────────────────────────────

compose.mask({ name: "bands", from: bands, occludes: mapIds })
