title("Wild coast")
output({
  width: "6in",
  height: "4in",
  scale: "1:25000",
  bearing: 0,
  projection: "webmercator",
  lat: 36.372,
  lng: -121.905,
  tileZoom: 14,
  padding: "0.1in",
})

// Pure nature, by hand: nothing built is drawn. Burin hatches the hills down
// their slopes from the elevation, traces the shore, and lays water lines off
// it — tight at the coast, opening out to sea. Then the whole plate is loosened
// by `compose.hand`, so it reads as drawn, not engraved. Bixby Bridge, Big Sur;
// pan anywhere with relief and a coastline.

const PEN = 0.2
const pen = (k) => PEN * k
const SOLID = /** @type {Stroke} */ ({ style: "solid", width: pen(1), cap: "round" })

// Where the water is, from the vector tiles: burin follows this coast rather
// than guessing the sea from the elevation, so the shore is as fine as the map.
const water = areas.union(areas.polygons(features.tiles("ocean")), areas.polygons(features.tiles("water")))

const nature = burin.terrain((b) => {
  // The hills: few, long streamlines — closer on the shaded, steep ground,
  // thinning out to nothing on lit flats, so the paper does the light.
  b.batch({
    angle: 0,
    style: {
      space_light: 11, space_dark: 4, space_steep: 0.55,
      dash_light: 0.45, dash_dark: 1, dash_cutoff: 0.22,
      mod_jitter: 0.15, mod_flat: 0.7, mod_smooth: 8,
      engine_min: 10,
    },
  })
  // The coast: one shore line, then water lines that follow it out to sea.
  b.shore({ lines: 1, style: { space: 1.5 } })
  b.water("lines", {
    follow: "shore",
    angle: 0,
    style: {
      space_dark: 4,
      space_light: 14,
      water_start: 4,
      water_reach: 380,
      water_space_reach: 500,
      water_fade: 0.9,
      water_fray: 30,
      dash_light: 0.6,
      dash_cutoff: 0,
      mod_flat: 0,
    },
  })
}, { water })

draw({ id: "lines_nature", from: nature, stroke: SOLID })

// A steady hand: slow tremble and a fine tremor, ends barely loose. No
// crossing corners or pen lifts — burin's lines are already many and short.
compose.filter("lines_nature", { minLength: pen(1) })
compose.simplify("lines_nature", pen(0.15))
compose.hand("lines_nature", { preset: "steady", wobble: pen(2), wavelength: pen(60), tremor: pen(0.25), bow: 0.015, overshoot: pen(1), close: pen(1.5), seed: 11 })
compose.linesort()
