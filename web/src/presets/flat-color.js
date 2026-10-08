title("_Flat color · Berkeley")
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

// Vector tiles → areas → solid fills. Colour is on each `draw` (SVG fill, no pen
// strokes). Roads stay as lines on top; buildings mask what sits under them.
const frame = engine.frame()
const bldg = features.tiles("buildings")
const green = features.tiles("landcover:park,garden,grass/grass,wood")
const wet = features.tiles("water:lake,river,pond,dock")
const oceanTiles = features.tiles("ocean")
const ways = features.tiles("roads", "paths")

const buildings = areas.polygons(bldg)
const parks = areas.polygons(green)
const ocean = areas.extendToFrame(areas.grow(areas.intersect(areas.polygons(oceanTiles), frame), "0.35mm"), frame)
const water = areas.union(areas.polygons(wet), ocean)

const parkFill = fills.fill({ in: parks, pattern: "solid" })
const waterFill = fills.fill({ in: water, pattern: "solid" })
const bldgFill = fills.fill({ in: buildings, per: "feature", pattern: "solid" })

const roads = modules.roads({ from: ways })

// Bottom to top.
draw({ id: "water", from: waterFill, stroke: { color: "#9ec5e8" } })
draw({ id: "parks", from: parkFill, stroke: { color: "#b8d9a0" } })
draw({ id: "park_edge", from: lines.rings(parks), stroke: { color: "#7aa86a", width: 0.12 } })
draw({ id: "roads_out", from: roads.outlines, stroke: { color: "#ffffff", width: 0.35 } })
draw({ id: "roads_trail", from: roads.trails, stroke: { color: "#f0ebe3", width: 0.2 } })
draw({ id: "buildings", from: bldgFill, stroke: { color: "#e4ddd0" } })
draw({ id: "building_edge", from: lines.rings(buildings), stroke: { color: "#b8aea0", width: 0.1 } })

compose.mask({ name: "buildings_cover", from: buildings, occludes: ["parks", "water", "park_edge", "roads_out", "roads_trail"] })
