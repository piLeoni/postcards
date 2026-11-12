title("Karl the Fog")
output({
  width: "24in",
  height: "6in",
  scale: "1:10000",   // terrain 3.79 × 0.947 mi
  bearing: -3,
  projection: "webmercator",
  lat: 37.7687541,
  lng: -122.483286,
  tileZoom: 14,
  padding: "0.1in",
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. PARAMETERS & STYLE PALETTE (All visual knobs in one place)
// ═══════════════════════════════════════════════════════════════════════════
/** Master pen nib width (mm). Every paper length below is `pen(k)` = k × PEN. */
const PEN = 0.2
/**
 * Paper length in mm (numeric `Length` / `RoadMeasure`).
 * @param {number} k
 * @returns {number}
 */
const pen = (k) => PEN * k
/**
 * Metres on the ground as millimetres on this output's paper, so things that
 * have a real size (a tree's crown) keep it at every scale.
 * @param {number} m
 * @returns {number}
 */
const ground = (m) => (m * 1000) / engine.scale()
/** @param {Exclude<Stroke, string>} stroke @returns {Stroke} */
const penStroke = (stroke) => /** @type {Stroke} */ ({ ...stroke, width: pen(1), cap: "round" })

// 1a. Line & Stroke Styles
// Solid lines are reserved strictly for hard physical edges (buildings, road
// carriageways, runways, water shoreline, piers). Facilities & soft boundaries
// use `STROKE_DOTTED_RING`.
/** @type {Stroke} */
const STROKE_SOLID         = penStroke({ style: "solid" })
/** @type {Stroke} */
const STROKE_DOTTED_RING   = penStroke({ style: "dotted", mark: pen(1.5), gap: pen(6.5) })
/** @type {Stroke} */
const STROKE_GARDEN_PATH   = penStroke({ style: "dotted", mark: pen(1.75), gap: pen(2.5) })
/** @type {Stroke} */
const STROKE_ROAD_CENTER   = penStroke({ style: "dash",   dash: pen(1.75), gap: pen(4) })
/** @type {Stroke} */
const STROKE_RAIL          = penStroke({ style: "dash",   dash: pen(4), gap: pen(2.5) })
/** @type {Stroke} */
const STROKE_RUNWAY_CENTER = penStroke({ style: "dash",   dash: pen(6), gap: pen(4.5) })
/** @type {Stroke} */
const STROKE_AERIALWAY     = penStroke({ style: "dash",   dash: pen(3), gap: pen(2.5) })
/** @type {Stroke} */
const STROKE_FERRY         = penStroke({ style: "dash",   dash: pen(2.25), gap: pen(2) })

// 1b. Geometry Buffers & Clearances
const OCEAN_SEAM_GROW  = pen(1.75)
const FRAME_CLIP_INSET = pen(-1.25)
const RUNWAY_HALF_W    = pen(10)
const TAXIWAY_HALF_W   = pen(3.25)
const PIER_HALF_W      = pen(1.25)
const FERRY_CLEAR_W    = pen(1.75)
const TRAIL_CLEAR_W    = pen(2.25)
const LABEL_CLEAR_W    = pen(4.5)   // paper kept clear around every name
const NATURE_MERGE_GAP = pen(0.75)
const NATURE_RING_CLIP = pen(-0.25)
const SIMPLIFY_TOL     = pen(0.15)
const FILTER_MIN_LEN   = pen(1.25)   // urban outlines only (buildings/roads); never on trees, gardens, or dotted routes
const FILL_ORIENT      = "tl-br"    // preferred stroke direction for fills to prevent pen skipping on reversals

// 1c. Road Widths, Lanes & Mask Clearances (`modules.roads`)
// - `widthMode`: "ground" (metres on earth, scaled by `output.scale`) or "paper" (mm on sheet)
// - Individual entries can also use `{ ground: m }` or `{ paper: mm }` to mix both
// - `multiplyByLanes`: multiplies each class's width by lane count (`lanes` tag or class `lanes`)
// - `singleLine: true`: drawn as a single stroke on `roads.trails` / `roads.rails` with mask `clearance`
// - Centre dashes: engine emits them only when total carriageway width ≥ `centerlineMinWidth`
//   (lanes × per-lane ground × `widthMultiplier`, plus OSM width tags). `centerline: true`
//   would force dashes even on narrow bits — avoid it. `centerline: false` on minor classes
//   blocks dashes even when OSM width is large. Arterials use `ARTERIAL_WIDTH` so real
//   boulevards clear the threshold; skinny links stay outline-only.
const CENTERLINE_MIN_GROUND_M = 11.0
const ARTERIAL_WIDTH = 1.5
const arterialLane = (groundM, lanes) => ({ ground: groundM * ARTERIAL_WIDTH, lanes })
/** @type {Omit<RoadOptions, "from">} */
const ROAD_OPTIONS = {
  widthMode: "ground",
  widthMultiplier: 1.65,
  useWidthTag: true,
  multiplyByLanes: true,
  inferLanesByClass: true,
  centerlineMinWidth: { ground: CENTERLINE_MIN_GROUND_M },
  jointClose: { ground: 3.0 },
  clearance: pen(5),
  classes: {
    motorway:       arterialLane(3.75, 4),
    motorway_link:  { ground: 4.5,  lanes: 1, centerline: false },
    trunk:          arterialLane(3.5, 4),
    trunk_link:     { ground: 4.5,  lanes: 1, centerline: false },
    primary:        arterialLane(3.5, 2),
    primary_link:   { ground: 4.0,  lanes: 1, centerline: false },
    secondary:      arterialLane(3.0, 2),
    secondary_link: { ground: 3.5,  lanes: 1, centerline: false },
    tertiary:       { ground: 3.0,  lanes: 2, centerline: false },
    tertiary_link:  { ground: 3.5,  lanes: 1, centerline: false },
    residential:    { ground: 2.5,  lanes: 2, centerline: false },
    unclassified:   { ground: 2.5,  lanes: 2, centerline: false },
    living_street:  { ground: 4.0,  lanes: 1, centerline: false },
    service:        { ground: 3.0,  lanes: 1, centerline: false },
    pedestrian:     { ground: 4.0,  lanes: 1, centerline: false },
    default:        { ground: 3.0,  lanes: 2, centerline: false },
    track:          { singleLine: true, clearance: { ground: 1.0 } },
    footway:        { singleLine: true, clearance: { ground: 1.0 } },
    path:           { singleLine: true, clearance: { ground: 1.0 } },
    steps:          { singleLine: true, clearance: { ground: 1.0 } },
    bridleway:      { singleLine: true, clearance: { ground: 1.0 } },
    cycleway:       { singleLine: true, clearance: { ground: 1.0 } },
    rail:           { singleLine: true, clearance: { ground: 5.0 } },
  },
}

// 1d. Surface Fill Patterns
// Note: no `inset` on nature/garden/court fills so adjacent patches (e.g.
// garden beds inside a park) meet seamlessly without a white exclusion halo.
/** @type {FillStyle} */
const FILL_BUILDINGS = { per: "feature", pattern: "lines", inset: pen(1.3), spacing: pen(2.5), angle: 45 }
/** @type {FillStyle} */
const FILL_WATER     = { pattern: "waves", spacing: pen(3.75) }
/** @type {FillStyle} */
const FILL_DOTS      = { pattern: "dots", spacing: pen(3.75), mark: pen(1.1), angle: 30 }
/** @type {FillStyle} */
const FILL_LAWN      = { ...FILL_DOTS, spacing: pen(3) }
/** @type {FillStyle} */
const FILL_FLOWERBED = { ...FILL_DOTS, spacing: pen(2.25) }
/** @type {FillStyle} */
const FILL_STIPPLE   = { ...FILL_DOTS, pattern: "stipple", density: "edge", contrast: 0.9, feature: "8mm" }
/** @type {FillStyle} */
const FILL_COURT     = { pattern: "dots", arrange: "square", spacing: pen(2.75), mark: pen(1), angle: 0 }
/** @type {FillStyle} */
const FILL_TRACK     = { ...FILL_COURT, spacing: pen(2.25) }

// 1e. 3D Foliage Canopy Tiers (`pattern: "isoline-stack"`, penfill isoline_stack)
// Requires current penfill in `../penfill` — after penfill changes run `npm run wasm` from `web/`.
// Shape knobs (shared — CANOPY_BASE):
//   jitter          displacement intensity along each contour (default 1.1)
//   jitter_period   how many points jitter per ring — lower = finer teeth (default 0.68)
//   lobes           bough clefts / compound lobes (0–2.5)
//   elongation      wind-swept oval crowns (0–1)
//   ticks           cross-contour slope ticks at clefts & shadow tiers (0–1.5)
//   light           sun strength; light_angle / light_elevation aim the sun
//   bubble          leaf-tuft scale in mm (omit → ~0.3× crown)
// Distribution (per tier — spacing, coverage, slices):
//   spacing    a crown's diameter, on the ground (`ground(m)`), so crowns keep
//              their real size at any scale
//   coverage   grove density (0–1); lower → more clearings
//   slices     vertical tiers per crown (default 9)
//   edge/overflow  dense forest: overflow bulge past polygon edge
/** @type {FillStyle} */
const CANOPY_BASE = {
  pattern: "isoline-stack",
  seed: 7,
  jitter: 1.1,
  jitter_period: 0.68,
  ticks: 0.42,
  light: 0.82,
  light_angle: 225,
  light_elevation: 38,
  edge: "inside",
  lobes: 1.0,
  elongation: 0.18,
  spacing: ground(60),
  slices: 9,
}
// Short period + high intensity (penfill `isoline_blobs_demo` panel 3C).
/** @type {FillStyle} */
const CANOPY_SHORT_PERIOD = {
  ...CANOPY_BASE,
  seed: 27,
  jitter: 1.55,
  jitter_period: 0.45,
  lobes: 0.85,
  elongation: 0.14,
  slices: 10,
  coverage: 0.62,
  // bubble ≈ 0.19× crown (demo: 1.15 mm @ 6.0 mm crown); scales with `spacing` below.
  bubble: ground(5.8),
}
/** @type {FillStyle} */
const CANOPY_DENSE_SPEC = {
  ...CANOPY_SHORT_PERIOD,
  edge: "overflow",
  overflow: ground(3.4),
  spacing: ground(60),
  coverage: 0.82,
  bubble: ground(5.8),
}
/** @type {FillStyle} */
const CANOPY_PARK_SPEC = {
  ...CANOPY_BASE,
  spacing: ground(50),
  coverage: 0.58,
  jitter_period: 0.78,
  ticks: 0.32,
}
/** @type {FillStyle} */
const CANOPY_SHRUB_SPEC = {
  ...CANOPY_BASE,
  spacing: ground(40),
  coverage: 0.52,
  slices: 7,
  jitter_period: 0.85,
  lobes: 0.85,
  ticks: 0.28,
}

// 1f. Terrain Slope Hatching (Burin)
const BURIN_URBAN_FADE = {
  outside: "urban",
  mask_start_m: 0,
  mask_reach_m: 100,
  mask_fade: 0.2,
  mask_fray_m: 40,
}
const BURIN_GROUND_STYLE = {
  dash_light: 0.1,
  dash_dark: 1,
  mod_jitter: 1,
  mod_flat: 0.5,
  dash_cutoff: 0.05,
}
const BURIN_NATURE_STYLE = {
  ...BURIN_GROUND_STYLE,
  space_light: 12,
  space_dark: 10,
}

// 1g. Typography & Label Rules (draw.land monoline `futural` only; one cap height)
const LABEL_SIZE = pen(11)
/** @type {LabelRule[]} */
const LABEL_RULES = [
  { id: "park",      tags: { "tiles:layer": "park" } },
  { id: "aerodrome", tags: { "tiles:layer": "aerodrome_label" } },
  { id: "place",     tags: { "tiles:layer": "place" } },
  { id: "poi",       tags: { "tiles:layer": "poi" } },
  { id: "major",     tags: { class: ["motorway", "trunk", "primary"] } },
  { id: "street",    tags: { "tiles:layer": "transportation_name" } },
]

// 1h. Landcover, Parks & Recreation Taxonomy Table (Ordered Bottom to Top)
// Complete taxonomy of OpenMapTiles `park`, `landcover` (all 7 classes, 38
// subclasses), and non-paved `landuse`. Where polygons overlap, higher rows
// carve out of lower rows so surface fills never double-stack.
// - `relief`: `true` runs slope burin underneath the surface pattern
// - `canopy`: `"dense"` | `"scattered"` | `"shrub"` | `"open"` (clears park trees) | `false`
// - `ring`:   `true` outlines the feature with `STROKE_DOTTED_RING`
/**
 * @type {Array<{
 *   id: string
 *   tiles: TilePreset | TilePreset[]
 *   relief: boolean
 *   canopy: "dense" | "scattered" | "shrub" | "open" | false
 *   ring?: boolean
 *   fill: FillStyle
 *   area?: Area
 *   visible?: Area
 * }>}
 */
const NATURE = [
  // Broad park & reserve boundaries (bottom of stack so inner features cut them)
  { id: "protected",  tiles: ["parks"],                                                       relief: true,  canopy: false,       fill: FILL_DOTS },
  { id: "park",       tiles: ["landcover:park,recreation_ground,village_green",
                              "landuse:cemetery,zoo,theme_park"],                             relief: true,  canopy: "scattered", fill: FILL_DOTS },

  // Agriculture
  { id: "farmland",   tiles: ["landcover:farmland/farmland,farm,vineyard,plant_nursery"],     relief: true,  canopy: "open",      fill: FILL_DOTS },
  { id: "orchard",    tiles: ["landcover:farmland/orchard"],                                  relief: true,  canopy: "dense",     fill: FILL_DOTS },

  // Bare / wet / mineral surfaces
  { id: "ice",        tiles: ["glacier"],                                                     relief: true,  canopy: "open",      fill: FILL_DOTS },
  { id: "wetland",    tiles: ["wetland"],                                                     relief: false, canopy: "open",      fill: FILL_DOTS },
  { id: "quarry",     tiles: ["landuse:quarry"],                                              relief: true,  canopy: "open",      fill: FILL_STIPPLE },
  { id: "sand",       tiles: ["sand"],                                                        relief: false, canopy: "open",      fill: FILL_STIPPLE },
  { id: "bare_rock",  tiles: ["rock"],                                                        relief: true,  canopy: false,       fill: FILL_DOTS },

  // Woods & wild vegetation
  { id: "wood",       tiles: ["forest", "landuse:forest"],                                    relief: true,  canopy: "dense",     fill: FILL_DOTS },
  { id: "heath",      tiles: ["landcover:grass/heath,fell,tundra"],                           relief: true,  canopy: false,       fill: FILL_DOTS },
  { id: "scrub",      tiles: ["landcover:grass/scrub,shrubbery"],                             relief: true,  canopy: "shrub",     fill: FILL_DOTS },

  // Open turf, lawns & planted beds (`"open"` lawns clear park trees)
  { id: "golf",       tiles: ["landcover:grass/golf_course"],                                 relief: true,  canopy: "open",      fill: FILL_DOTS },
  { id: "grass",      tiles: ["landcover:grass/grass,meadow,grassland"],                      relief: false, canopy: "open",      fill: FILL_LAWN },
  { id: "garden",     tiles: ["landcover:grass/garden,allotments"],                           relief: false, canopy: "shrub",     fill: FILL_LAWN },
  { id: "flowerbed",  tiles: ["landcover:grass/flowerbed"],                                   relief: false, canopy: false,       fill: FILL_FLOWERBED },

  // Sports fields, tracks & playgrounds (dotted ring; set `ring: false` to omit)
  { id: "playground", tiles: ["landuse:playground"],                                          relief: false, canopy: "open",      ring: true, fill: FILL_COURT },
  { id: "track",      tiles: ["landuse:track"],                                               relief: false, canopy: "open",      ring: true, fill: FILL_TRACK },
  { id: "pitch",      tiles: ["landuse:pitch"],                                               relief: false, canopy: "open",      ring: true, fill: FILL_COURT },
]

/** @param {typeof NATURE[number]} k @returns {Area} */
const natureArea = (k) => {
  const a = k.area
  if (!a) throw new Error(`nature.${k.id}: missing area`)
  return a
}
/** @param {typeof NATURE[number]} k @returns {Area} */
const natureVisible = (k) => {
  const v = k.visible
  if (!v) throw new Error(`nature.${k.id}: missing visible`)
  return v
}

// Built-up / paved `landuse` classes (stay white paper; ground burin eases out before them)
const PAVED_LANDUSE_TILES =
  "landuse:residential,commercial,industrial,retail,garages,railway,bus_station,military,school,university,kindergarten,college,library,hospital,stadium,dam,parking"

// ═══════════════════════════════════════════════════════════════════════════
// 2. FEATURE EXTRACTION & GEOMETRY PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

// 2a. Frame, Roads, Transit, Aeroway, Buildings & Urban Mask
const frame = engine.frame()
// Mainline rail only (`transportation:rail/rail`); omit `transit`/tram/light_rail from the `rail` preset.
const roads = modules.roads({ from: features.tiles("roads", "transportation:rail/rail"), ...ROAD_OPTIONS })
const buildings = areas.polygons(features.tiles("buildings"))
const aerialways = lines.of(features.tiles("transportation:aerialway"))

const runwayLines = lines.of(features.tiles("aeroway:runway"))
const runways = areas.union(
  areas.polygons(features.tiles("aeroway:runway")),
  areas.buffer(runwayLines, RUNWAY_HALF_W, { cap: "flat" }),
)
const taxiwayLines = lines.of(features.tiles("aeroway:taxiway"))
const taxiways = areas.union(
  areas.polygons(features.tiles("aeroway:taxiway")),
  areas.buffer(taxiwayLines, TAXIWAY_HALF_W),
)
const aprons = areas.polygons(features.tiles("aeroway:apron,helipad"))
const aerowayStrips = areas.union(runways, taxiways)
const aerowayPaved = areas.union(aerowayStrips, aprons)
const aerodromes = areas.polygons(features.tiles("aeroway:aerodrome,heliport"))
const pavedLanduse = areas.polygons(features.tiles(PAVED_LANDUSE_TILES))
const urban = areas.union(pavedLanduse, aerodromes, aerowayPaved, buildings, roads.area)

// 2b. Water, Waterways & Maritime
const ocean = areas.extendToFrame(
  areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), OCEAN_SEAM_GROW),
  frame,
)
const docks = areas.polygons(features.tiles("water:dock"))
const water = areas.union(
  areas.polygons(features.tiles("water:lake,river,pond,dock,swimming_pool")),
  ocean,
)
const streams = lines.clip(
  lines.of(features.tiles("waterway:river,canal,stream,drain,ditch")),
  water,
  { invert: true },
)
const pierPads = areas.union(
  areas.polygons(features.tiles("transportation:pier")),
  areas.buffer(lines.of(features.tiles("transportation:pier")), PIER_HALF_W),
)
const piersOnWater = areas.intersect(pierPads, water)
const ferryRoutes = lines.clip(lines.of(features.tiles("transportation:ferry")), water)
const ferryCorridor = areas.intersect(areas.buffer(ferryRoutes, FERRY_CLEAR_W), water)

// 2c. Nature Stack Resolution (Top-down subtraction so fills never overlap)
// Morphological close (`grow` then shrink by `NATURE_MERGE_GAP`) fuses adjacent
// patches of the same landcover/garden class so narrow gaps don't split them.
for (const kind of NATURE) {
  const selectors = Array.isArray(kind.tiles) ? kind.tiles : [kind.tiles]
  const raw = areas.polygons(features.tiles(...selectors))
  kind.area = areas.grow(areas.grow(raw, NATURE_MERGE_GAP), -NATURE_MERGE_GAP)
}
let covered = areas.union(water, aerowayPaved)
for (const kind of [...NATURE].reverse()) {
  kind.visible = areas.difference(natureArea(kind), covered)
  covered = areas.union(covered, natureArea(kind))
}
const nature = areas.difference(covered, water, aerowayPaved)
const openGround = areas.difference(frame, covered)
const facilityRingArea = areas.union(...NATURE.filter((k) => k.ring).map(natureVisible))
const ridgeLines = lines.of(features.tiles("mountain_peak:cliff,ridge,arete"))

// Park paths only: clipped strictly to true municipal parks (`landcover:park,recreation_ground,village_green`)
// and gardens, NOT `"parks"` (`park:protected_area` covers the entire UNESCO Seine riverbanks in Paris!).
const parkFootprint = areas.polygons(
  features.tiles("landcover:park,recreation_ground,village_green,garden"),
)
const trailLines = lines.clip(lines.of(features.tiles("paths")), parkFootprint)
const trailClear = areas.buffer(trailLines, TRAIL_CLEAR_W)

// 2d. Terrain Hatching & 3D Foliage Regions
const noRelief = areas.union(...NATURE.filter((k) => !k.relief).map(natureArea))
const reliefArea = areas.difference(
  areas.union(...NATURE.filter((k) => k.relief).map(natureArea)),
  noRelief,
)
const groundBurin = burin.terrain(
  (b) => b.batch({ angle: 0, ...BURIN_URBAN_FADE, style: BURIN_GROUND_STYLE }),
  { in: openGround, regions: { urban } },
)
const natureBurin = burin.terrain(
  (b) => b.batch({ within: "relief", ...BURIN_URBAN_FADE, style: BURIN_NATURE_STYLE }),
  { in: reliefArea, regions: { relief: reliefArea, urban } },
)

const denseCanopyArea = areas.union(...NATURE.filter((k) => k.canopy === "dense").map(natureVisible))
const openCanopyClear = areas.union(
  water,
  aerowayPaved,
  buildings,
  denseCanopyArea,
  ...NATURE.filter((k) => k.canopy === "open").map(natureArea),
)
const scatteredCanopyArea = areas.difference(
  areas.union(...NATURE.filter((k) => k.canopy === "scattered").map(natureArea)),
  openCanopyClear,
)
const shrubCanopyArea = areas.difference(
  areas.union(...NATURE.filter((k) => k.canopy === "shrub").map(natureVisible)),
  buildings,
  aerowayPaved,
)

// Trees are drawn at their real size; once a crown would be under 1.2 mm on
// paper (past about 1:25000) they are left out — the woods keep their dots.
const SHOW_TREES = ground(30) >= 1.2
/** @param {Area} a @returns {Area} */
const ifTrees = (a) => (SHOW_TREES ? a : areas.difference(a, a))
/** @type {FillOptions} */
const FOLIAGE_DENSE = { in: ifTrees(denseCanopyArea),     ...CANOPY_DENSE_SPEC }
/** @type {FillOptions} */
const FOLIAGE_PARK  = { in: ifTrees(scatteredCanopyArea), ...CANOPY_PARK_SPEC }
/** @type {FillOptions} */
const FOLIAGE_SHRUB = { in: ifTrees(shrubCanopyArea),     ...CANOPY_SHRUB_SPEC }

// Closed crown-footprint union from isoline-stack (`fills.cover`); same generator run as the fills.
const canopyCover = areas.union(
  fills.cover(FOLIAGE_DENSE),
  fills.cover(FOLIAGE_PARK),
  fills.cover(FOLIAGE_SHRUB),
)

// 2e. Labels
const labels = modules.labels({
  from: [
    features.tiles("road_names"),
    features.tiles("parks"),
    features.tiles("place:suburb,neighbourhood,quarter,island"),
    features.tiles("poi:attraction,museum,monument,castle,theme_park,viewpoint"),
    features.tiles("aerodrome_label:*"),
  ],
  font: "futural",
  size: LABEL_SIZE,
  minSize: LABEL_SIZE,
  rules: LABEL_RULES,
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. DRAW LAYERS (Grouped by domain)
// ═══════════════════════════════════════════════════════════════════════════
const groundDraws = [
  draw({ id: "lines_ground_burin", from: groundBurin, stroke: STROKE_SOLID }),
  draw({ id: "lines_ridges",       from: ridgeLines,  stroke: STROKE_DOTTED_RING }),
]

const natureFills = NATURE.map((k) =>
  draw({ id: `fill_nature_${k.id}`, from: fills.fill({ in: natureVisible(k), ...k.fill }), stroke: STROKE_SOLID }),
)
const natureDraws = [
  draw({ id: "lines_nature_terrain", from: natureBurin, stroke: STROKE_SOLID }),
  ...natureFills,
  draw({ id: "lines_nature_ring", from: lines.rings(nature), stroke: STROKE_DOTTED_RING }),
  draw({ id: "lines_courts_ring", from: lines.clip(lines.rings(facilityRingArea), areas.grow(nature, NATURE_RING_CLIP)), stroke: STROKE_DOTTED_RING }),
]

const canopyDraws = [
  draw({ id: "fill_wood_foliage",  from: fills.fill(FOLIAGE_DENSE), stroke: STROKE_SOLID }),
  draw({ id: "fill_park_foliage",  from: fills.fill(FOLIAGE_PARK),  stroke: STROKE_SOLID }),
  draw({ id: "fill_shrub_foliage", from: fills.fill(FOLIAGE_SHRUB), stroke: STROKE_SOLID }),
  draw({ id: "lines_canopy_cover", from: lines.rings(canopyCover),   stroke: STROKE_DOTTED_RING }),
]

const pathDraws = [
  draw({ id: "lines_garden_paths", from: trailLines, stroke: STROKE_GARDEN_PATH }),
]

const waterDraws = [
  draw({ id: "lines_water_ring", from: lines.clip(lines.rings(water), areas.grow(frame, FRAME_CLIP_INSET)), stroke: STROKE_SOLID }),
  draw({ id: "lines_streams",    from: streams,                  stroke: STROKE_SOLID }),
  draw({ id: "fill_water",       from: fills.fill({ in: water, ...FILL_WATER }), stroke: STROKE_SOLID }),
  draw({ id: "lines_dock_ring",  from: lines.rings(docks),       stroke: STROKE_SOLID }),
  draw({ id: "lines_piers",      from: lines.rings(pierPads),    stroke: STROKE_SOLID }),
  draw({ id: "lines_ferry",      from: ferryRoutes,              stroke: STROKE_FERRY }),
]

const roadDraws = [
  draw({ id: "lines_apron_ring",     from: lines.rings(areas.difference(aprons, aerowayStrips)), stroke: STROKE_DOTTED_RING }),
  draw({ id: "lines_aeroway",        from: lines.rings(aerowayStrips), stroke: STROKE_SOLID }),
  draw({ id: "lines_runway_center",  from: runwayLines,                stroke: STROKE_RUNWAY_CENTER }),
  draw({ id: "lines_aerialway",      from: aerialways,                 stroke: STROKE_AERIALWAY }),
  draw({ id: "lines_rail",           from: roads.rails,                stroke: STROKE_RAIL }),
  draw({ id: "lines_roads_outlines", from: roads.outlines,             stroke: STROKE_SOLID }),
  draw({ id: "lines_roads_center",   from: roads.centerlines,          stroke: STROKE_ROAD_CENTER }),
  draw({ id: "lines_roads_seams",    from: roads.seams,                stroke: STROKE_SOLID }),
]

const buildingDraws = [
  draw({ id: "fill_buildings",       from: fills.fill({ in: buildings, ...FILL_BUILDINGS }), stroke: STROKE_SOLID }),
  draw({ id: "lines_buildings_ring", from: lines.rings(buildings), stroke: STROKE_SOLID }),
]

draw({ id: "lines_labels", from: labels.lines, stroke: STROKE_SOLID })

// ═══════════════════════════════════════════════════════════════════════════
// 4. OCCLUSION MASKS & LAYER ORDER
// ═══════════════════════════════════════════════════════════════════════════
const underRoads = [...groundDraws, ...natureDraws, ...waterDraws]
const labelClear = areas.union(labels.area, areas.buffer(labels.lines, LABEL_CLEAR_W))

compose.mask({ name: "mask_clear_trails",   from: trailClear,    occludes: ["lines_nature_terrain", ...natureFills] })
compose.mask({ name: "mask_canopy_over",    from: canopyCover,   occludes: [...underRoads, ...pathDraws, ...roadDraws] })
compose.mask({ name: "mask_water_over",     from: water,         occludes: [...groundDraws, ...natureDraws, ...pathDraws] })
compose.mask({ name: "mask_piers_on_water", from: piersOnWater,  occludes: ["fill_water"] })
compose.mask({ name: "mask_ferry_on_water", from: ferryCorridor, occludes: ["fill_water"] })
compose.mask({ name: "mask_aeroway_over",   from: aerowayPaved,  occludes: underRoads })
compose.mask({ name: "mask_roads_over",     from: roads.area,    occludes: [...underRoads, ...buildingDraws] })
compose.mask({ name: "mask_buildings_over", from: buildings,     occludes: [...underRoads, ...canopyDraws] })
compose.mask({
  name: "mask_clear_labels",
  from: labelClear,
  occludes: [...underRoads, ...roadDraws, ...buildingDraws, ...pathDraws, ...canopyDraws],
})

const MAP_ORDER = [
  "lines_labels",
  "lines_water_ring",
  "lines_streams",
  "lines_roads_outlines",
  "lines_rail",
  "lines_aerialway",
  "lines_aeroway",
  "lines_runway_center",
  "lines_apron_ring",
  "lines_roads_seams",
  "lines_roads_center",
  "lines_ferry",
  "lines_dock_ring",
  "lines_garden_paths",
  "lines_courts_ring",
  "lines_nature_ring",
  "lines_nature_terrain",
  "lines_ridges",
  "lines_piers",
  "lines_buildings_ring",
  "lines_ground_burin",
  "fill_buildings",
  "fill_wood_foliage",
  "fill_park_foliage",
  "fill_shrub_foliage",
  "lines_canopy_cover",
  "fill_water",
  ...[...NATURE].reverse().map((k) => `fill_nature_${k.id}`),
]
compose.order(...MAP_ORDER)

// ═══════════════════════════════════════════════════════════════════════════
// 5. PLOTTER OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════════════
// Keep stippled nature, field fills, and dotted rings untouched: overlap
// removal changes their texture/dot spacing. Optimize solid outlines and routes.
const cityLines = [
  "lines_roads_outlines",
  "lines_roads_seams",
  "lines_buildings_ring",
  "fill_wood_foliage",
  "fill_park_foliage",
  "fill_shrub_foliage",
  "lines_aeroway",
  "lines_water_ring",
  "lines_streams",
  "lines_piers",
  "lines_dock_ring",
]
const routeLines = [
  "lines_roads_center",
  "lines_runway_center",
  "lines_rail",
  "lines_aerialway",
  "lines_ferry",
  "lines_garden_paths",
  "lines_nature_ring",
  "lines_canopy_cover",
  "lines_courts_ring",
  "lines_apron_ring",
  "lines_ridges",
]
const cityAndRoutes = [...cityLines, ...routeLines]

const fillLayers = [
  "fill_buildings",
  "fill_water",
  ...canopyDraws,
  ...natureFills,
  "lines_ground_burin",
  "lines_nature_terrain",
]

compose.deoverlap(cityLines, { tolerance: pen(1.2), selfOverlap: true, acrossLayers: true })
compose.linemerge(cityLines, pen(2))
compose.filter(["lines_buildings_ring", "lines_roads_outlines", "lines_roads_seams", "lines_aeroway", "lines_piers", "lines_dock_ring"], { minLength: FILTER_MIN_LEN })
compose.simplify(cityAndRoutes, SIMPLIFY_TOL)
compose.orient(fillLayers, { direction: FILL_ORIENT, splitReversals: true })
compose.linesort({ except: ["lines_labels"] })

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLOUDS
// ═══════════════════════════════════════════════════════════════════════════
// Cumulus over the city, seen from above (penfill `clouds`): puffs heaped on
// a body that rises and falls, stippled where it turns from the sun. What
// they cover clears the map under them; the same footprint, moved down-sun,
// is their shadow, stippled over the city.
/** @type {FillStyle} */
const CLOUDS = {
  pattern: "clouds",
  spacing: pen(25),        // a puff: 5 mm
  cell: pen(220),          // the masses and the clear gaps between them
  coverage: 0.38,
  light_angle: 225,        // the sun, from the top left
  light_elevation: 30,
  seed: 4,
}
/** How far the shadow falls from its cloud, mm: the clouds' height above the ground. */
const SHADOW_DROP = pen(40)
/** @type {FillStyle} */
const FILL_SHADOW = { pattern: "stipple", spacing: pen(2.6), mark: pen(0.6) }

const sky = engine.frame()
const cloudCover = fills.cover({ in: sky, ...CLOUDS })
const sun = (CLOUDS.light_angle * Math.PI) / 180
const cast = areas.move(cloudCover, [-Math.cos(sun) * SHADOW_DROP, -Math.sin(sun) * SHADOW_DROP])
const cloudShadow = areas.difference(areas.intersect(cast, sky), cloudCover)

draw({ id: "cloud_shadow", from: fills.fill({ in: cloudShadow, ...FILL_SHADOW }), stroke: STROKE_SOLID })
draw({ id: "clouds", from: fills.fill({ in: sky, ...CLOUDS }), stroke: STROKE_SOLID })
compose.mask({ name: "mask_under_clouds", from: cloudCover, occludes: MAP_ORDER })
