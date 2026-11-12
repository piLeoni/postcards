title("City grain (lite)")
output({ width: "6in", height: "4in", scale: "1:10000", lat: 37.8056294, lng: -122.4462699, tileZoom: 14, padding: "0.1in" })
// City grain: a fine-nib city plan in one black pen. Open ground is engraved
// with burin slope strokes, parks are dotted, trees are 3D isoline-stack
// crowns drawn at their real size, and each crown hides what lies under it.
// The full preset is City grain in the gallery.

// ── 1. Parameters & palette ─────────────────────────────────────────────
const PEN = 0.2                                    // nib width, mm
const pen = (k) => PEN * k                         // every paper length is a multiple of it
const ground = (m) => (m * 1000) / engine.scale()  // metres on the ground → mm on paper
/** @param {Exclude<Stroke, string>} s @returns {Stroke} */
const inked = (s) => /** @type {Stroke} */ ({ ...s, width: pen(1), cap: "round" })
const SOLID = inked({ style: "solid" })
const DOTTED = inked({ style: "dotted", mark: pen(1.5), gap: pen(6.5) })  // soft edges
const DASHED = inked({ style: "dash", dash: pen(1.75), gap: pen(4) })      // wide roads' centre lines

/** @type {FillStyle} */
const FILL_BUILDINGS = { per: "feature", pattern: "lines", inset: pen(1.3), spacing: pen(2.5), angle: 45 }
/** @type {FillStyle} */
const FILL_WATER = { pattern: "waves", spacing: pen(3.75) }
/** @type {FillStyle} */
const FILL_NATURE = { pattern: "dots", spacing: pen(3.75), mark: pen(1.1), angle: 30 }
// Tree crowns: stacked, jittered contours lit from the top left; `spacing` is
// a crown's real size (30 m), `coverage` how much of the park is under trees.
/** @type {FillStyle} */
const CROWNS = { pattern: "isoline-stack", spacing: ground(30), coverage: 0.6, slices: 9, jitter: 1.1, lobes: 1, ticks: 0.4, light_angle: 225, edge: "inside", seed: 7 }

// ── 2. Data & geometry ──────────────────────────────────────────────────
const frame = engine.frame()
const roads = modules.roads({ from: features.tiles("roads"), widthMultiplier: 1.65, centerlineMinWidth: { ground: 11 } })
const buildings = areas.polygons(features.tiles("buildings"))
const ocean = areas.extendToFrame(areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), pen(1.75)), frame)
const water = areas.union(areas.polygons(features.tiles("water")), ocean)
const nature = areas.difference(areas.polygons(features.tiles("parks", "grass", "forest")), water)
const urban = areas.union(buildings, roads.area)

// The ground between things, hatched across the slope; the strokes fade out
// over 100 m as they near the built-up city, so streets stay clean.
const relief = burin.terrain((b) => b.batch({
  angle: 0, outside: "urban", mask_start_m: 0, mask_reach_m: 100, mask_fade: 0.2, mask_fray_m: 40,
  style: { dash_light: 0.1, dash_dark: 1, mod_jitter: 1, mod_flat: 0.5, dash_cutoff: 0.05 },
}), { in: areas.difference(frame, nature, water), regions: { urban } })

// Trees grow in the parks, never on buildings. `fills.cover` returns the
// crowns' footprint (clearings left out) from the same run as the fill.
/** @type {FillOptions} */
const TREES = { in: areas.difference(nature, buildings), ...CROWNS }
const canopy = fills.cover(TREES)

// ── 3. Draws ────────────────────────────────────────────────────────────
const under = [
  draw({ id: "relief", from: relief, stroke: SOLID }),
  draw({ id: "nature", from: fills.fill({ in: nature, ...FILL_NATURE }), stroke: SOLID }),
  draw({ id: "nature_edge", from: lines.rings(nature), stroke: DOTTED }),
  draw({ id: "water", from: fills.fill({ in: water, ...FILL_WATER }), stroke: SOLID }),
  draw({ id: "shore", from: lines.clip(lines.rings(water), areas.grow(frame, -0.25)), stroke: SOLID }),
]
const streets = [draw({ id: "roads", from: roads.outlines, stroke: SOLID }), draw({ id: "road_centres", from: roads.centerlines, stroke: DASHED })]
const trees = draw({ id: "trees", from: fills.fill(TREES), stroke: SOLID })
const houses = [
  draw({ id: "buildings", from: lines.rings(buildings), stroke: SOLID }),
  draw({ id: "building_hatch", from: fills.fill({ in: buildings, ...FILL_BUILDINGS }), stroke: SOLID }),
]

// ── 4. Masks: what sits on top hides what is under it ───────────────────
compose.mask({ name: "under_trees", from: canopy, occludes: [...under, ...streets] })
compose.mask({ name: "under_roads", from: roads.area, occludes: [...under, ...houses] })
compose.mask({ name: "under_buildings", from: buildings, occludes: [...under, trees] })
compose.linesort()  // plot in an order that keeps the pen's travel short
