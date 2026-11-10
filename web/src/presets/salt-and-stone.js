title("Salt and stone")
output({
  width: "15in",
  height: "10in",
  scale: "1:250000",   // terrain 59.2 × 39.5 mi
  bearing: 0,
  projection: "webmercator",
  lat: 21.4751284,
  lng: -157.9748539,
  tileZoom: 10,
  padding: "0.1in",
})

// Pure nature, all burin: nothing built is drawn. The land in burin's classic
// hand-drawn contours, the coast in a few concentric lines, and the sea in
// swirling currents that curl as the flow turns (burin-map's
// `ocean-currents`). Burin's own wobble gives the hand; no `compose.hand`, which
// at this scale would push neighbouring strokes over each other.

// Two pens: the sea and the coast in blue, the ground in brown.
const INK = { water: "#1f5fa8", ground: "#8a5a35" }
/** @param {string} color @returns {Stroke} */
const pen = (color) => ({ style: "solid", width: "0.2mm", cap: "round", color })
/** The coast line goes with the water's pen: the water grown by a hair takes it. */
const COAST_TAKE = "0.15mm"

// How much sparser the sea is drawn than the land: every water line spacing
// is multiplied by this, so the land reads denser and darker than the water
// around it. 1 draws both alike.
const SEA_SPARSITY = 1.7
/** A water line spacing in burin px, thinned by `SEA_SPARSITY`. @param {number} px */
const sea = (px) => +(px * SEA_SPARSITY).toFixed(2)

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
      space_light: sea(3.4), space_dark: sea(3.4), water_space_reach: 0,
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
      space_light: sea(5.5),
      space_dark: sea(5.5),
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

// One burin drawing, split by the water into two pens.
const wet = areas.grow(water, COAST_TAKE)
draw({ id: "lines_ground", from: lines.clip(nature, wet, { invert: true }), stroke: pen(INK.ground) })
draw({ id: "lines_water", from: lines.clip(nature, wet), stroke: pen(INK.water) })

const layers = ["lines_ground", "lines_water"]
compose.filter(layers, { minLength: "0.2mm" })
compose.simplify(layers, "0.03mm")
compose.linesort()
