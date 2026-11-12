// A GeoJSON of your own over a base map, for two pens: the map in black
// (water, parks, streets from the vector tiles), the dataset in red — its
// polygons hatched and outlined, its lines drawn, its points dotted, each
// feature named from its properties. The black stops short of every red
// stroke, so the two inks never touch.
//
// In the browser, drop a .geojson anywhere on the page: it opens here, framed
// to its extent. Or point DATA at a URL (it must allow CORS in the browser), or
// on the command line at a file beside this profile, then set the place and
// scale to fit it (or pass --address / --lat --lng):
//
//   drawland map configs/red-pencil.js -o exports/overlay.svg
//
// The default is Paris's twenty arrondissements, from opendata.paris.fr.

title("Red pencil · GeoJSON")
output({
  width: "10in",
  height: "7.5in",
  scale: "1:85000",
  projection: "webmercator",
  lat: 48.8585,
  lng: 2.347,
  tileZoom: 13,
  padding: "0.3in",
})

// ── 1. PARAMETERS & STYLE PALETTE ───────────────────────────────────────

const DATA = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson"
// The properties a feature's name is read from, the first present.
const NAME_KEYS = ["name", "l_aroff", "NAME", "title", "label"]

// Two pens.
const BLACK = "#1b1b1b"
const RED = "#d02a1e"

/** @type {FillStyle} */
const FILL_WATER = { pattern: "lines", spacing: "0.7mm", angle: 0 }
/** @type {FillStyle} */
const FILL_PARK = { pattern: "dots", spacing: "0.9mm", mark: "0.15mm" }
// One hatch per polygon, so neighbours read apart where they share an edge.
/** @type {FillStyle} */
const FILL_DATA = { pattern: "lines", spacing: "2.2mm", angle: 45, per: "feature" }
const POINT_R = "0.8mm"
const FONT = "futural"

// One width for every line, as a pen has. A line that should read heavier
// (the dataset's borders) is drawn double: two lines DOUBLE apart.
const PEN = 0.15
const STROKE_BLACK = { color: BLACK, width: PEN }
const STROKE_RED = { color: RED, width: PEN }
const DOUBLE = "0.4mm"

// How far the black keeps from each red stroke (half-widths, from the stroke's
// centre), and how far the red hatch keeps from the red names.
const CLEAR_EDGE = "0.75mm"
const CLEAR_HATCH = "0.35mm"
const CLEAR_POINT = "0.4mm"
const CLEAR_NAME = "0.7mm"

// ── 2. FEATURE EXTRACTION & GEOMETRY PIPELINE ───────────────────────────

const frame = engine.frame()
const water = areas.union(engine.ocean(), areas.polygons(features.tiles("water")))
const parks = areas.difference(areas.polygons(features.tiles("parks", "forest")), water)
const streets = lines.clip(lines.of(features.tiles("roads")), areas.difference(frame, water))

const data = features.geojson(DATA)
const dataAreas = areas.polygons(data)
// Shared borders drawn once: a polygon's edge and its neighbour's are one line.
const dataEdges = lines.dedupe(lines.segments(data))
// …then doubled: the outline of a thin strip round them, a line either side.
const edgeStrip = areas.buffer(dataEdges, `${parseFloat(DOUBLE) / 2}mm`)
const dataEdgesDouble = lines.rings(edgeStrip)
const dataPoints = areas.around(data, POINT_R)
const dataHatch = fills.fill({ in: dataAreas, ...FILL_DATA })

const names = modules.labels({
  from: data,
  keys: NAME_KEYS,
  font: FONT,
  size: "2.6mm",
  minSize: "1.6mm",
  padding: "0.8mm",
  upper: true,
})

// The room every red stroke takes: the black is cut out of it. Single-stroke
// names cover no area of their own, so their room is buffered round the strokes.
const nameRoom = areas.union(names.area, areas.buffer(names.lines, CLEAR_NAME))
const redRoom = areas.union(
  areas.buffer(dataEdges, CLEAR_EDGE),
  areas.buffer(dataHatch, CLEAR_HATCH),
  areas.grow(dataPoints, CLEAR_POINT),
  nameRoom,
)

// ── 3. DRAW LAYERS ──────────────────────────────────────────────────────

const base = [
  draw({ id: "water", from: fills.fill({ in: water, ...FILL_WATER }), stroke: STROKE_BLACK }),
  draw({ id: "water_edge", from: lines.rings(water), stroke: STROKE_BLACK }),
  draw({ id: "parks", from: fills.fill({ in: parks, ...FILL_PARK }), stroke: STROKE_BLACK }),
  draw({ id: "streets", from: streets, stroke: STROKE_BLACK }),
]
const dataFill = draw({ id: "data_fill", from: dataHatch, stroke: STROKE_RED })
const overlay = [
  dataFill,
  draw({ id: "data_edges", from: dataEdgesDouble, stroke: STROKE_RED }),
  draw({ id: "data_points", from: fills.fill({ in: dataPoints, pattern: "concentric", spacing: "0.3mm" }), stroke: STROKE_RED }),
]
draw({ id: "names", from: names.lines, stroke: STROKE_RED })

// ── 4. OCCLUSION MASKS & LAYER ORDER ────────────────────────────────────

// Black clears every red stroke; the red hatch and borders clear the names.
compose.mask({ name: "red_clearance", from: redRoom, occludes: base })
compose.mask({ name: "name_halo", from: nameRoom, occludes: overlay })
// The hatch stops a little short of the doubled borders, not in between them.
compose.mask({ name: "edge_gap", from: areas.grow(edgeStrip, "0.25mm"), occludes: [dataFill] })
