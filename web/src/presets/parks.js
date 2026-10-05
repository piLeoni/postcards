title("Parks and buildings")
output({
  width: "6in",
  height: "4in",
  scale: "1:8000",
  bearing: 0,
  projection: "webmercator",
  lat: 37.8771145,
  lng: -122.256196,
  tileZoom: 14,
})

// Green, water and buildings from the vector tiles: quick to fetch and draw.
const bldg = features.tiles("buildings")
const green = features.tiles("landcover:park,garden")
const wet = features.tiles("water:lake,river,pond,dock")

const buildings = areas.polygons(bldg)
const parks = areas.polygons(green)
const water = areas.union(areas.polygons(wet), engine.ocean())

const bldgRing = lines.rings(buildings)
const parkRing = lines.rings(parks)

const bldgFill = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })
const parkFill = fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.2mm" })
const waterFill = fills.fill({ in: water, pattern: "waves", spacing: "0.75mm" })

// Bottom to top.
draw({ id: "park_ring", from: parkRing, stroke: { style: "dash", dash: "0.45mm", gap: "0.4mm" } })
draw({ id: "park_fill", from: parkFill })
draw({ id: "water_fill", from: waterFill })
draw({ id: "bldg_fill", from: bldgFill })
draw({ id: "bldg_ring", from: bldgRing, stroke: "solid" })
