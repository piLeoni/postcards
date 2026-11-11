title("Shaky ground (lite)")
output({ width: "6in", height: "4in", scale: "1:250000000", projection: "webmercator", lat: 12, lng: 0, tileZoom: 2, padding: "0.15in" })
// Shaky ground: the last 30 days of magnitude 4.5+ earthquakes, read live
// from the USGS GeoJSON feed and drawn over the plate boundaries they trace.
// `features.where` splits the quakes into bands by magnitude (dot size) and
// depth (ink colour); the strongest are named. No map tiles: every layer is
// a dataset. The full preset is Shaky ground in the gallery.

// ── 1. Parameters & palette ─────────────────────────────────────────────
const DATA = {
  quakes: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson",
  countries: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
  plates: "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json",
}
// One pen width; each colour is its own pen.
/** @param {string} color @returns {Stroke} */
const pen = (color) => ({ width: 0.2, cap: "round", color })
/** @type {Stroke} */
const PLATES = { style: "dash", dash: "1.2mm", gap: "0.5mm", width: 0.2, cap: "round", color: "#b0563a" }

// Bands are [min, max): a 6.0 falls in the third. `r` is the dot's radius.
/** @type {{ min: number, max: number, r: Length }[]} */
const MAG = [
  { min: 4.5, max: 5, r: "0.3mm" },
  { min: 5, max: 6, r: "0.6mm" },
  { min: 6, max: 7, r: "1mm" },
  { min: 7, max: 10, r: "1.6mm" },
]
// Depth in km is the point's third coordinate, read as the tag `geom:z`.
const DEPTH = [
  { min: -10, max: 70, color: "#d1452b" },   // shallow: the ones that do damage
  { min: 70, max: 300, color: "#e0a02a" },
  { min: 300, max: 1000, color: "#3f6fa8" }, // deep: slabs sinking under trenches
]
/** @type {Omit<FillOptions, "in">} */
const FILL_DOT = { pattern: "concentric", spacing: "0.22mm" }

// ── 2. Data & geometry ──────────────────────────────────────────────────
const earth = engine.frame()
const land = areas.intersect(areas.polygons(features.geojson(DATA.countries)), earth)
const plates = lines.clip(lines.of(features.geojson(DATA.plates)), earth)
const quakes = features.geojson(DATA.quakes)

// The strongest quakes, named with their magnitude (the feed's `mag` tag).
const named = modules.labels({
  from: features.where(quakes, { mag: { min: 6.5 } }),
  keys: ["mag"], font: "futural", size: "1.4mm", minSize: "1.4mm", padding: "0.5mm", marker: "2mm",
})

// ── 3. Draws ────────────────────────────────────────────────────────────
draw({ id: "land", from: fills.fill({ in: land, pattern: "lines", spacing: "0.6mm", angle: 45 }), stroke: pen("#b9b2a6") })
draw({ id: "coast", from: lines.rings(land), stroke: pen("#6f675c") })
draw({ id: "plates", from: plates, stroke: PLATES })

// Every magnitude × depth cell is a disc per quake, filled and ringed in its
// depth's ink; smallest first, so a big quake sits on top.
MAG.forEach((m, i) => DEPTH.forEach((d, j) => {
  const band = features.where(quakes, { mag: { min: m.min, max: m.max }, "geom:z": { min: d.min, max: d.max } })
  const dots = areas.around(band, m.r)
  draw({ id: `quake_${i}_${j}`, from: lines.join(fills.fill({ in: dots, ...FILL_DOT }), lines.rings(dots)), stroke: pen(d.color) })
}))
draw({ id: "magnitudes", from: named.lines, stroke: pen("#2b2b2b") })
