title("City grain")
output({
  width: "6in",
  height: "4in",
  scale: "1:10000",   // terrain 0.947 × 0.631 mi
  bearing: -4,
  projection: "webmercator",
  lat: 37.7946707,
  lng: -122.4528951,
  tileZoom: 14,
})

const PEN = 0.2

// `isoline-stack`: 3D crowns of metaball spheres, cut into slices that
// overhang each other, lit from one side (`light`, `light_angle`) so the
// canopy reads as lumpy and shaded, not flat dots.
//
// Bottom to top: bare ground (burin), nature (one pattern per kind, burin
// only where the kind has relief), water, roads, buildings, labels.

// ── Base geometry ──────────────────────────────────────────────────────────
const frame = engine.frame()
const roads = modules.roads({ from: features.tiles("roads", "paths", "rail") })
const buildings = areas.polygons(features.tiles("buildings"))
const ocean = areas.extendToFrame(
  areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), "0.35mm"),
  frame,
)
const docks = areas.polygons(features.tiles("water:dock"))
const water = areas.union(areas.polygons(features.tiles("water:lake,river,pond,dock")), ocean)
const piers = lines.of(features.tiles("transportation:pier"))
const pierPads = areas.buffer(piers, "0.25mm")

// Man-made land, not drawn: grown so gaps between blocks read as white city
// rather than bare ground.
const landuse = areas.polygons(
  features.tiles(
    /** @type {TilePreset} */(
      "landuse:residential,commercial,industrial,retail,garages,railway,bus_station,quarry,military,cemetery,school,university,kindergarten,college,library,hospital,stadium,pitch,playground,track,theme_park,zoo,dam,parking"
    ),
  ),
)
// Built-up footprint: ground burin eases out over `mask_reach_m` before it.
const urban = areas.union(landuse, buildings, roads.area)
// ── Nature ─────────────────────────────────────────────────────────────────
// Bottom to top: where kinds overlap the upper one wins. `parks` and
// `landcover:park` outline whole parks, woods and beaches included, so they
// sit at the bottom. `relief: false` keeps the burin out of that kind even
// when a park with relief lies underneath.
/** @type {Omit<FillOptions, "in">} */
const DOTS = { pattern: "dots", spacing: "0.75mm", mark: "0.22mm", angle: 30 }
/**
 * @type {Array<{
 *   id: string
 *   tiles: TilePreset | TilePreset[]
 *   relief: boolean
 *   fill: Omit<FillOptions, "in">
 *   area?: Area
 *   visible?: Area
 * }>}
 */
const NATURE = [
  { id: "protected", tiles: ["parks"], relief: true, fill: DOTS },
  { id: "park", tiles: ["landcover:park"], relief: true, fill: DOTS },
  { id: "farmland", tiles: ["farmland"], relief: true, fill: DOTS },
  { id: "ice", tiles: ["glacier"], relief: true, fill: DOTS },
  { id: "wetland", tiles: ["wetland"], relief: false, fill: DOTS },
  { id: "sand", tiles: ["sand", "landcover:sand/beach"], relief: false, fill: { ...DOTS, pattern: "stipple-edge" } },
  { id: "bare_rock", tiles: ["landcover:rock/bare_rock"], relief: true, fill: DOTS },
  { id: "wood", tiles: ["forest", "landuse:forest"], relief: true, fill: DOTS },
  { id: "scrub", tiles: ["landcover:grass/scrub"], relief: true, fill: DOTS },
  { id: "golf", tiles: ["landcover:grass/golf_course"], relief: true, fill: { ...DOTS } },
  { id: "grass", tiles: ["landcover:grass/grass"], relief: false, fill: { ...DOTS, spacing: "0.60mm" } },
  { id: "flowerbed", tiles: ["landcover:grass/flowerbed"], relief: true, fill: DOTS },
  { id: "garden", tiles: ["landcover:garden"], relief: false, fill: { ...DOTS, spacing: "0.60mm" } },
]
for (const kind of NATURE) {
  const selectors = Array.isArray(kind.tiles) ? kind.tiles : [kind.tiles]
  kind.area = areas.polygons(features.tiles(...selectors))
}

// What each kind shows once the kinds above it are cut out, so patterns
// never stack. Walk from the top, carrying what is already covered.
let covered = null
for (const kind of [...NATURE].reverse()) {
  kind.visible = covered ? areas.difference(kind.area, covered) : kind.area
  covered = covered ? areas.union(covered, kind.area) : kind.area
}
const nature = covered
const openGround = areas.difference(frame, water, nature)

const piersOnWater = areas.intersect(pierPads, water)
const ferryRoutes = lines.clip(lines.of(features.tiles("transportation:ferry")), water)
const ferryCorridor = areas.intersect(areas.buffer(ferryRoutes, "0.35mm"), water)

const noRelief = areas.union(...NATURE.filter((k) => !k.relief).map((k) => k.area))
const reliefArea = areas.difference(
  areas.union(...NATURE.filter((k) => k.relief).map((k) => k.area)),
  noRelief,
)

// ── Terrain ────────────────────────────────────────────────────────────────
const groundBurin = burin.terrain(
  (b) =>
    b.batch({
      angle: 0,
      outside: "urban",
      // Land mask, same idea as engraved-sea's `water_*` at the coast (`presets/engraved-sea.js`).
      mask_start_m: 0,
      mask_reach_m: 100,
      mask_fade: 0.2,
      mask_fray_m: 40,
      style: {
        dash_light: 0.1,
        dash_dark: 1,
        mod_jitter: 1,
        mod_flat: 0.5,
        dash_cutoff: 0.05
      },
    }),
  { in: openGround, regions: { urban } },
)
const natureBurin = burin.terrain(
  (b) =>
    b.batch({
      // angle: 90,
      within: "relief",
      outside: "urban",
      mask_start_m: 0,
      mask_reach_m: 100,
      mask_fade: 0.2,
      mask_fray_m: 40,
      style: {
        space_light: 12,
        space_dark: 10,
        dash_light: 0.1,
        dash_dark: 1,
        mod_jitter: 1,
        mod_flat: 0.5,
        dash_cutoff: 0.05
      },
    }),
  { in: reliefArea, regions: { relief: reliefArea, urban } },
)


// Trails inside nature: the tiles tag park trails and sidewalks alike.
// One geometry drives both the white corridor and the dotted centreline.
const trailLines = lines.clip(lines.of(features.tiles("paths")), nature)
const trailClear = areas.buffer(trailLines, "0.45mm")

// ── Draw, bottom to top ────────────────────────────────────────────────────
// Layer ids use a type-first convention: `fill_*` for patterns/filled marks
// and `lines_*` for every pen stroke. Mask names use `mask_<action>_<subject>`.
const penStroke = (stroke) => ({ ...stroke, width: PEN, cap: "round" })
const ground = [draw({ id: "lines_ground_burin", from: groundBurin, stroke: penStroke({ style: "solid" }) })]
const natureFills = NATURE.map((k) =>
  draw({ id: `fill_nature_${k.id}`, from: fills.fill({ in: k.visible, ...k.fill }), stroke: penStroke({ style: "solid" }) }),
)
const wood = NATURE.find((k) => k.id === "wood")
// 3D canopy: metaball crowns cut into slices (overhang), lit from one side.
// Where OSM maps a tree, it gets its own crown in a small disc around it
// (overlapping discs merge into a grove), bulging a little past the disc
// (`edge: "overflow"`). The rest of the wood gets generated crowns that
// close before its border (`edge: "inside"`), with clearings (`coverage`).
// `fills.cover(...)` below reports each canopy's real footprint so the dots
// and the ground burin only hide where a crown actually stands.
/** @type {Omit<FillOptions, "in">} */
const SHADE = {
  pattern: "isoline-stack",
  seed: 7,
  slices: 5,
  jitter: 4,
  light: 0.85,
  light_angle: 225,
} // light from the top left, as on the burin maps
const trees = features.osm({ natural: "tree" })
// Mapped crowns on any dry land (campus quads, park edges, …), not only
// inside the forest polygon. Where a mapped tree disc touches or sits near
// the wood, unioning it into `wood.visible` lets its crown and the forest
// canopy share a single 3D metaball field and merge seamlessly; only trees
// standing out in the open are drawn by `MAPPED_TREES`.
const land = areas.difference(frame, water)
const treeDiscsMapped = areas.intersect(areas.around(trees, "1.4mm"), land)
const treeDiscsOpen = areas.difference(treeDiscsMapped, areas.grow(wood.visible, "1.0mm"))
/** @type {FillOptions} */
const FOLIAGE = {
  ...SHADE,
  in: areas.union(wood.visible, areas.difference(treeDiscsMapped, treeDiscsOpen)),
  spacing: "2.0mm",
  edge: "overflow",
  coverage: 0.5,
  bubble: "1mm",
}
/** @type {FillOptions} */
const MAPPED_TREES = {
  ...SHADE,
  in: treeDiscsOpen,
  spacing: "2.0mm",
  edge: "overflow",
  coverage: 1.0,
  bubble: "1mm",
}
const woodFoliage = draw({
  id: "fill_wood_foliage",
  from: fills.fill(FOLIAGE),
  stroke: penStroke({ style: "solid" }),
})
const woodTrees = draw({
  id: "fill_wood_trees",
  from: fills.fill(MAPPED_TREES),
  stroke: penStroke({ style: "solid" }),
})
// Seen from above, crowns sit over roads, paths and water but under buildings
// and labels. Strokes never hide each other by order; only masks cut ink, so
// see the `mask_canopy_over`, `mask_buildings_over` and `mask_clear_labels`
// masks below.
const canopyDraws = [woodFoliage, woodTrees]
const natureDraws = [
  draw({ id: "lines_nature_terrain", from: natureBurin, stroke: penStroke({ style: "solid" }) }),
  ...natureFills,
  draw({ id: "lines_nature_ring", from: lines.rings(nature), stroke: penStroke({ style: "dash", dash: "0.45mm", gap: "0.4mm" }) }),
]
const pathDraws = [
  draw({
    id: "lines_garden_paths",
    from: trailLines,
    stroke: penStroke({ style: "dotted", mark: "0.35mm", gap: "0.5mm" }),
  }),
]
const waterDraws = [
  draw({
    id: "lines_water_ring",
    from: lines.clip(lines.rings(water), areas.grow(frame, "-0.25mm")),
    stroke: penStroke({ style: "solid" }),
  }),
  draw({ id: "fill_water", from: fills.fill({ in: water, pattern: "waves", spacing: "0.75mm" }), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "lines_dock_ring", from: lines.rings(docks), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "lines_piers", from: lines.rings(pierPads), stroke: penStroke({ style: "solid" }) }),
  // White strip on waves, then a dashed centreline — comment either draw or `mask_ferry_on_water` to try one alone.
  draw({ id: "lines_ferry", from: ferryRoutes, stroke: penStroke({ style: "dash", dash: "0.45mm", gap: "0.4mm" }) }),
]
const roadDraws = [
  draw({ id: "lines_rail", from: roads.rails, stroke: penStroke({ style: "dash", dash: "1.4mm", gap: "1.1mm" }) }),
  draw({ id: "lines_roads_outlines", from: roads.outlines, stroke: penStroke({ style: "solid" }) }),
  draw({ id: "lines_roads_center", from: roads.centerlines, stroke: penStroke({ style: "dash", dash: "0.3mm", gap: "0.35mm" }) }),
  draw({ id: "lines_roads_seams", from: roads.seams, stroke: penStroke({ style: "solid" }) }),
]
const buildingDraws = [
  draw({
    id: "fill_buildings",
    from: fills.fill({ in: buildings, per: "feature", pattern: "lines", spacing: "0.5mm", angle: 45 }),
    stroke: penStroke({ style: "solid" }),
  }),
  draw({ id: "lines_buildings_ring", from: lines.rings(buildings), stroke: penStroke({ style: "solid" }) }),
]

const underRoads = [...ground, ...natureDraws, ...waterDraws]
compose.mask({ name: "mask_clear_trails", from: trailClear, occludes: ["lines_nature_terrain", ...natureFills] })
// The canopy's footprint cuts everything under it (ground, nature, paths,
// water, roads); mapped crowns also cut the generated ones they overlap.
const canopy = areas.union(fills.cover(FOLIAGE), fills.cover(MAPPED_TREES))
compose.mask({ name: "mask_canopy_over", from: canopy, occludes: [...underRoads, ...pathDraws, ...roadDraws] })
compose.mask({ name: "mask_mapped_trees_over_wood", from: fills.cover(MAPPED_TREES), occludes: ["fill_wood_foliage"] })
compose.mask({ name: "mask_water_over", from: water, occludes: [...ground, ...natureDraws, ...pathDraws] })
compose.mask({ name: "mask_piers_on_water", from: piersOnWater, occludes: ["fill_water"] })
compose.mask({ name: "mask_ferry_on_water", from: ferryCorridor, occludes: ["fill_water"] })
compose.mask({ name: "mask_roads_over", from: roads.area, occludes: underRoads })
compose.mask({ name: "mask_buildings_over", from: buildings, occludes: [...underRoads, ...roadDraws, ...canopyDraws] })

// ── Labels ─────────────────────────────────────────────────────────────────
const labels = modules.labels({
  from: [
    features.tiles("road_names"),
    features.tiles("parks"),
    features.tiles("place:suburb,neighbourhood,quarter,island"),
    features.tiles("poi:attraction,museum,monument,castle,theme_park,viewpoint"),
  ],
  rules: [
    { id: "park", tags: { "tiles:layer": "park" }, size: "3.5mm", minSize: "2.2mm", font: { origin: "google", family: "Roboto", weight: 700 } },
    { id: "place", tags: { "tiles:layer": "place" }, size: "2.6mm", minSize: "2.1mm" },
    { id: "poi", tags: { "tiles:layer": "poi" }, size: "2mm", minSize: "1.6mm" },
    { id: "major", tags: { class: ["motorway", "trunk", "primary"] }, buffer: 1, bufferStep: "0.2mm", keepCenterline: false },
    { id: "street", tags: { "tiles:layer": "transportation_name" } },
  ],
})
const labelClear = areas.union(labels.area, areas.buffer(labels.lines, "0.6mm"))
compose.mask({
  name: "mask_clear_labels",
  from: labelClear,
  occludes: [...underRoads, ...roadDraws, ...buildingDraws, ...pathDraws, ...canopyDraws],
})

draw({ id: "lines_labels", from: labels.lines, stroke: penStroke({ style: "solid" }) })

// ── Layer order, top first ───────────────────────────────────────────────────
// Only the sequence groups are written in (and plotted); it hides nothing.
// What sits on top of what is decided by the masks above.
compose.order(
  "lines_labels",
  "lines_water_ring",
  "lines_roads_outlines",
  "lines_rail",
  "lines_roads_seams",
  "lines_roads_center",
  "lines_ferry",
  "lines_dock_ring",
  "lines_garden_paths",
  "lines_nature_ring",
  "lines_nature_terrain",
  "lines_piers",
  "lines_buildings_ring",
  "lines_ground_burin",
  "fill_buildings",
  "fill_wood_trees",
  "fill_wood_foliage",
  "fill_water",
  "fill_nature_garden",
  "fill_nature_flowerbed",
  "fill_nature_grass",
  "fill_nature_golf",
  "fill_nature_scrub",
  "fill_nature_wood",
  "fill_nature_bare_rock",
  "fill_nature_sand",
  "fill_nature_wetland",
  "fill_nature_ice",
  "fill_nature_farmland",
  "fill_nature_park",
  "fill_nature_protected",
)

// ── Plotter optimization ────────────────────────────────────────────────────
// Keep stippled nature and field fills untouched: overlap removal changes
// their texture. These are the urban outlines and route layers instead.
const cityLines = [
  "lines_labels",
  "lines_buildings_ring",
  "fill_buildings",
  "fill_wood_trees",
  "fill_wood_foliage",
  "lines_roads_seams",
  "lines_roads_outlines",
  "lines_water_ring",
  "lines_piers",
  "lines_dock_ring",
]
const routeLines = ["lines_roads_center", "lines_rail", "lines_ferry", "lines_garden_paths", "lines_nature_ring"]
const cityAndRoutes = [...cityLines, ...routeLines]

compose.deoverlap(cityLines, { tolerance: PEN })
compose.linemerge(cityLines, "0.1mm")
compose.simplify(cityAndRoutes, "0.03mm")
// Sort pen travel inside every layer, including fills/patterns. Keep label
// outline strokes in their text order rather than turning their glyphs into
// an arbitrary nearest-neighbour route.
compose.linesort({ except: ["lines_labels"] })
