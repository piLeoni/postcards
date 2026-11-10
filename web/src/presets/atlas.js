title("Schoolroom atlas")
output({
  width: "8in",
  height: "6in",
  scale: "1:750000",
  bearing: 0,
  projection: "webmercator",
  lat: 44.42,
  lng: 8.95,
  tileZoom: 9,
  padding: "0.15in",
})

// A classic physical map, in colour — for print or screen, not the pen. The
// land in hypsometric tints, green lowlands through ochre to brown mountains
// and pale summits; the sea in blues that darken with depth; brown shade
// hatching on the slopes away from the light and thin contours at each tint;
// blue rivers and lakes, pink towns, red / orange / yellow roads, black rail,
// and names in an engraved serif.

const frame = engine.frame()

// ── Water ────────────────────────────────────────────────────────────────
const water = areas.union(engine.ocean(), areas.polygons(features.tiles("water")))
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
  draw({ id: `sea_${i}`, from: fills.fill({ in: area, pattern: "solid" }), stroke: { color: b.color } })
})

// ── Land: hypsometric tints ─────────────────────────────────────────────
const TINTS = [
  { from: -50, color: "#b8d4a0" },
  { from: 100, color: "#d2e2a8" },
  { from: 300, color: "#ebe4ad" },
  { from: 600, color: "#e7d095" },
  { from: 1000, color: "#d9b47f" },
  { from: 1500, color: "#c69a6c" },
  { from: 2000, color: "#ad8460" },
  { from: 2600, color: "#d9d2c6" },
  { from: 3200, color: "#f3f0ea" },
]
const tintBands = TINTS.map((t) => areas.intersect(areas.band({ elevMin: t.from }), land))
TINTS.forEach((t, i) => {
  draw({ id: `tint_${i}`, from: fills.fill({ in: tintBands[i], pattern: "solid" }), stroke: { color: t.color } })
})

// Thin contours where one tint meets the next.
tintBands.slice(1).forEach((band, i) => {
  draw({ id: `contour_${i}`, from: lines.clip(lines.rings(band), land), stroke: { color: "#9b7b58", width: 0.08 } })
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
draw({ id: "relief", from: shade, stroke: { color: "#7a5f45", width: 0.1 } })

// ── Towns ───────────────────────────────────────────────────────────────
const towns = areas.intersect(areas.polygons(features.tiles("landuse:residential,commercial,industrial,retail")), land)
draw({ id: "towns", from: fills.fill({ in: towns, pattern: "solid" }), stroke: { color: "#e9b8ab" } })
draw({ id: "towns_edge", from: lines.rings(towns), stroke: { color: "#c98d80", width: 0.08 } })

// ── Water lines over the land ───────────────────────────────────────────
draw({ id: "shore", from: lines.rings(water), stroke: { color: "#3f7fb3", width: 0.18 } })
draw({ id: "rivers", from: lines.clip(lines.of(features.tiles("waterway:river,canal")), land), stroke: { color: "#3f7fb3", width: 0.3 } })
draw({ id: "streams", from: lines.clip(lines.of(features.tiles("waterway:stream")), land), stroke: { color: "#5b95c2", width: 0.12 } })

// ── Roads and rail ──────────────────────────────────────────────────────
const road = (classes) => lines.of(features.tiles(`transportation:${classes}`))
// Soft, printed-atlas colours: present, never louder than the land.
draw({ id: "road_secondary", from: road("secondary"), stroke: { color: "#e3cc86", width: 0.2 } })
draw({ id: "road_primary", from: road("trunk,primary"), stroke: { color: "#e2a768", width: 0.28 } })
draw({ id: "road_motorway", from: road("motorway"), stroke: { color: "#cf7f6f", width: 0.36 } })
draw({ id: "rail", from: lines.of(features.tiles("transportation:rail/rail")), stroke: { style: "dash", dash: "1mm", gap: "0.5mm", color: "#5a5550", width: 0.13 } })

// ── Names ───────────────────────────────────────────────────────────────
// A modern serif (Source Serif 4), set solid with a white halo so names read
// over any tint, road or relief.
/** @param {number} weight @param {boolean} [italic] @returns {GoogleFont} */
const serif = (weight, italic = false) => ({ origin: "google", family: "Source Serif 4", weight, italic })
// Sizes follow each place's importance (its OpenMapTiles rank and capital
// standing), between `minSize` and `size`: Milan large, Pavia smaller. Every
// place gets a dot, its name beside it.
const places = modules.labels({
  from: [features.tiles("place:city,town"), features.tiles("water_name:*")],
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
  draw({ id: `halo_${id}`, from: fills.fill({ in: areas.grow(shape, HALO), pattern: "solid" }), stroke: { color: "#ffffff" } })
  draw({ id: `name_${id}`, from: fills.fill({ in: shape, pattern: "solid" }), stroke: { color } })
}

// A neat line around the map.
draw({ id: "neatline", from: lines.rings(frame), stroke: { color: "#2a2420", width: 0.3 } })
