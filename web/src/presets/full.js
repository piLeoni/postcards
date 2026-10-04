title("Everything · vector tiles")
output({ width: "6in", height: "4in", scale: "1:8000", bearing: 0, projection: "webmercator", lat: 37.8771145, lng: -122.256196 })

// Parks, water, roads and buildings, all from OpenFreeMap's vector tiles.
const bldg = features.tiles("buildings")
const green = features.tiles("landcover:park,garden,grass/grass,wood")
const wet = features.tiles("water:lake,river,pond,dock")
const ways = features.tiles("roads", "paths")

const roads = modules.roads({ from: ways })
const buildings = areas.polygons(bldg)
const parks = areas.polygons(green)
const water = areas.union(areas.polygons(wet), engine.ocean())

const parkRing = lines.rings(parks)
const bldgRing = lines.rings(buildings)
const waterRing = lines.rings(water)

const parkFill = fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.2mm", angle: 45 })
const waterFill = fills.fill({ in: water, pattern: "waves", spacing: "0.75mm" })
const bldgFill = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })

// Bottom to top.
const park = [
  draw({ id: "park_ring", from: parkRing, stroke: { style: "dash", dash: "0.45mm", gap: "0.4mm" } }),
  draw({ id: "park_fill", from: parkFill }),
]
const wetDraws = [
  draw({ id: "water_ring", from: waterRing, stroke: "solid" }),
  draw({ id: "water_fill", from: waterFill }),
]
const road = [
  draw({ id: "roads_out", from: roads.outlines, stroke: "solid" }),
  draw({ id: "roads_trail", from: roads.trails, stroke: "solid" }),
  draw({ id: "roads_center", from: roads.centerlines, stroke: { style: "dash", dash: "0.3mm", gap: "0.35mm" } }),
  draw({ id: "roads_seam", from: roads.seams, stroke: "solid" }),
]
const building = [
  draw({ id: "bldg_fill", from: bldgFill }),
  draw({ id: "bldg_ring", from: bldgRing, stroke: "solid" }),
]

// Each mask hides exactly the groups it lists: water over the parks, roads
// over both, buildings over everything.
compose.mask({ name: "wet_cover", from: water, occludes: [...park] })
compose.mask({ name: "roads_cover", from: roads.area, occludes: [...park, ...wetDraws] })
compose.mask({ name: "bldg_cover", from: buildings, occludes: [...park, ...wetDraws, ...road] })
