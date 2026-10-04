title("Buildings only")
output({ width: "80mm", height: "60mm", scale: "1:4000", lat: 37.8771145, lng: -122.256196 })

// Just buildings: the fastest draw there is.
const footprints = areas.polygons(features.tiles("buildings"))
draw({ id: "bldg_fill", from: fills.fill({ in: footprints, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 }) })
draw({ id: "bldg_ring", from: lines.rings(footprints), stroke: "solid" })
