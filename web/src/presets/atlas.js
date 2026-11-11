title("Schoolroom atlas")
output({
  width: "297mm",
  height: "210mm",
  scale: "1:750000",   // terrain 223 × 158 km
  bearing: 0,
  projection: "webmercator",
  lat: 41.9514459,
  lng: -70.5425285,
  tileZoom: 9,
  padding: "6mm",
})

// A classic physical map, in colour — for print or screen, not the pen. The
// land in hypsometric tints, green lowlands through ochre to brown mountains
// and pale summits; the sea in blues that darken with depth; brown shade
// hatching on the slopes away from the light and thin contours at each tint;
// blue rivers and lakes, pink towns, red / orange / yellow roads, black rail,
// and names in an engraved serif.
//
// Laid out as an atlas plate, A4 landscape (a school atlas's page turned on
// its side): the map in a rectangle with a graticule every half degree, a
// border of black-and-white keys every ten minutes and the degrees round it,
// the plate's title above, and below it the scale, a key to the tints, and
// the projection. Move the plate anywhere: the graticule and the scale
// follow; only the title is written by hand.

// ── The plate ───────────────────────────────────────────────────────────
const PAGE = { w: 297, h: 210 }
/** The map's rectangle on the page, mm: room above for the title, below for the scale. */
const MAP = { x0: 17, y0: 27, x1: 280, y1: 178 }
const TITLE = "CAPE COD AND THE ISLANDS"
const SUBTITLE = "Massachusetts · physical"
const PLATE_NO = "Plate 14"
/** Graticule: a line every 30′, a border key every 10′. */
const GRID = { step: 30, ticks: 10, band: 1.4, gap: 1.1, size: 1.7 }
const INK_FRAME = "#2a2420"

const plate = areas.shape({ at: [(MAP.x0 + MAP.x1) / 2, (MAP.y0 + MAP.y1) / 2], rect: [MAP.x1 - MAP.x0, MAP.y1 - MAP.y0] })
// Every map layer is made inside the plate, and the collar round it clears
// whatever runs past its edge (roads, rivers, the relief).
const frame = plate
const mapIds = []
/** @param {DrawOptions} o */
const mapDraw = (o) => {
  const id = draw(o)
  mapIds.push(id)
  return id
}

// ── Water ────────────────────────────────────────────────────────────────
const water = areas.intersect(areas.union(engine.ocean(), areas.polygons(features.tiles("water"))), plate)
const land = areas.difference(frame, water)

// Sea, pale to deep blue: each band a little darker than the one above.
// The first steps are shallow, so coasts, bays and shelves shade too.
const SEA = [
  { depth: 0, color: "#dbecf5" },
  { depth: 10, color: "#cde4f1" },
  { depth: 50, color: "#bcd9eb" },
  { depth: 200, color: "#a9cce4" },
  { depth: 1000, color: "#94bddb" },
  { depth: 2000, color: "#80aed2" },
  { depth: 3000, color: "#6c9ec8" },
]
SEA.forEach((b, i) => {
  const area = b.depth === 0 ? water : areas.intersect(areas.band({ depthMin: b.depth }, { blur: 18 }), water)
  mapDraw({ id: `sea_${i}`, from: fills.fill({ in: area, pattern: "solid" }), stroke: { color: b.color } })
})

// ── Land: hypsometric tints ─────────────────────────────────────────────
const TINTS = [
  { from: 0, color: "#b8d4a0" },
  { from: 100, color: "#d2e2a8" },
  { from: 300, color: "#ebe4ad" },
  { from: 600, color: "#e7d095" },
  { from: 1000, color: "#d9b47f" },
  { from: 1500, color: "#c69a6c" },
  { from: 2000, color: "#ad8460" },
  { from: 2600, color: "#d9d2c6" },
  { from: 3200, color: "#f3f0ea" },
]
// The lowest tint is all the land, so none is left bare where the elevation has a gap.
const tintBands = TINTS.map((t, i) => (i === 0 ? land : areas.intersect(areas.band({ elevMin: t.from }), land)))
TINTS.forEach((t, i) => {
  mapDraw({ id: `tint_${i}`, from: fills.fill({ in: tintBands[i], pattern: "solid" }), stroke: { color: t.color } })
})

// Thin contours where one tint meets the next.
tintBands.slice(1).forEach((band, i) => {
  mapDraw({ id: `contour_${i}`, from: lines.clip(lines.rings(band), land), stroke: { color: "#9b7b58", width: 0.08 } })
})

// Relief: brown hatching on the shaded slopes only — the lit ones stay clean.
const shade = lines.terrain({
  in: land,
  angle: 90,
  style: {
    space_light: 4, space_dark: 2.2, space_steep: 0.5,
    dash_light: 0, dash_dark: 1, dash_cutoff: 0.45, dash_cutoff_soft: 0.6,
    mod_jitter: 0.3, mod_flat: 1, sun_azimuth: 315, sun_altitude: 40,
  },
})
mapDraw({ id: "relief", from: shade, stroke: { color: "#7a5f45", width: 0.1 } })

// ── Towns ───────────────────────────────────────────────────────────────
const towns = areas.intersect(areas.polygons(features.tiles("landuse:residential,commercial,industrial,retail")), land)
mapDraw({ id: "towns", from: fills.fill({ in: towns, pattern: "solid" }), stroke: { color: "#e9b8ab" } })
mapDraw({ id: "towns_edge", from: lines.rings(towns), stroke: { color: "#c98d80", width: 0.08 } })

// ── Water lines over the land ───────────────────────────────────────────
mapDraw({ id: "shore", from: lines.rings(water), stroke: { color: "#3f7fb3", width: 0.18 } })
mapDraw({ id: "rivers", from: lines.clip(lines.of(features.tiles("waterway:river,canal")), land), stroke: { color: "#3f7fb3", width: 0.3 } })
mapDraw({ id: "streams", from: lines.clip(lines.of(features.tiles("waterway:stream")), land), stroke: { color: "#5b95c2", width: 0.12 } })

// ── Roads and rail ──────────────────────────────────────────────────────
const road = (classes) => lines.of(features.tiles(`transportation:${classes}`))
// Soft, printed-atlas colours: present, never louder than the land.
mapDraw({ id: "road_secondary", from: road("secondary"), stroke: { color: "#e3cc86", width: 0.2 } })
mapDraw({ id: "road_primary", from: road("trunk,primary"), stroke: { color: "#e2a768", width: 0.28 } })
mapDraw({ id: "road_motorway", from: road("motorway"), stroke: { color: "#cf7f6f", width: 0.36 } })
mapDraw({ id: "rail", from: lines.of(features.tiles("transportation:rail/rail")), stroke: { style: "dash", dash: "1mm", gap: "0.5mm", color: "#5a5550", width: 0.13 } })

// ── Names ───────────────────────────────────────────────────────────────
// A modern serif (Source Serif 4), set solid with a white halo so names read
// over any tint, road or relief.
/** @param {number} weight @param {boolean} [italic] @returns {GoogleFont} */
const serif = (weight, italic = false) => ({ origin: "google", family: "Source Serif 4", weight, italic })

// The graticule, drawn before the names: their halos break its lines.
const grat = modules.graticule({
  in: plate,
  step: GRID.step,
  ticks: GRID.ticks,
  band: `${GRID.band}mm`,
  gap: `${GRID.gap}mm`,
  size: `${GRID.size}mm`,
  font: serif(400),
})
mapDraw({ id: "graticule", from: grat.lines, stroke: { color: "#4f6f8c", width: 0.12 } })
// Sizes follow each place's importance (its OpenMapTiles rank and capital
// standing), between `minSize` and `size`: Milan large, Pavia smaller. Every
// place gets a dot, its name beside it.
const places = modules.labels({
  from: [features.tiles("place:city,town"), features.tiles("water_name:*")],
  in: areas.grow(plate, "-1.5mm"),
  font: serif(400),
  size: "2.1mm",
  minSize: "1.4mm",
  padding: "0.8mm",
  marker: "0.55mm",
  rules: [
    { id: "city", tags: { class: "city" }, font: serif(600), size: "3.6mm", minSize: "1.9mm", upper: true },
    { id: "town", tags: { class: "town" } },
    { id: "sea", tags: { "tiles:layer": "water_name" }, font: serif(400, true), size: "3.4mm", upper: true, marker: 0 },
  ],
})
const HALO = "0.4mm"
for (const [id, color] of [["town", "#2c2925"], ["city", "#1f1c19"], ["sea", "#2f6a9c"]]) {
  const shape = places[id].area
  mapDraw({ id: `halo_${id}`, from: fills.fill({ in: areas.grow(shape, HALO), pattern: "solid" }), stroke: { color: "#ffffff" } })
  mapDraw({ id: `name_${id}`, from: fills.fill({ in: shape, pattern: "solid" }), stroke: { color } })
}

// ── The collar: graticule, border, title, scale, key ────────────────────
const textFill = (spec) => fills.fill({ in: areas.text({ ...spec, counters: "open" }), pattern: "solid" })
const frameLine = (id, from, color = INK_FRAME) => draw({ id, from, stroke: { color, width: 0.15 } })


// The border: the plate's edge, the keys in a band outside it, the band's
// outer edge, the degrees beyond, and an outer rule drawn twice round all.
/** The plate grown `d` mm on every side, corners square. @param {number} d */
const around = (d) => areas.shape({ at: [(MAP.x0 + MAP.x1) / 2, (MAP.y0 + MAP.y1) / 2], rect: [MAP.x1 - MAP.x0 + 2 * d, MAP.y1 - MAP.y0 + 2 * d] })
const bandOut = around(GRID.band)
const rule = GRID.band + 2 * GRID.gap + GRID.size
frameLine("border_inner", lines.rings(plate))
frameLine("border_band", lines.rings(bandOut))
draw({ id: "border_keys", from: fills.fill({ in: grat.keys, pattern: "solid" }), stroke: { color: INK_FRAME } })
draw({ id: "degrees", from: fills.fill({ in: grat.labelArea, pattern: "solid" }), stroke: { color: INK_FRAME } })
frameLine("border_rule", lines.join(lines.rings(around(rule)), lines.rings(around(rule + 0.45))))

// Title, above the plate.
const topY = MAP.y0 - rule - 6.5
draw({ id: "plate_title", from: textFill({ at: [PAGE.w / 2, topY], text: TITLE, size: "4.6mm", font: serif(600) }), stroke: { color: INK_FRAME } })
draw({ id: "plate_sub", from: textFill({ at: [MAP.x0 + 22, topY], text: SUBTITLE, size: "1.9mm", font: serif(400, true) }), stroke: { color: INK_FRAME } })
draw({ id: "plate_no", from: textFill({ at: [MAP.x1 - 9, topY], text: PLATE_NO, size: "1.9mm", font: serif(400, true) }), stroke: { color: INK_FRAME } })

// The scale: a bar in kilometres and one in miles, at round lengths about
// `BAR_MM` long on the paper. True at the plate's centre.
const BAR_MM = 62
const mmPerKm = 1e6 / engine.scale()
const round = (x) => {
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  return [1, 2, 2.5, 3, 4, 5, 10].map((k) => k * p).filter((v) => v <= x).pop()
}
const botY = MAP.y1 + rule + 7
const BAR_X = PAGE.w / 2 - BAR_MM / 2
const bar = (y, unitMm, unit, label) => {
  const total = round(BAR_MM / unitMm)
  const parts = 5
  const seg = (total / parts) * unitMm
  const H = 1.1
  const cells = Array.from({ length: parts }, (_, i) => areas.shape({ at: [BAR_X + seg * (i + 0.5), y], rect: [seg, H] }))
  draw({ id: `scale_${unit}_fill`, from: fills.fill({ in: areas.union(...cells.filter((_, i) => i % 2 === 0)), pattern: "solid" }), stroke: { color: INK_FRAME } })
  frameLine(`scale_${unit}_box`, lines.rings(areas.union(...cells)))
  const nums = areas.union(...Array.from({ length: parts + 1 }, (_, i) => areas.text({ at: [BAR_X + seg * i, y - H / 2 - 1.6], text: String(+(total / parts * i).toFixed(2)), size: "1.4mm", font: serif(400), counters: "open" })))
  draw({ id: `scale_${unit}_nums`, from: fills.fill({ in: nums, pattern: "solid" }), stroke: { color: INK_FRAME } })
  draw({ id: `scale_${unit}_unit`, from: textFill({ at: [BAR_X + seg * parts + 9, y], text: label, size: "1.4mm", font: serif(400, true) }), stroke: { color: INK_FRAME } })
}
bar(botY, mmPerKm, "km", "kilometres")
bar(botY + 5.6, mmPerKm * 1.609344, "mi", "miles")
const ratio = String(engine.scale()).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
draw({ id: "scale_ratio", from: textFill({ at: [PAGE.w / 2, botY + 10.6], text: `Scale 1 : ${ratio}`, size: "1.6mm", font: serif(600) }), stroke: { color: INK_FRAME } })

// The key to the tints, bottom left: land in metres, then the sea's depths.
const KEY = [...TINTS.slice(0, 6).map((t) => ({ color: t.color, label: t.from <= 0 ? "0" : String(t.from) })), ...SEA.slice(1, 5).map((b) => ({ color: b.color, label: `−${b.depth}` }))]
const KEY_W = 6.2
KEY.forEach((k, i) => {
  const x = MAP.x0 + 2 + KEY_W * (i + 0.5)
  const cell = areas.shape({ at: [x, botY + 1.5], rect: [KEY_W, 3] })
  draw({ id: `key_${i}`, from: fills.fill({ in: cell, pattern: "solid" }), stroke: { color: k.color } })
  frameLine(`key_${i}_edge`, lines.rings(cell))
  draw({ id: `key_${i}_label`, from: textFill({ at: [x, botY + 5.3], text: k.label, size: "1.2mm", font: serif(400) }), stroke: { color: INK_FRAME } })
})
draw({ id: "key_title", from: textFill({ at: [MAP.x0 + 2 + (KEY_W * KEY.length) / 2, botY - 2.4], text: "Heights and depths in metres", size: "1.3mm", font: serif(400, true) }), stroke: { color: INK_FRAME } })

draw({ id: "projection", from: textFill({ at: [MAP.x1 - 22, botY + 1.5], text: "Web Mercator projection", size: "1.4mm", font: serif(400, true) }), stroke: { color: INK_FRAME } })
draw({ id: "credit", from: textFill({ at: [MAP.x1 - 22, botY + 5.3], text: "Map data © OpenStreetMap contributors", size: "1.2mm", font: serif(400, true) }), stroke: { color: INK_FRAME } })

// The collar is paper: the map stops at the plate's edge.
compose.mask({ name: "collar", from: areas.difference(engine.frame(), plate), occludes: mapIds })
