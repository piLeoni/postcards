title("Brutalist")
output({
  width: "6in",
  height: "4in",
  scale: "1:10000",
  bearing: 0,
  projection: "webmercator",
  lat: 37.8056294,
  lng: -122.4462699,
  tileZoom: 14,
  padding: "0.1in",
})

// A heavy-nib plan in the spirit of a 1950s master-plan drawing: streets
// drawn as parallel offset lines, frayed swells at sea, stippled relief and
// growing trees, dotted building masses and angular names. One ink per
// family (`INK`), all black by default.

// ═══════════════════════════════════════════════════════════════════════════
// 1. PARAMETERS & STYLE PALETTE
// ═══════════════════════════════════════════════════════════════════════════
/** Master nib (mm): a broad fineliner. Every paper length is `pen(k)` = k × PEN. */
const PEN = 0.5
/** @param {number} k @returns {number} */
const pen = (k) => PEN * k
/** Metres on the ground as mm on this output's paper: for things with a real size (a tree). @param {number} m @returns {number} */
const metres = (m) => (m * 1000) / engine.scale()

// 1a. Inks: one pen per family, each its own plotter layer group. `null`
// takes the app's ink (it follows the colour mode); a hex fixes the colour.
// A four-ink set that works: street "#e0301e", water "#1d4fd8",
// nature "#1e8a3c", built "#111111".
/** @type {{ street: string | null, water: string | null, nature: string | null, built: string | null }} */
const INK = {
  street: null,
  water:  null,
  nature: null,
  built:  null,   // buildings, rail, names
}
/** Fine nib (half the master): streets, sea, small names. */
const FINE = pen(0.5)
/** @param {string | null} color @param {number} [width] @returns {Exclude<Stroke, string>} */
const inkStroke = (color, width = PEN) => ({ style: "solid", ...(color ? { color } : {}), width, cap: "round", join: "round" })

/** @type {Stroke} */
const STROKE_SOLID   = inkStroke(INK.built)
/** @type {Stroke} */
const STROKE_STREET  = inkStroke(INK.street, FINE)
/** @type {Stroke} */
const STROKE_WATER   = inkStroke(INK.water)
/** @type {Stroke} */
const STROKE_SEA     = inkStroke(INK.water, FINE)
/** @type {Stroke} */
const STROKE_NATURE  = inkStroke(INK.nature)
/** @type {Stroke} */
const STROKE_TREES   = inkStroke(INK.nature, FINE)
/** @type {Stroke} */
const STROKE_FINE    = inkStroke(INK.built, FINE)
/** @type {Stroke} */
/** Rail: fine dashes, so a bundle of tracks stays grey, not a black bar. */
/** @type {Stroke} */
const STROKE_RAIL    = { ...inkStroke(INK.built, FINE), style: "dash", dash: pen(3), gap: pen(2.5) }

// 1b. Clearances
const OCEAN_SEAM_GROW  = pen(1)
const FRAME_CLIP_INSET = pen(-0.5)
const SIMPLIFY_TOL     = pen(0.2)
const MASS_MIN_RING    = pen(12)    // building masses with a shorter outline (≈1.5 mm square) are left out

// 1c. Roads: paper widths by class, so streets read the same at any scale.
// Service roads and paths are left out: only the street grid speaks.
/** OpenMapTiles carriageway classes (`minor` is residential/unclassified). */
const VEHICLE_ROADS = "transportation:motorway,trunk,primary,secondary,tertiary,minor"
/** @type {Omit<RoadOptions, "from">} */
const ROAD_OPTIONS = {
  widthMode: "paper",
  useWidthTag: false,
  multiplyByLanes: false,
  centerlineMinWidth: { paper: 1000 },   // never: slabs carry no centre lines
  jointClose: { paper: 0.4 },
  classes: {
    motorway:       pen(6.3),     // 7 lines
    motorway_link:  pen(2.7),
    trunk:          pen(5.4),     // 6 lines
    trunk_link:     pen(2.7),
    primary:        pen(4.5),     // 5 lines
    primary_link:   pen(2.7),
    secondary:      pen(3.6),     // 4 lines
    secondary_link: pen(2.7),
    tertiary:       pen(2.7),     // 3 lines
    tertiary_link:  pen(1.8),
    default:        pen(1.8),     // residential: 2 lines
  },
}

// 1d. Fills
/**
 * Streets: offset rings from every edge, in the fine nib, 0.45 mm apart: each
 * pass sits just clear of the next (0.2 mm of paper between), never on it.
 */
/** @type {Omit<FillOptions, "in">} */
const FILL_STREETS   = { pattern: "offsets", spacing: pen(0.9) }
/** Water: swells in the fine nib, fraying into broken strokes toward the shore. */
/** @type {Omit<FillOptions, "in">} */
const FILL_WATER     = { pattern: "swells", spacing: pen(1.6), fray: pen(10) }
/** Buildings: a dot grid inside every mass, clear of its outline. */
/** @type {Omit<FillOptions, "in">} */
const FILL_BUILDINGS = { pattern: "dots", lattice: "square", spacing: pen(2.4), mark: pen(0.1), angle: 0, inset: pen(1.2) }
/** Trees: dendritic growth, one nib per branch. */
/** @type {Omit<FillOptions, "in">} */
const FILL_TREES     = {
  pattern: "growth", seed: 11,
  spacing: metres(9),          // twigs ~9 m apart: open crowns, paper between the branches
  root_spacing: metres(28),    // one tree per ~28 m: crowns at their real size, as in City grain
  line_width: FINE, trunk: 1, variation: 0.6, jitter: 0.12, inset: metres(1.5),
}
/** Trees are left out once a crown would be under 1.6 mm on paper (past about 1:17500). */
const SHOW_TREES = metres(28) >= 1.6

// 1e. Ground relief (burin, stippled): the slopes as dots instead of lines —
// denser where the ground is darker, none on the flat. Spaced wide for the
// broad nib so steep slopes stay dots and do not fuse into blots.
const BURIN_NATURE_STYLE = {
  space_light: 14,
  space_dark: 5,
  space_steep: 0.4,
  dash_cutoff: 0.08,
  mod_jitter: 0.6,
}
/** Where trees grow: woods, scrub, and parks and gardens. The stipple runs under them. */
/** @type {TilePreset[]} */
const TREE_TILES = [
  "forest", "landuse:forest", "landcover:grass/scrub,shrubbery,garden",
  "landcover:park,recreation_ground,village_green", "landuse:cemetery",
]

// 1f. Labels: one heavy, semi-condensed display face (a Google font) for
// every name, outlined and inked solid (zigzag) in the fine nib. Districts big; street
// and park names smaller, with a tighter margin.
/** @type {LabelFont} */
const LABEL_FONT     = { origin: "google", family: "Saira Semi Condensed", weight: 800 }
const LABEL_BIG      = pen(10)     // 5 mm district names
const LABEL_SMALL    = pen(5.2)    // 2.6 mm: the smallest at which both edges of a stem stay apart
const CLEAR_BIG      = pen(3.2)    // paper kept clear round district letters (1.6 mm)
const CLEAR_SMALL    = pen(1.2)    // and round street and park names (0.6 mm)
/** Letters inked solid: a zigzag packed tighter than the fine nib, inside each outline. */
/** @type {Omit<FillOptions, "in">} */
const FILL_LETTERS   = { pattern: "zigzag", spacing: pen(0.4), angle: 45 }
/** @type {LabelRule[]} */
const LABEL_RULES = [
  { id: "district", tags: { "tiles:layer": "place" }, size: LABEL_BIG, minSize: LABEL_BIG },
  { id: "park",     tags: { "tiles:layer": "park" },  size: LABEL_SMALL, minSize: LABEL_SMALL },
  { id: "street",   tags: { "tiles:layer": "transportation_name" }, size: LABEL_SMALL, minSize: LABEL_SMALL },
]

// ═══════════════════════════════════════════════════════════════════════════
// 2. FEATURE EXTRACTION & GEOMETRY PIPELINE
// ═══════════════════════════════════════════════════════════════════════════
const frame = engine.frame()
const roads = modules.roads({ from: features.tiles(VEHICLE_ROADS), ...ROAD_OPTIONS })
// Mainline track only: yards, sidings and spurs (`service` set) would pile
// dozens of parallel dashes into one black bar.
const rails = lines.of(features.where(features.tiles("transportation:rail/rail"), { service: false }))
// Touching buildings fuse into one mass; only its outline is drawn.
const buildings = areas.union(areas.polygons(features.tiles("buildings")))

const ocean = areas.extendToFrame(
  areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), OCEAN_SEAM_GROW),
  frame,
)
const water = areas.union(areas.polygons(features.tiles("water:lake,river,pond,dock,reservoir")), ocean)
const streams = lines.clip(lines.of(features.tiles("waterway:river,canal,stream")), water, { invert: true })

const trees = areas.difference(areas.polygons(features.tiles(...TREE_TILES)), roads.area, buildings, water)
// All open land gets the stipple, tagged or not: parks, empty lots, yards
// between houses, and under the trees. Only water, buildings and streets stay off it.
const ground = areas.difference(frame, roads.area, buildings, water)
const treeLines = fills.fill({ in: SHOW_TREES ? trees : areas.difference(trees, trees), ...FILL_TREES })
const natureBurin = burin.terrain(
  (b) => b.batch({ angle: 0, draw: "dots", style: BURIN_NATURE_STYLE }),
  { in: ground },
)


const labels = modules.labels({
  from: [
    features.tiles("place:suburb,neighbourhood,quarter,island"),
    features.tiles("parks"),
    features.tiles("transportation_name:trunk,primary,secondary"),   // main roads only: every name cuts a gap in its street
  ],
  font: LABEL_FONT,
  size: LABEL_SMALL,
  minSize: LABEL_SMALL,
  rules: LABEL_RULES,
})
const labelClear = areas.union(
  labels.area,
  areas.buffer(labels.district.lines, CLEAR_BIG),
  areas.buffer(lines.join(labels.park.lines, labels.street.lines), CLEAR_SMALL),
)

// ═══════════════════════════════════════════════════════════════════════════
// 3. DRAW LAYERS
// ═══════════════════════════════════════════════════════════════════════════
const waterDraws = [
  draw({ id: "fill_water",       from: fills.fill({ in: water, ...FILL_WATER }), stroke: STROKE_SEA }),
  draw({ id: "lines_water_ring", from: lines.clip(lines.rings(water), areas.grow(frame, FRAME_CLIP_INSET)), stroke: STROKE_WATER }),
  draw({ id: "lines_streams",    from: streams, stroke: STROKE_WATER }),
]
const treeDraws = [
  draw({ id: "lines_nature_burin", from: natureBurin, stroke: STROKE_NATURE }),
  draw({ id: "fill_trees",       from: treeLines, stroke: STROKE_TREES }),
]
const roadDraws = [
  draw({ id: "fill_streets",     from: fills.fill({ in: roads.area, ...FILL_STREETS }), stroke: STROKE_STREET }),
  draw({ id: "lines_rail",       from: rails, stroke: STROKE_RAIL }),
]
const buildingDraws = [
  draw({ id: "lines_buildings",  from: lines.rings(buildings), stroke: STROKE_SOLID }),
  draw({ id: "fill_buildings",   from: fills.fill({ in: buildings, ...FILL_BUILDINGS }), stroke: STROKE_SOLID }),
]

const labelDraws = [
  draw({ id: "lines_labels_district", from: labels.district.lines, stroke: STROKE_FINE }),
  draw({ id: "lines_labels_small",    from: lines.join(labels.park.lines, labels.street.lines), stroke: STROKE_FINE }),
  draw({ id: "fill_labels",           from: fills.fill({ in: labels.area, ...FILL_LETTERS }), stroke: STROKE_FINE }),
]

// ═══════════════════════════════════════════════════════════════════════════
// 4. OCCLUSION MASKS & LAYER ORDER
// ═══════════════════════════════════════════════════════════════════════════
compose.mask({ name: "mask_roads_over",   from: roads.area, occludes: [...waterDraws, ...treeDraws, ...buildingDraws] })

compose.mask({ name: "mask_clear_labels", from: labelClear, occludes: [...waterDraws, ...treeDraws, ...roadDraws, ...buildingDraws] })

compose.order(
  "lines_labels_district",
  "lines_labels_small",
  "fill_labels",
  "fill_streets",
  "lines_rail",
  "lines_buildings",
  "fill_buildings",
  "lines_water_ring",
  "lines_streams",
  "fill_water",
  "fill_trees",
  "lines_nature_burin",
)

// ═══════════════════════════════════════════════════════════════════════════
// 5. PLOTTER OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════════════
const solid = ["lines_buildings", "lines_water_ring", "lines_streams"]
// Drop tiny masses first, while each outline is still one closed ring.
compose.filter(["lines_buildings"], { minLength: MASS_MIN_RING })
compose.deoverlap(solid, { tolerance: pen(0.8), selfOverlap: true, acrossLayers: true })
compose.linemerge(solid, pen(1))
compose.filter(["lines_buildings"], { minLength: pen(4) })   // then the scraps the street slabs leave
compose.simplify([...solid, "fill_streets", "lines_rail"], SIMPLIFY_TOL)
compose.linesort({ except: ["lines_labels_district", "lines_labels_small", "fill_labels"] })
