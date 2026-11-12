// The postcard: parks, water, roads and buildings, in pen. The CLI draws it
// when given no profile: `drawland map --lat … --lng …`.

output({
  width: "6in",
  height: "4in",
  scale: "1:10000",
  bearing: 0,
  projection: "webmercator",
  tileZoom: 14,
})

// Parks. Each kind claims its area minus the kinds before it, so a garden
// inside a park is dotted once.
/** @type {FillStyle} */
const dots = { pattern: "dots", spacing: "0.45mm", mark: "0.2mm", angle: 45 }
const kinds = {
  g: { leisure: "garden" },
  p: { leisure: "park" },
  w: { natural: "wood", landuse: "forest", leisure: "nature_reserve" },
  r: { landuse: ["grass", "meadow"], natural: "grassland" },
}
const claimed = []
for (const tags of Object.values(kinds)) {
  claimed.push(areas.difference(areas.polygons(features.osm(tags)), claimed))
}
const parks = areas.union(claimed)
const parksEdge = areas.fillHoles(parks)
// The holes the edge closes (yards, clearings): no kind dots them, so `wild` does.
const wild = areas.difference(parksEdge, parks)

// Water: lakes and rivers from OSM, the sea from the engine.
const wet = areas.union(areas.polygons(features.osm({ water: true, natural: "water" })), engine.ocean())

// Buildings: one dissolve for the outline and the mask; the band 0.1 mm inside
// it picks the walls buildings share.
const bldg = features.osm({ building: true })
const footprints = areas.polygons(bldg)
const dissolved = areas.union(footprints)
const sharedWalls = lines.clip(lines.dedupe(lines.segments(bldg)), areas.grow(dissolved, "-0.1mm"))

const roads = modules.roads()

draw({ id: "parks_ring", from: lines.rings(parksEdge, { exteriorOnly: true }), stroke: { style: "dash", dash: "0.45mm", gap: "0.40mm" } })
const parkFills = []
for (const [i, key] of Object.keys(kinds).entries()) {
  parkFills.push(draw({ id: `parks_fill_${key}`, from: fills.fill({ in: claimed[i], ...dots }) }))
}
parkFills.push(draw({ id: "parks_fill_x", from: fills.fill({ in: wild, ...dots }) }))
const water = [
  draw({ id: "water_ring", from: lines.rings(wet), stroke: "solid" }),
  draw({ id: "water_fill", from: fills.fill({ in: wet, pattern: "waves", spacing: "0.75mm", angle: 0 }) }),
]
const road = [
  draw({ id: "roads_out", from: roads.outlines, stroke: "solid" }),
  draw({ id: "roads_trail", from: roads.trails, stroke: "solid" }),
  draw({ id: "roads_center", from: roads.centerlines, stroke: { style: "dash", dash: "0.3mm", gap: "0.35mm" } }),
  draw({ id: "roads_seam", from: roads.seams, stroke: "solid" }),
]
const building = [
  draw({ id: "bldg_wall", from: sharedWalls, stroke: "solid" }),
  draw({ id: "bldg_fill", from: fills.fill({ in: footprints, per: "feature", pattern: "serpentine", spacing: "0.5mm", angle: 45 }) }),
  draw({ id: "bldg_ring", from: lines.join(lines.rings(dissolved), lines.of(bldg)), stroke: "solid" }),
]

// What covers what: each mask hides exactly the groups it lists. Water over the
// parks, roads over both, buildings over everything.
const park = ["parks_ring", ...parkFills]
compose.mask({ name: "wet_cover", from: wet, occludes: [...park] })
compose.mask({ name: "roads_cover", from: roads.area, occludes: [...park, ...water] })
compose.mask({ name: "bldg_cover", from: dissolved, occludes: [...park, ...water, ...road] })
