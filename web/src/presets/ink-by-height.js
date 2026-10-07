title("_Ink by height · Midtown")
output({
  width: "6in",
  height: "4in",
  scale: "1:12000",
  bearing: 29,
  projection: "webmercator",
  lat: 40.7585,
  lng: -73.9815,
  tileZoom: 14,
})

// Every building's height, read from the vector tiles, picks its ink: low
// blocks in a pale hairline, towers in a heavy dark line with a dense hatch.
// The bands are a plain loop, so change the heights, the colours or the widths
// and draw again.
const heights = [0, 15, 30, 60, 120, 250, 600]
const colors = ["#e9c46a", "#e76f51", "#9d3c5b", "#2b1d3f"]

const bldg = features.tiles("buildings")
const parks = areas.polygons(features.tiles("landcover:park,garden,grass"))
const water = areas.union(areas.polygons(features.tiles("water")), engine.ocean())
const streets = lines.of(features.tiles("roads"))

// Under the buildings: quiet water, green and streets, so the heights carry the page.
draw({ id: "water", from: fills.fill({ in: water, pattern: "waves", spacing: "0.9mm" }), stroke: { color: "#8fb3c9", width: 0.15 } })
draw({ id: "park", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.7mm", mark: "0.15mm" }), stroke: { color: "#9cb98a", width: 0.15 } })
draw({ id: "streets", from: streets, stroke: { color: "#d6d0c4", width: 0.12 } })

for (let i = 0; i < heights.length - 1; i++) {
  const [lo, hi] = [heights[i], heights[i + 1]]
  const t = i / (heights.length - 2)
  const band = areas.polygons(features.where(bldg, { render_height: { min: lo, max: hi } }))
  const color = ink.ramp(colors, t)
  // Taller: a closer hatch and a heavier outline.
  const hatch = fills.fill({ in: band, per: "feature", pattern: "lines", angle: 45, spacing: `${1.4 - t * 1.05}mm` })
  draw({ id: `h${lo}_fill`, from: hatch, stroke: { color, width: ink.width(0.1, 0.18, t) } })
  draw({ id: `h${lo}_ring`, from: lines.rings(band), stroke: { color, width: ink.width(0.12, 0.6, t), cap: "square" } })
}

compose.mask({ name: "bldg_cover", from: areas.polygons(bldg), occludes: ["streets", "park", "water"] })
