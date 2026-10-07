title("_Ink by distance · the Seine")
output({
  width: "6in",
  height: "4in",
  scale: "1:10000",
  bearing: 0,
  projection: "webmercator",
  lat: 48.8575,
  lng: 2.2945,
  tileZoom: 14,
})

// Where a building stands decides its ink: the river grown out in steps makes
// rings of distance, and each ring draws the buildings inside it in its own
// colour, from the river's blue to a warm red far inland. Roads are weighted
// by their class in the tiles.
const water = areas.polygons(features.tiles("water"))
const buildings = areas.polygons(features.tiles("buildings"))
const roads = features.tiles("roads")

const colors = ["#1d4e89", "#2a9d8f", "#e9c46a", "#d1495b"]
const step = 1.5 // mm on paper: 150 m at 1:10000
const rings = 7

draw({ id: "river", from: fills.fill({ in: water, pattern: "waves", spacing: "0.6mm" }), stroke: { color: "#1d4e89", width: 0.2 } })
draw({ id: "bank", from: lines.rings(water), stroke: { color: "#1d4e89", width: 0.45 } })

// Major roads heavy and dark, the rest thinner and paler: `where` on the tile's class.
const classes = [
  [["motorway", "trunk", "primary"], "#3d3d3d", 0.5],
  [["secondary", "tertiary"], "#6b6b6b", 0.3],
  [["minor", "service"], "#a8a8a8", 0.15],
]
for (const [kinds, color, width] of classes) {
  draw({ id: `road_${kinds[0]}`, from: lines.of(features.where(roads, { class: kinds })), stroke: { color, width } })
}

let near = water
for (let i = 0; i < rings; i++) {
  const t = i / (rings - 1)
  const far = i === rings - 1 ? engine.frame() : areas.grow(water, `${step * (i + 1)}mm`)
  const here = areas.intersect(buildings, areas.difference(far, near))
  const color = ink.ramp(colors, t)
  // Closer to the water: a denser hatch and a heavier line.
  draw({
    id: `d${i}_fill`,
    from: fills.fill({ in: here, per: "feature", pattern: "lines", angle: 45 + i * 15, spacing: `${0.45 + t * 0.6}mm` }),
    stroke: { color, width: 0.15 },
  })
  draw({ id: `d${i}_ring`, from: lines.rings(here), stroke: { color, width: ink.width(0.5, 0.15, t) } })
  near = far
}

compose.mask({ name: "bldg_cover", from: buildings, occludes: ["road_motorway", "road_secondary", "road_minor"] })
