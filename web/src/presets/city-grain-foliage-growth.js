title("City grain · growth foliage")
output({
  width: "6in",
  height: "4in",
  scale: "1:10000",   // terrain 0.947 × 0.631 mi
  bearing: -4,
  projection: "webmercator",
  lat: 37.7864972,
  lng: -122.4850441,
  tileZoom: 14,
})

const PEN = "0.2mm"

// Same as city-grain.js, isolated so the two foliage options (this one and
// city-grain-foliage-isoline.js) sit side by side without one overwriting
// the other's tuning. `growth`: dendritic branches grown toward a field of
// attractor points (space colonization) instead of a 3D canopy — reads as
// veins/roots/undergrowth rather than a solid overhanging crown. Each tree
// grows in its own round cell; `fills.cover(FOLIAGE)` masks the wood's dots
// and burin under the cells, and the gaps between trees keep them.
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
const penStroke = (stroke) => ({ ...stroke, width: PEN, cap: "round" })
const ground = [draw({ id: "ground_burin", from: groundBurin, stroke: penStroke({ style: "solid" }) })]
const natureFills = NATURE.map((k) =>
  draw({ id: `nat_fill_${k.id}`, from: fills.fill({ in: k.visible, ...k.fill }), stroke: penStroke({ style: "solid" }) }),
)
const wood = NATURE.find((k) => k.id === "wood")
// Dendritic veins filling the wood: twigs `spacing` apart drain into trunks
// that thicken by whole pen widths towards each root.
/** @type {FillOptions} */
const FOLIAGE = {
  in: wood.visible,
  pattern: "growth",
  spacing: "0.8mm", // twig spacing: dense, evenly packed basins
  seed: 7,
  root_spacing: "6mm", // one basin per root, white seams between them
  line_width: PEN, // trunk passes sit side by side, one pen apart
  coverage: 0.72, // how far each tree reaches towards its neighbours (leaves clearings like isoline)
  variation: 0.99, // some crowns bigger, some smaller
  trunk: 0, // single line width throughout
}
const woodFoliage = draw({
  id: "nat_fill_wood_foliage",
  from: fills.fill(FOLIAGE),
  stroke: penStroke({ style: "solid" }),
})
const natureDraws = [
  draw({ id: "nat_terrain", from: natureBurin, stroke: penStroke({ style: "solid" }) }),
  ...natureFills,
  woodFoliage,
  draw({ id: "nat_ring", from: lines.rings(nature), stroke: penStroke({ style: "dash", dash: "0.45mm", gap: "0.4mm" }) }),
]
const pathDraws = [
  draw({
    id: "garden_paths",
    from: trailLines,
    stroke: penStroke({ style: "dotted", mark: "0.35mm", gap: "0.5mm" }),
  }),
]
const waterDraws = [
  draw({
    id: "water_ring",
    from: lines.clip(lines.rings(water), areas.grow(frame, "-0.25mm")),
    stroke: penStroke({ style: "solid" }),
  }),
  draw({ id: "water_fill", from: fills.fill({ in: water, pattern: "waves", spacing: "0.75mm" }), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "dock_ring", from: lines.rings(docks), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "piers", from: lines.rings(pierPads), stroke: penStroke({ style: "solid" }) }),
  // White strip on waves, then a dashed centreline — comment either draw or `ferry_on_water` to try one alone.
  draw({ id: "ferry", from: ferryRoutes, stroke: penStroke({ style: "dash", dash: "0.45mm", gap: "0.4mm" }) }),
]
const roadDraws = [
  draw({ id: "rail", from: roads.rails, stroke: penStroke({ style: "dash", dash: "1.4mm", gap: "1.1mm" }) }),
  draw({ id: "roads_out", from: roads.outlines, stroke: penStroke({ style: "solid" }) }),
  draw({ id: "roads_center", from: roads.centerlines, stroke: penStroke({ style: "dash", dash: "0.3mm", gap: "0.35mm" }) }),
  draw({ id: "roads_seam", from: roads.seams, stroke: penStroke({ style: "solid" }) }),
]
const buildingDraws = [
  draw({
    id: "bldg_fill",
    from: fills.fill({ in: buildings, per: "feature", pattern: "lines", spacing: "0.5mm", angle: 45 }),
    stroke: penStroke({ style: "solid" }),
  }),
  draw({ id: "bldg_ring", from: lines.rings(buildings), stroke: penStroke({ style: "solid" }) }),
]

const underRoads = [...ground, ...natureDraws, ...waterDraws]
compose.mask({
  name: "wood_foliage",
  from: fills.cover(FOLIAGE),
  occludes: ["nat_terrain", "nat_fill_wood"],
})
compose.mask({ name: "trail_clear", from: trailClear, occludes: ["nat_terrain", ...natureFills, "nat_fill_wood_foliage"] })
compose.mask({ name: "wet_cover", from: water, occludes: [...ground, ...natureDraws] })
compose.mask({ name: "pier_on_water", from: piersOnWater, occludes: ["water_fill"] })
compose.mask({ name: "ferry_on_water", from: ferryCorridor, occludes: ["water_fill"] })
compose.mask({ name: "roads_cover", from: roads.area, occludes: underRoads })
compose.mask({ name: "bldg_cover", from: buildings, occludes: [...underRoads, ...roadDraws] })

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
const labelClear = areas.union(labels.area, areas.buffer(labels.lines, "0.85mm"))
compose.mask({ name: "label_clear", from: labelClear, occludes: [...underRoads, ...roadDraws, ...buildingDraws, ...pathDraws] })

draw({ id: "labels", from: labels.lines, stroke: penStroke({ style: "solid" }) })

// ── Layer order, bottom first ──────────────────────────────────────────────
// Masks still cut only the groups they list, wherever those sit here.
compose.order(
  "labels",
  "bldg_ring",
  "bldg_fill",
  "roads_seam",
  "roads_center",
  "roads_out",
  "rail",
  "ferry",
  "piers",
  "dock_ring",
  "water_fill",
  "water_ring",
  "nat_ring",
  "nat_terrain",
  "nat_fill_garden",
  "nat_fill_flowerbed",
  "nat_fill_grass",
  "nat_fill_golf",
  "nat_fill_scrub",
  "nat_fill_wood_foliage",
  "nat_fill_wood",
  "nat_fill_bare_rock",
  "nat_fill_sand",
  "nat_fill_wetland",
  "nat_fill_ice",
  "nat_fill_farmland",
  "nat_fill_park",
  "nat_fill_protected",
  "ground_burin",
  "garden_paths",
)
