title("_Engraved sea · natural land and sea")
output({
  width: "6in",
  height: "4in",
  scale: "1:25000",
  bearing: 0,
  projection: "webmercator",
  lat: 37.7,
  lng: -122.62,
  tileZoom: 14,
})

// The old chart look, drawn by burin over the elevation under the output: the
// hills in contour lines crossed with a second pass at 45°, two concentric
// lines along the coast, and — past those — a sea of evenly waving currents.
// Every current waves evenly and in step with its neighbours, each an offset
// copy of the next, so the open water reads as engraving, not hatching. It is
// the bottom layer, and everything built on top cuts it.
const natural = burin.terrain((b) => {
  // The hills: contours, lit and shaded, then a second angle over the steeper
  // ground. `batch_floor` keeps the crosshatch off the flats.
  b.batch({ angle: 0, style: { space_light: 1.8, space_dark: 0.6, space_steep: 0.3, dash_light: 0.1 } })
  b.batch({ angle: 45, style: { batch_floor: 0.6, dash_light: 0.6, space: 7.5 } })

  // The coast: two concentric lines, then the distance contours just off it,
  // out to 20 px. `water_start` leaves a clean gap between the two.
  b.shore({ color: "#3a2c1c", lines: 2, style: { space: 1.5 } })
  b.water("lines", { color: "#4a5a66", follow: "shore", angle: 0, style: { space: 3, water_start: 3, water_reach: 20 } })

  // The open sea: one direction over the whole map, waving together. This is
  // burin's wavy modifier (`mod_wave`) with `mod_wave_even`, so no two lines
  // cross and the rows stay evenly spaced; `mod_wobble` lets the flow turn.
  b.water("lines", {
    color: "#4a5a66",
    follow: "map",
    angle: 90,
    style: {
      space: 4,
      space_light: 1,
      space_dark: 1,
      water_start: 26,
      water_reach: 4000,
      water_fade: 0.2,
      water_fray: 40,
      dash_light: 0.95,
      dash_dark: 1,
      dash_period: 9,
      dash_drop: 0,
      mod_jitter: 0.3,
      mod_wobble: 45,
      mod_wobble_size: 120,
      mod_smooth: 3,
      mod_wave: 2.5,
      mod_wave_size: 30,
      mod_wave_even: 1,
    },
  })
})

// On top: what is built. Roads and paths from the tiles, so the coast roads and
// the city streets sit over the natural base, and the green and the buildings
// in pen the way the other cards draw them.
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
