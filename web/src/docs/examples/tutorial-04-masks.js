// Masks: order only stacks the layers; a mask hides exactly the layers it names.
title("Lake Merritt")
output({ lat: 37.802, lng: -122.263, width: "6in", height: "4in", scale: "1:8000" })

const bldg = features.tiles("buildings")
const buildings = areas.polygons(bldg)
const parks = areas.polygons(features.tiles("parks", "grass"))
const water = areas.polygons(features.tiles("water"))
const roads = modules.roads({ from: features.tiles("roads", "paths") })

draw({ id: "water", from: fills.fill({ in: water, pattern: "waves", spacing: "0.8mm" }) })
draw({ id: "shore", from: lines.rings(water) })
draw({ id: "parks", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.6mm" }) })
draw({ id: "roads", from: roads.outlines })
draw({ id: "trails", from: roads.trails, stroke: { style: "dotted", mark: "0.1mm", gap: "0.5mm" } })
draw({ id: "roofs", from: fills.fill({ in: buildings, per: "feature", pattern: "lines", angle: 45, spacing: "0.6mm" }) })
draw({ id: "buildings", from: lines.rings(buildings) })

// The roads clear the dots and the waves under them; a building clears everything under it.
compose.mask({ from: roads.area, occludes: ["parks", "water"] })
compose.mask({ from: buildings, occludes: ["parks", "water", "roads", "trails"] })
// The water keeps the dots out, and a hair round it keeps them off the shore line.
compose.mask({ from: areas.grow(water, "0.3mm"), occludes: ["parks"] })
