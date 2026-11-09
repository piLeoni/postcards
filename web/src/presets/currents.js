title("Currents")
output({
  width: "6.729in",
  height: "9.238in",
  scale: "1:170000",   // terrain 18.1 × 24.8 mi
  bearing: 0,
  projection: "webmercator",
  lat: 37.7378307,
  lng: -122.3766556,
  tileZoom: 14,
  padding: "0.1in",
})

// Pure nature, all burin: nothing built is drawn. The land in short strokes
// that wander with the slope — close in the shade, still present in the light,
// never in rows on the flats — the coast in a few concentric lines, and the
// sea in swirling currents that curl as the flow turns (burin-map's
// `ocean-currents`). Burin's own wobble gives the hand; no `compose.hand`, which
// at this scale would push neighbouring strokes over each other.

const SOLID = /** @type {Stroke} */ ({ style: "solid", width: "0.2mm", cap: "round" })

// Where the water is, from the vector tiles: burin follows this coast rather
// than guessing the sea from the elevation.
const water = areas.union(areas.polygons(features.tiles("ocean")), areas.polygons(features.tiles("water")))

const nature = burin.terrain((b) => {
  // The land: streamlines along the contours, broken into strokes. Light and
  // shade by spacing and stroke length; `mod_wobble` lets them wander so flat
  // ground reads as texture, not stitching.
  b.batch({
    angle: 0,
    style: {
      space_light: 6, space_dark: 2.8, space_steep: 0.35,
      dash_light: 0.35, dash_dark: 0.95, dash_period: 12, dash_cutoff: 0,
      mod_jitter: 0.7, mod_flat: 0.15,
      mod_wobble: 28, mod_wobble_size: 14, mod_smooth: 5,
    },
  })
  // The coast: the shore line and two more following it out.
  b.shore({ lines: 3, style: { space_light: 1.6 } })
  // Just off the coast: a few lines following its shape.
  b.water("lines", { follow: "shore", angle: 0, style: { space_light: 5.4, space_dark: 2.4, water_start: 4, water_reach: 20 } })
  // The open sea: one flow over the whole map, curling into currents.
  b.water("lines", {
    follow: "map",
    angle: 90,
    style: {
      space_light: 5,
      space_dark: 5,
      water_start: 27,
      water_reach: 4000,
      water_fade: 0.2,
      dash_light: 0.85,
      dash_dark: 0.95,
      dash_period: 45,
      mod_jitter: 0.3,
      mod_wobble: 70,
      mod_wobble_size: 60,
      mod_smooth: 3,
      mod_wave: 2.5,
      mod_wave_size: 60,
      mod_wave_zone: 1,
    },
  })
}, { water })

draw({ id: "lines_nature", from: nature, stroke: SOLID })

compose.filter("lines_nature", { minLength: "0.2mm" })
compose.simplify("lines_nature", "0.03mm")
compose.linesort()
