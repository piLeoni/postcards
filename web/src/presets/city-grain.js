title("City grain")
output({
  width: "6in",
  height: "4in",
  scale: "1:10000",
  bearing: -4,
  projection: "webmercator",
  lat: 37.7805838,
  lng: -122.509662,
  tileZoom: 14,
})

const PEN = "0.2mm"

// Bottom to top: bare ground (burin), nature (one pattern per kind, burin
// only where the kind has relief), water, roads, buildings, labels.

// ── Base geometry ──────────────────────────────────────────────────────────
const frame = engine.frame()
const roads = modules.roads({ from: features.tiles("roads") })
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
    /** @type {TilePreset} */ (
      "landuse:residential,commercial,industrial,retail,garages,railway,bus_station,quarry,military,cemetery,school,university,kindergarten,college,library,hospital,stadium,pitch,playground,track,theme_park,zoo,dam,parking"
    ),
  ),
)
// Grown pad: hides burin under the city; `urban_ring` draws its edge.
const urban = areas.grow(areas.union(landuse, buildings, roads.area), "10mm")
// `modules.roads` is carriageways only; rail is separate but uses the same masks
// and is clipped out of building footprints like road centerlines.
const railways = lines.clip(lines.of(features.tiles("rail")), buildings, { invert: true })

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
  { id: "wood", tiles: ["forest", "landuse:forest"], relief: true, fill: { ...DOTS, pattern: "granite" } },
  { id: "scrub", tiles: ["landcover:grass/scrub"], relief: true, fill: DOTS },
  { id: "golf", tiles: ["landcover:grass/golf_course"], relief: true, fill: { ...DOTS, spacing: "1mm" } },
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

// Urban dash only against open burin ground and “wild” nature — not water, not parks/gardens.
const parkLike = areas.union(
  ...NATURE.filter((k) => ["protected", "park", "garden", "golf", "flowerbed"].includes(k.id)).map((k) => k.area),
)
const openGround = areas.difference(frame, water, nature, urban)
const wildBesideUrban = areas.union(openGround, areas.difference(nature, parkLike))
const urbanRing = lines.clip(lines.rings(urban), areas.grow(wildBesideUrban, "0.25mm"))
const piersOnWater = areas.intersect(pierPads, water)
const ferryRoutes = lines.clip(lines.of(features.tiles("transportation:ferry")), water)
const ferryCorridor = areas.intersect(areas.buffer(ferryRoutes, "0.35mm"), water)

const noRelief = areas.union(...NATURE.filter((k) => !k.relief).map((k) => k.area))
const reliefArea = areas.difference(
  areas.union(...NATURE.filter((k) => k.relief).map((k) => k.area)),
  noRelief,
)

// ── Terrain ────────────────────────────────────────────────────────────────
const terrain = (style, area) => burin.terrain((b) => b.batch({ angle: 0, style }), { in: area })
const groundBurin = terrain(
  { sun_exag: 2, dash_light: 0.48, dash_dark: 0.88, space_light: 0.9, space_dark: 0.72, input_light_floor: 0.14 },
  areas.difference(frame, water, nature, urban),
)
// const natureBurin = terrain(
//   // { sun_exag: 2, dash_light: 0.45, dash_dark: 0.85, space_light: 2, space_dark: 0.72, input_light_floor: 0.15 },
//   { sun_exag: 2, dash_light: 0, dash_dark: 0.85, space_light: 5, space_dark: 1.2, input_light_floor: 0, angle:90 },
//   reliefArea,
// )

const natureBurin = burin.terrain(
  (b) => b.batch({ angle: 90, style: { sun_exag: 2, dash_light: 0, dash_dark: 0.85, space_light: 5, space_dark: 1.2, input_light_floor: 0 } }),
  { in: reliefArea },
)


// Trails inside nature only: the tiles tag park trails and sidewalks alike.
const trailClear = areas.buffer(lines.clip(lines.of(features.tiles("paths")), nature), "0.22mm")

// ── Draw, bottom to top ────────────────────────────────────────────────────
const penStroke = (stroke) => ({ ...stroke, width: PEN, cap: "round" })
const ground = [draw({ id: "ground_burin", from: groundBurin, stroke: penStroke({ style: "solid" }) })]
const natureFills = NATURE.map((k) =>
  draw({ id: `nat_fill_${k.id}`, from: fills.fill({ in: k.visible, ...k.fill }), stroke: penStroke({ style: "solid" }) }),
)
const natureDraws = [
  draw({ id: "nat_terrain", from: natureBurin, stroke: penStroke({ style: "solid" }) }),
  ...natureFills,
  draw({ id: "nat_ring", from: lines.rings(nature), stroke: penStroke({ style: "dash", dash: "0.45mm", gap: "0.4mm" }) }),
]
const waterDraws = [
  draw({ id: "water_ring", from: lines.rings(water), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "water_fill", from: fills.fill({ in: water, pattern: "waves", spacing: "0.75mm" }), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "dock_ring", from: lines.rings(docks), stroke: penStroke({ style: "solid" }) }),
  draw({ id: "piers", from: lines.rings(pierPads), stroke: penStroke({ style: "solid" }) }),
  // White strip on waves, then a dashed centreline — comment either draw or `ferry_on_water` to try one alone.
  draw({ id: "ferry", from: ferryRoutes, stroke: penStroke({ style: "dash", dash: "0.45mm", gap: "0.4mm" }) }),
]
const urbanDraws = [
  draw({ id: "urban_ring", from: urbanRing, stroke: penStroke({ style: "dash", dash: "0.5mm", gap: "0.4mm" }) }),
]
const railDraws = [
  draw({
    id: "rail",
    from: railways,
    stroke: penStroke({ style: "dotted", mark: "0.15mm", gap: "0.45mm" }),
  }),
]
const roadDraws = [
  draw({ id: "roads_out", from: roads.outlines, stroke: penStroke({ style: "solid" }) }),
  draw({ id: "roads_center", from: roads.centerlines, stroke: penStroke({ style: "dash", dash: "0.3mm", gap: "0.35mm" }) }),
  draw({ id: "roads_seam", from: roads.seams, stroke: penStroke({ style: "solid" }) }),
]
const buildingDraws = [
  draw({
    id: "bldg_fill",
    from: fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.5mm", angle: 45 }),
    stroke: penStroke({ style: "solid" }),
  }),
  draw({ id: "bldg_ring", from: lines.rings(buildings), stroke: penStroke({ style: "solid" }) }),
]

const underRoads = [...ground, ...natureDraws, ...urbanDraws, ...waterDraws, ...railDraws]
compose.mask({ name: "trail_clear", from: trailClear, occludes: ["nat_terrain", ...natureFills] })
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
    { id: "park", tags: { "tiles:layer": "park" }, size: "3.5mm", minSize: "2.2mm", font: { origin: "google", family: "Roboto", weight:700 } },
    { id: "place", tags: { "tiles:layer": "place" }, size: "2.6mm", minSize: "2.1mm" },
    { id: "poi", tags: { "tiles:layer": "poi" }, size: "2mm", minSize: "1.6mm" },
    { id: "major", tags: { class: ["motorway", "trunk", "primary"] }, buffer: 1, bufferStep: "0.25mm", keepCenterline: false },
    { id: "street", tags: { "tiles:layer": "transportation_name" } },
  ],
})
const labelClear = areas.union(labels.area, areas.buffer(labels.lines, "0.5mm"))
compose.mask({ name: "label_clear", from: labelClear, occludes: [...underRoads, ...roadDraws, ...buildingDraws] })

draw({ id: "labels", from: labels.lines, stroke: penStroke({ style: "solid" }) })
