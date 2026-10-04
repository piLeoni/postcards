// Contour belts, stacked in a loop over the elevation under the output.
//
// The belts are burin fills of a height band: each loop pass is its own layer,
// and they sit on top of the hatching rather than competing with it.
title("Contours")

output({ width: "6in", height: "4in", scale: "1:20000", bearing: 0, projection: "webmercator", lat: 37.8771145, lng: -122.256196 })

// The hatching, light, under the belts.
draw({ id: "hatch", from: lines.terrain({ color: "#b9ad93", style: { line_space: 6 } }), stroke: "solid" })

// A belt every 40 m, up the hill: darker as it climbs.
const steps = [0, 40, 80, 120, 160, 200, 240, 280]
for (let i = 0; i < steps.length - 1; i++) {
  const from = steps[i]
  const to = steps[i + 1]
  const ink = Math.round(150 - (i * 150) / (steps.length - 2))
  draw({
    id: `belt_${from}`,
    from: lines.contours({ from, to, color: `rgb(${ink}, ${Math.round(ink * 0.9)}, ${Math.round(ink * 0.7)})` }),
    stroke: "solid",
  })
}
