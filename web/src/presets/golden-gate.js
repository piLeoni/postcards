title("Golden Gate · natural land and sea")
output({ width: "6in", height: "4in", scale: "1:25000", bearing: 0, projection: "webmercator", lat: 37.8199, lng: -122.4783 })

// The land and the sea are burin's: a whole burin document, written here in
// burin's own language, over the whole output. It is the bottom layer, and
// everything drawn on top cuts it, like any other layer.
const natural = burin.terrain((b) => {
  // Hatching straight down every slope, denser in shadow: the built-on
  // less land reads as relief before anything is put on it.
  b.batch({
    angle: 90,
    shade: b.lerp("#c9bda6", "#3a2c1c", b.tone),
    style: {
      space: 2.4,
      space_light: 2.6,
      space_dark: 0.8,
      space_steep: 0.2,
      dash_light: 1,
      dash_dark: 1,
      dash_cutoff: 0,
      dash_drop: 0,
      mod_breaks: 0.03,
      mod_smooth: 8,
    },
  })
  // The coast, and the sea as stippling, denser towards the shore.
  b.shore({ color: "#3a2c1c", lines: 2, style: { space: 2 } })
  b.water("dots", {
    color: "#4a5a66",
    follow: "shore",
    style: { space: 9, space_light: 2.5, space_dark: 0.4, water_start: 3 },
  })
})

// On top: what is built. Roads and paths from the tiles, the same as the other
// presets, so the bridge, the Marin headlands road and the city streets sit
// over the natural base.
const ways = features.tiles("roads", "paths")
const green = features.tiles("landcover:park,garden,grass/grass,wood")
const bldg = features.tiles("buildings")

const roads = modules.roads({ from: ways })
const parks = areas.polygons(green)
const buildings = areas.polygons(bldg)

const parkRing = lines.rings(parks)
const bldgRing = lines.rings(buildings)

const parkFill = fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.18mm", angle: 45 })
const bldgFill = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })

// Bottom to top: the natural base, then green, buildings, and the roads over
// all of it.
draw({ id: "natural", from: natural, stroke: "solid" })
draw({ id: "park_ring", from: parkRing, stroke: { style: "dash", dash: "0.45mm", gap: "0.4mm" } })
draw({ id: "park_fill", from: parkFill })
draw({ id: "bldg_fill", from: bldgFill })
draw({ id: "bldg_ring", from: bldgRing, stroke: "solid" })
draw({ id: "roads_out", from: roads.outlines, stroke: "solid" })
draw({ id: "roads_trail", from: roads.trails, stroke: "solid" })
draw({ id: "roads_center", from: roads.centerlines, stroke: { style: "dash", dash: "0.3mm", gap: "0.35mm" } })

// Everything on top hides the natural ink under it; buildings hide the green.
compose.mask({ name: "over_natural", from: areas.union(parks, buildings, roads.area), occludes: ["natural"] })
compose.mask({ name: "bldg_cover", from: buildings, occludes: ["park_fill"] })
