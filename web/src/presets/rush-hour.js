// Rush hour: Boston's T as a transit map, with every train where it is right
// now. The lines (CTPS's MBTA network, GeoJSON) as solid bars in their own
// colours, named along their length; the stations as white beads on them,
// named; and the live trains (the MBTA's API, plain JSON, no key) as bigger
// beads riding the lines, cleared of everything under them. The feeds are read
// again when the cached copy is 15 minutes old: draw it twice and the trains
// move.
//
//   drawland map configs/rush-hour.js -o exports/boston.svg

title("Rush hour · live transit")
output({
  width: "10in",
  height: "8in",
  scale: "1:50000",
  projection: "webmercator",
  lat: 42.345,
  lng: -71.078,
  tileZoom: 13,
  padding: "0.2in",
})

// ── 1. PARAMETERS & STYLE PALETTE ───────────────────────────────────────

const LINE_GEO = "https://services.arcgis.com/sFnw0xNflSi8J0uh/ArcGIS/rest/services/MBTA_Lines/FeatureServer/0/query?where=1%3D1&outFields=LINE,ROUTE&f=geojson"
const API = "https://api-v3.mbta.com"
// Positions in the MBTA's replies (JSON:API).
const AT = { items: "data", lat: "attributes.latitude", lng: "attributes.longitude" }
const ROUTE = "relationships.route.data.id"

// One nib for every line; each colour is a pen of its own.
const NIB = 0.2
/** Passes that build a thick mark (bars, trains) sit this far apart: separate lines you can see, not one smear. */
const STEP = 0.3
/** Letters are filled with diagonal lines this far apart: a hatch you can see, not a solid. */
/** @type {Omit<FillOptions, "in">} */
const LETTER_HATCH = { pattern: "lines", spacing: 0.4, angle: 45 }
/** @param {string} color @returns {Stroke} */
const pen = (color) => ({ color, width: NIB, cap: "round" })
const BASE = "#c9c9c9"
const INK = "#1b1b1b"

// The lines: the network's `LINE` value, the API's route ids for its trains
// (the Silver Line's are buses), and the MBTA's own colour.
const LINES = [
  { id: "red", line: "RED", routes: ["Red", "Mattapan"], color: "#da291c" },
  { id: "orange", line: "ORANGE", routes: ["Orange"], color: "#ed8b00" },
  { id: "blue", line: "BLUE", routes: ["Blue"], color: "#003da5" },
  { id: "green", line: "GREEN", routes: ["Green-B", "Green-C", "Green-D", "Green-E"], color: "#00843d" },
  { id: "silver", line: "SILVER", routes: ["741", "742", "743", "746", "749", "751"], color: "#7c878e" },
]
/** A line's bar: passes of the nib side by side, read as one solid line. */
const BAR_PASSES = 5
/** Stations: white beads cut into the bars, with a dark ring. */
const STATION_R = 0.95
/** Trains: bigger beads in the line's colour, inked solid, a halo of paper round them. */
const TRAIN_R = 1.5
const TRAIN_HALO = 0.45
/** Downtown, where the lines bunch up: no line names here. */
const DOWNTOWN = { lat: 42.3555, lng: -71.0605 }
const DOWNTOWN_R = "28mm"
/** @type {Omit<FillOptions, "in">} */
const SOLID = { pattern: "concentric", spacing: STEP }

/** @param {number} weight @returns {GoogleFont} */
const FONT = (weight) => ({ origin: "google", family: "Montserrat", weight })
// Text is centred on its point: `em` (× capital height, per letter) sets it
// from its left edge instead.
const HEAD = { text: "THE T, RIGHT NOW", size: 6, at: [9, 14], em: 0.98 }

// ── 2. FEATURE EXTRACTION & GEOMETRY PIPELINE ───────────────────────────

const frame = engine.frame()
const water = areas.union(engine.ocean(), areas.polygons(features.tiles("water")))
const streets = lines.clip(lines.of(features.tiles("transportation:primary,secondary,tertiary,minor,trunk,motorway")), areas.difference(frame, water))

const network = features.geojson(LINE_GEO)
// One point per station: the platforms' parent stations, which the reply
// carries alongside them (`included`).
const stops = features.json(`${API}/stops?filter%5Broute_type%5D=0,1&include=parent_station`, { ...AT, items: "included" })
const trains = features.json(`${API}/vehicles?filter%5Broute_type%5D=0,1`, AT)
const buses = features.json(`${API}/vehicles?filter%5Broute_type%5D=3`, AT)

const stations = areas.around(stops, `${STATION_R}mm`)
const lineBars = LINES.map((l) => {
  const centre = lines.of(features.where(network, { LINE: l.line }))
  const sides = Array.from({ length: (BAR_PASSES - 1) / 2 }, (_, k) => lines.rings(areas.buffer(centre, `${(k + 1) * STEP}mm`)))
  const riders = features.where(l.id === "silver" ? buses : trains, { [ROUTE]: l.routes })
  return { ...l, bar: lines.join(centre, ...sides), beads: areas.around(riders, `${TRAIN_R}mm`) }
})
const beads = areas.union(...lineBars.map((l) => l.beads))
const beadRoom = areas.grow(beads, `${TRAIN_HALO}mm`)

// Names, in two passes. The lines' first, along their length, kept out of
// the downtown knot where the lines run side by side. Then the stations',
// each beside its bead, kept off every line, train and line name.
const lineNames = modules.labels({
  from: network,
  keys: ["LINE"],
  in: areas.difference(frame, areas.shape({ at: DOWNTOWN, circle: DOWNTOWN_R })),
  // Off the trains: the stretch a name sits on is one no train is on now.
  avoid: beadRoom,
  font: FONT(800),
  size: "2.6mm",
  minSize: "2.6mm",
  padding: "0.8mm",
  spacing: "90mm",
  // Only along straight stretches: set round a bend, the letters crowd and
  // run into each other.
  curved: false,
  rules: LINES.map((l) => ({ id: l.id, tags: { LINE: l.line } })),
})
const linework = areas.union(...lineBars.map((l) => areas.buffer(l.bar, `${STEP}mm`)))
const stationNames = modules.labels({
  from: stops,
  keys: ["attributes.name"],
  avoid: areas.union(linework, beadRoom, areas.grow(lineNames.area, "1mm")),
  font: FONT(600),
  size: "1.7mm",
  minSize: "1.7mm",
  padding: "0.6mm",
  marker: `${STATION_R + 0.4}mm`,
  // A rule of its own: its area keeps the letters' holes open, to fill them.
  rules: [{ id: "names", tags: { "attributes.name": true } }],
})
const nameRoom = areas.union(
  lineNames.area, areas.buffer(lineNames.lines, "0.7mm"),
  areas.difference(stationNames.area, areas.grow(stations, "0.3mm")), areas.buffer(stationNames.lines, "0.5mm"),
)

/** @type {TextSpec} */
const headSpec = { at: [HEAD.at[0] + (HEAD.text.length * HEAD.size * HEAD.em) / 2, HEAD.at[1]], text: HEAD.text, size: `${HEAD.size}mm`, font: FONT(800), counters: "open" }
const headRoom = areas.grow(areas.text(headSpec), "1.5mm")

// ── 3. DRAW LAYERS ──────────────────────────────────────────────────────

const base = [
  draw({ id: "water", from: fills.fill({ in: water, pattern: "lines", spacing: "1.4mm", angle: 0 }), stroke: pen(BASE) }),
  draw({ id: "shore", from: lines.rings(water), stroke: pen(BASE) }),
  draw({ id: "streets", from: streets, stroke: pen(BASE) }),
]
const bars = lineBars.map((l) => draw({ id: `line_${l.id}`, from: l.bar, stroke: pen(l.color) }))
const stationRings = draw({ id: "stations", from: lines.rings(stations), stroke: pen(INK) })
lineBars.forEach((l) => draw({ id: `trains_${l.id}`, from: fills.fill({ in: l.beads, ...SOLID }), stroke: pen(l.color) }))
LINES.forEach((l) => {
  draw({ id: `name_${l.id}`, from: lineNames[l.id].lines, stroke: pen(l.color) })
  draw({ id: `name_${l.id}_fill`, from: fills.fill({ in: lineNames[l.id].area, ...LETTER_HATCH }), stroke: pen(l.color) })
})
draw({ id: "names_stations", from: stationNames.lines, stroke: pen(INK) })
// Station names are small: their outline alone reads, holes and all.
draw({ id: "title", from: lines.text(headSpec), stroke: pen(INK) })
draw({ id: "title_fill", from: fills.fill({ in: areas.text(headSpec), ...LETTER_HATCH }), stroke: pen(INK) })

// ── 4. OCCLUSION MASKS ──────────────────────────────────────────────────

// Stations cut the bars; trains clear a halo through everything — names
// too, a train is the news; names and
// the title clear what is under them.
compose.mask({ name: "station_cut", from: stations, occludes: [...base, ...bars] })
const nameIds = [...LINES.flatMap((l) => [`name_${l.id}`, `name_${l.id}_fill`]), "names_stations"]
compose.mask({ name: "train_halo", from: beadRoom, occludes: [...base, ...bars, stationRings, ...nameIds] })
compose.mask({ name: "name_room", from: nameRoom, occludes: [...base, ...bars, stationRings] })
compose.mask({ name: "title_room", from: headRoom, occludes: [...base, ...bars, stationRings, "names_stations", ...lineBars.map((l) => `trains_${l.id}`)] })
