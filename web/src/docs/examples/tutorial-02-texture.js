// Texture: the lake waved, the parks dotted, every roof hatched on its own.
title("Lake Merritt")
output({ lat: 37.802, lng: -122.263, width: "6in", height: "4in", scale: "1:8000" })

const bldg = features.tiles("buildings")
const buildings = areas.polygons(bldg)
const parks = areas.polygons(features.tiles("parks", "grass"))
const water = areas.polygons(features.tiles("water"))

draw({ id: "water", from: fills.fill({ in: water, pattern: "waves", spacing: "0.8mm" }) })
draw({ id: "shore", from: lines.rings(water) })
draw({ id: "parks", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.6mm" }) })
draw({ id: "roofs", from: fills.fill({ in: buildings, per: "feature", pattern: "lines", angle: 45, spacing: "0.6mm" }) })
draw({ id: "buildings", from: lines.rings(buildings) })
