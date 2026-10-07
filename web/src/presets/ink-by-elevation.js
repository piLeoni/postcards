title("_Ink by elevation · Mount Tamalpais")
output({
  width: "6in",
  height: "4in",
  scale: "1:30000",
  bearing: 0,
  projection: "webmercator",
  lat: 37.915,
  lng: -122.585,
  tileZoom: 14,
})

// A contour every 40 m, each inked by its own height: sea-green at the coast,
// through ochre, to a dark umber line at the summit. Every fifth is an index
// contour, drawn heavier. Change the step, the colours or the widths in the
// loop and draw again.
const step = 40
const top = 800
const colors = ["#2a9d8f", "#8ab17d", "#e9c46a", "#bc6c25", "#5c3a21"]

const sea = engine.ocean()
// The frame's own edge closes every belt; a hair inside it, only the contours stay.
const inside = areas.grow(engine.frame(), "-0.3mm")

draw({ id: "sea", from: fills.fill({ in: sea, pattern: "dots", spacing: "0.8mm", mark: "0.12mm" }), stroke: { color: "#7aa6c2", width: 0.15 } })

for (let h = 0; h < top; h += step) {
  const t = ink.at(h, 0, top - step)
  const index = h % (step * 5) === 0
  const contour = lines.clip(lines.contours({ from: h }), inside)
  draw({
    id: `c${h}`,
    from: contour,
    stroke: { color: ink.ramp(colors, t), width: index ? ink.width(0.3, 0.6, t) : ink.width(0.1, 0.25, t) },
  })
}
