title("Salt & Stone")
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

// Pure nature, all burin: nothing built is drawn. The land in burin's classic
// hand-drawn contours, the coast in a few concentric lines, and the sea in
// swirling currents that curl as the flow turns (burin-map's
// `ocean-currents`). Burin's own wobble gives the hand; no `compose.hand`, which
// at this scale would push neighbouring strokes over each other.

const SOLID = /** @type {Stroke} */ ({ style: "solid", width: "0.2mm", cap: "round" })

// Where the water is, from the vector tiles: burin follows this coast rather
// than guessing the sea from the elevation.
const water = areas.union(areas.polygons(features.tiles("ocean")), areas.polygons(features.tiles("water")))

const nature = burin.terrain((b) => {
  // The land: burin's classic default (burin-map's `contours`) — contour
  // lines drawn by hand, uneven dashes, longer in shadow, lit flats that thin
  // out and break up. The engine's defaults, a little denser (6 / 7 px).
  b.batch({ angle: 0, style: { space_light: 4.8, space_dark: 5 } })
  // The coast: one shore line.
  b.shore({ lines: 1 })
  // Just off the coast: four concentric lines at an even step — the first
  // almost solid, the next ones breaking up, the last nearly gone — then a
  // breath of paper before the currents.
  b.water("lines", {
    follow: "shore",
    angle: 0,
    style: {
      space_light: 3.4, space_dark: 3.4, water_space_reach: 0,
      water_start: 3.4, water_reach: 17, water_fade: 0.55,
      dash_dark: 1, dash_light: 0.08, dash_period: 14, mod_jitter: 0.7,
    },
  })
  // The open sea: one flow over the whole map, sweeping in broad curves that
  // fan out and curl, each line evenly broken into dashes.
  b.water("lines", {
    follow: "map",
    angle: 90,
    style: {
      space_light: 5.5,
      space_dark: 5.5,
      water_start: 23,
      water_reach: 4000,
      water_fade: 0.2,
      // Where the currents begin, near the coast: ragged, breaking into
      // dashes and dots instead of starting on a hard edge.
      water_fray: 18,
      dash_light: 0.78,
      dash_dark: 0.82,
      dash_period: 22,
      // Uneven strokes and the odd extra pause, so breaks never line up
      // from one line to the next.
      mod_jitter: 0.85,
      mod_breaks: 0.15,
      mod_wobble: 75,
      mod_wobble_size: 130,
      mod_smooth: 4,
      mod_wave: 0.8,
      mod_wave_size: 80,
      mod_wave_zone: 1,
    },
  })
}, { water })

draw({ id: "lines_nature", from: nature, stroke: SOLID })

compose.filter("lines_nature", { minLength: "0.2mm" })
compose.simplify("lines_nature", "0.03mm")
compose.linesort()
