title("City grain")
output({
  width: "6in",
  height: "4in",
  scale: "1:8000",   // terrain 0.758 × 0.505 mi
  bearing: -4,
  projection: "webmercator",
  lat: 37.7805838,
  lng: -122.509662,
  tileZoom: 14,
})

// Same layers as `_Everything · vector tiles` (full.js): parks, water, roads,
// buildings from OpenFreeMap vector tiles.
const bldg = features.tiles("buildings")
const green = features.tiles("landcover:park,garden,grass/grass,wood")
const wet = features.tiles("water:lake,river,pond,dock")
const oceanTiles = features.tiles("ocean")
const ways = features.tiles("roads")
const paths = features.tiles("paths")

const roads = modules.roads({ from: ways })
const buildings = areas.polygons(bldg)
const parks = areas.polygons(green)
const frame = engine.frame()
const ocean = areas.extendToFrame(areas.grow(areas.intersect(areas.polygons(oceanTiles), frame), "0.35mm"), frame)
const water = areas.union(areas.polygons(wet), ocean)

// Trails in the parks only. The tiles tag a park trail and a sidewalk or a
// crosswalk alike (`footway`), so they are told apart by where they run.
const parkTrails = lines.clip(lines.of(paths), parks)
// Knock dots out of the park fill — white paths, no ink stroke on top.
const trailClear = areas.buffer(parkTrails, "0.22mm")

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
  draw({ id: "roads_center", from: roads.centerlines, stroke: { style: "dash", dash: "0.3mm", gap: "0.35mm" } }),
  draw({ id: "roads_seam", from: roads.seams, stroke: "solid" }),
]
const building = [
  draw({ id: "bldg_fill", from: bldgFill }),
  draw({ id: "bldg_ring", from: bldgRing, stroke: "solid" }),
]

// Each mask hides exactly the groups it lists: water over the parks, roads
// over both, buildings over everything.
compose.mask({ name: "trail_clear", from: trailClear, occludes: ["park_fill"] })
compose.mask({ name: "wet_cover", from: water, occludes: [...park] })
compose.mask({ name: "roads_cover", from: roads.area, occludes: [...park, ...wetDraws] })
compose.mask({ name: "bldg_cover", from: buildings, occludes: [...park, ...wetDraws, ...road] })

// Names: streets (all classes in the tiles — Venice calli are often path/service),
// parks, neighbourhoods, and a few POI types.
const streetNames = features.tiles("road_names")
const places = features.tiles("place:suburb,neighbourhood,quarter,island")
const pois = features.tiles("poi:attraction,museum,monument,castle,theme_park,viewpoint")
const labels = modules.labels({
  from: [streetNames, features.tiles("parks"), places, pois],
  rules: [
    {
      id: "park",
      tags: { "tiles:layer": "park" },
      size: "2.5mm",
      minSize: "2.2mm",
      font: { origin: "google", family: "Roboto" },
    },
    {
      id: "place",
      tags: { "tiles:layer": "place" },
      size: "2.6mm",
      minSize: "2.1mm",
    },
    { id: "poi", tags: { "tiles:layer": "poi" }, size: "2mm", minSize: "1.6mm" },
    { id: "major", tags: { class: ["motorway", "trunk", "primary"] }, buffer: 1, bufferStep: "0.1mm", keepCenterline: false },
    { id: "street", tags: { "tiles:layer": "transportation_name" } },
  ],
})
const labelClear = areas.union(labels.area, areas.buffer(labels.lines, "0.45mm"))
compose.mask({ name: "label_clear", from: labelClear, occludes: [...park, ...wetDraws, ...road, ...building] })
draw({ id: "label_fill", from: fills.fill({ in: labels.park.area, pattern: "lines", spacing: "0.3mm", angle: 45 }) })
draw({ id: "labels", from: labels.lines, stroke: "solid" })
