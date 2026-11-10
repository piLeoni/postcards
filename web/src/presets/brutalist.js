title("Béton brut")
output({
  width: "10in",
  height: "10in",
  scale: "1:20000",   // terrain 3.16 × 3.16 mi
  bearing: 108,
  projection: "webmercator",
  lat: -15.7952107,
  lng: -47.878224,
  tileZoom: 13,
  slices: { columns: 2, rows: 2, gutter: "0.1in" },
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
/**
 * The one nib every line is drawn with. A line that must read heavier is not
 * widened: it is drawn again beside itself, one nib away, until the passes
 * touch and read solid (roads, the shore, building outlines, streams).
 */
const NIB = pen(0.5)
/** Kept for the lengths written in it: the nib, as everywhere else. */
const FINE = NIB
/** @param {string | null} color @returns {Exclude<Stroke, string>} */
const inkStroke = (color) => ({ style: "solid", ...(color ? { color } : {}), width: NIB, cap: "round", join: "round" })

/** @type {Stroke} */
const STROKE_SOLID   = inkStroke(INK.built)
/** @type {Stroke} */
const STROKE_STREET  = inkStroke(INK.street)
/** @type {Stroke} */
const STROKE_WATER   = inkStroke(INK.water)
/** @type {Stroke} */
const STROKE_SEA     = inkStroke(INK.water)
/** @type {Stroke} */
const STROKE_NATURE  = inkStroke(INK.nature)
/** @type {Stroke} */
const STROKE_TREES   = inkStroke(INK.nature)
/** @type {Stroke} */
const STROKE_FINE    = inkStroke(INK.built)
/** @type {Stroke} */
/** Rail: fine dashes, so a bundle of tracks stays grey, not a black bar. */
/** @type {Stroke} */
const STROKE_RAIL    = { ...inkStroke(INK.built), style: "dash", dash: pen(3), gap: pen(2.5) }

// 1b. Clearances
const OCEAN_SEAM_GROW  = pen(1)
const FRAME_CLIP_INSET = pen(-0.5)
const SIMPLIFY_TOL     = pen(0.2)
/**
 * Streets: a bar's passes must stay parallel, so they are only cleaned of
 * true duplicates and specks — any looser and neighbouring passes are taken
 * for one another, or bend apart.
 */
const ROAD_TOL         = 0.05   // also the shore's double line and the solid building masses
/** Building masses are opened by this much (shrunk, then grown back): slivers and specks under twice it go, corners square up. */
const MASS_OPEN        = 0.3

// 1c. Roads, as a diagram: three measures, nothing else, each a black bar
// made of passes of the nib laid side by side — one pass, three or five.
// Each class is first merged into one strip (so the carriageways of a divided
// road, the slip lanes beside it, become one band) and the bar runs down its
// middle. Ramps, service roads and paths are left out; a lower class stops at
// the edge of a higher one.
// Local streets (`minor`) only at town scales: past 1:20000 they are a
// texture, not a diagram.
const LOCAL_STREETS = engine.scale() <= 20000
const ROAD_CLASSES = [
  { id: "triple", tiles: "transportation:motorway,trunk",    merge: 2.4, passes: 5 },
  { id: "double", tiles: "transportation:primary,secondary", merge: 1.4, passes: 3 },
  { id: "single", tiles: LOCAL_STREETS ? "transportation:tertiary,minor" : "transportation:tertiary", merge: 0.8, passes: 1 },
]
/** Passes of a bar this far apart, a little under the nib, so they overlap and read solid. */
const PASS_STEP = NIB * 0.85
/** How far a merged strip shrinks to leave its middle: all but a hair of each side. */
const CORE_HAIR = 0.04
/** Paper kept clear round each road bar, for the dots and trees. */
const ROAD_CLEAR = pen(0.6)

// 1d. Fills
/** Water: swells in the fine nib, fraying into broken strokes toward the shore. */
/** @type {Omit<FillOptions, "in">} */
const FILL_WATER     = { pattern: "swells", spacing: pen(1.6), fray: pen(10) }
/** Buildings: solid black, as the roads — rings in from every edge, courtyards too, a little under a nib apart. */
/** @type {Omit<FillOptions, "in">} */
const FILL_BUILDINGS = { pattern: "offsets", spacing: PASS_STEP }
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

// 1f. Labels: one semi-condensed display face (a Google font) for every
// name, outlined and inked solid (zigzag) in the fine nib, its counters left
// open. Districts big; street and park names smaller, with a tighter margin.
/** @type {LabelFont} */
const LABEL_FONT     = { origin: "google", family: "Saira Semi Condensed", weight: 500 }
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
// Each class: the middle of its merged strip, stopping at the bars above
// it, and passes of the nib either side of that middle.
const roadClasses = []
for (const c of ROAD_CLASSES) {
  const centre = lines.of(features.where(features.tiles(c.tiles), { ramp: false }))
  const whole = areas.buffer(centre, `${c.merge / 2}mm`)
  const middle = lines.rings(areas.grow(whole, `-${c.merge / 2 - CORE_HAIR}mm`))
  const above = roadClasses.map((r) => r.bar)
  const core = above.length ? lines.clip(middle, areas.union(...above), { invert: true }) : middle
  const sides = Array.from({ length: (c.passes - 1) / 2 }, (_, k) => lines.rings(areas.buffer(core, `${(k + 1) * PASS_STEP}mm`)))
  const bar = areas.buffer(core, `${((c.passes - 1) / 2) * PASS_STEP + NIB / 2}mm`)
  roadClasses.push({ ...c, bar, strokes: lines.join(core, ...sides) })
}
const roadArea = areas.union(...roadClasses.map((r) => areas.grow(r.bar, ROAD_CLEAR)))
// Mainline track only: yards, sidings and spurs (`service` set) would pile
// dozens of parallel dashes into one black bar.
const rails = lines.of(features.where(features.tiles("transportation:rail/rail"), { service: false }))
// Touching buildings fuse into one mass; only its outline is drawn.
// Opened (shrunk, grown back): slivers and specks go, corners square up.
const buildings = areas.grow(areas.grow(areas.union(areas.polygons(features.tiles("buildings"))), `-${MASS_OPEN}mm`), `${MASS_OPEN}mm`)

const ocean = areas.extendToFrame(
  areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), OCEAN_SEAM_GROW),
  frame,
)
const water = areas.union(areas.polygons(features.tiles("water:lake,river,pond,dock,reservoir")), ocean)
// The shore and the building outlines are two passes: the edge, and the
// edge one nib inside.
const shore = lines.join(lines.rings(water), lines.rings(areas.grow(water, `-${PASS_STEP}mm`)))
const streams = lines.clip(lines.of(features.tiles("waterway:river,canal,stream")), water, { invert: true })

const trees = areas.difference(areas.polygons(features.tiles(...TREE_TILES)), roadArea, buildings, water)
// All open land gets the stipple, tagged or not: parks, empty lots, yards
// between houses, and under the trees. Only water, buildings and streets stay off it.
const ground = areas.difference(frame, roadArea, buildings, water)
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
// The letters to ink, counters open: each rule's own area (the labels' whole
// `area` closes the counters, for masks).
const labelLetters = areas.union(labels.district.area, labels.park.area, labels.street.area)
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
  draw({ id: "lines_water_ring", from: lines.clip(shore, areas.grow(frame, FRAME_CLIP_INSET)), stroke: STROKE_WATER }),
  draw({ id: "lines_streams",    from: lines.rings(areas.buffer(streams, `${PASS_STEP / 2}mm`)), stroke: STROKE_WATER }),
]
const treeDraws = [
  draw({ id: "lines_nature_burin", from: natureBurin, stroke: STROKE_NATURE }),
  draw({ id: "fill_trees",       from: treeLines, stroke: STROKE_TREES }),
]
const roadDraws = [
  ...roadClasses.map((r) => draw({ id: `lines_road_${r.id}`, from: r.strokes, stroke: STROKE_STREET })),
  draw({ id: "lines_rail",       from: rails, stroke: STROKE_RAIL }),
]
const buildingDraws = [
  draw({ id: "lines_buildings",  from: lines.rings(buildings), stroke: STROKE_SOLID }),
  draw({ id: "fill_buildings",   from: fills.fill({ in: buildings, ...FILL_BUILDINGS }), stroke: STROKE_SOLID }),
]

const labelDraws = [
  draw({ id: "lines_labels_district", from: labels.district.lines, stroke: STROKE_FINE }),
  draw({ id: "lines_labels_small",    from: lines.join(labels.park.lines, labels.street.lines), stroke: STROKE_FINE }),
  draw({ id: "fill_labels",           from: fills.fill({ in: labelLetters, ...FILL_LETTERS }), stroke: STROKE_FINE }),
]

// ═══════════════════════════════════════════════════════════════════════════
// 4. OCCLUSION MASKS & LAYER ORDER
// ═══════════════════════════════════════════════════════════════════════════
compose.mask({ name: "mask_roads_over",   from: roadArea, occludes: [...waterDraws, ...treeDraws, ...buildingDraws] })

compose.mask({ name: "mask_clear_labels", from: labelClear, occludes: [...waterDraws, ...treeDraws, ...roadDraws, ...buildingDraws] })

compose.order(
  "lines_labels_district",
  "lines_labels_small",
  "fill_labels",
  ...roadDraws,
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
// Doubled lines (the shore) and solid masses are passes a little under a
// nib apart: only true duplicates go.
compose.deoverlap(solid, { tolerance: ROAD_TOL, selfOverlap: true, acrossLayers: true })
compose.linemerge(solid, ROAD_TOL)
// A core is a ring round a hair-thin strip: two strokes on top of each other,
// one is enough.
const roadIds = roadDraws.filter((id) => id !== "lines_rail")
compose.deoverlap(roadIds, { tolerance: ROAD_TOL, selfOverlap: true, acrossLayers: true })
compose.linemerge(roadIds, ROAD_TOL)
compose.simplify(["lines_rail"], SIMPLIFY_TOL)
compose.simplify(solid, ROAD_TOL)
compose.simplify(roadIds, ROAD_TOL)
compose.filter(roadIds, { minLength: pen(2) })
compose.linesort({ except: ["lines_labels_district", "lines_labels_small", "fill_labels"] })
