// By hand: one more line, and the same map looks drawn rather than plotted.
title("Lake Merritt")
title("Lake Merritt")
output({ lat: 37.802, lng: -122.263, width: "6in", height: "4in", scale: "1:8000" })

const bldg = features.tiles("buildings")
const buildings = areas.polygons(bldg)
const parks = areas.polygons(features.tiles("parks", "grass"))
const water = areas.polygons(features.tiles("water"))
const roads = modules.roads({ from: features.tiles("roads", "paths") })

// Two pens: blue for the water, black for everything else. A colour is a pen,
// so each pen keeps one width.
/** @type {Stroke} */
const BLUE = { color: "#2f6690" }

// Height bands, in metres: `min` is included and `max` is not, so they never overlap.
const BANDS = [
  { min: 0, max: 12, spacing: 1.2 },
  { min: 12, max: 40, spacing: 0.7 },
  { min: 40, spacing: 0.4 },
]
const tall = areas.polygons(features.where(bldg, { render_height: { min: 40 } }))

draw({ id: "water", from: fills.fill({ in: water, pattern: "waves", spacing: "0.8mm" }), stroke: BLUE })
draw({ id: "shore", from: lines.rings(water), stroke: BLUE })
draw({ id: "parks", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.6mm" }) })
draw({ id: "roads", from: roads.outlines })
draw({ id: "trails", from: roads.trails, stroke: { style: "dotted", mark: "0.1mm", gap: "0.5mm" } })
const roofs = BANDS.map((b) => {
  const band = areas.polygons(features.where(bldg, { render_height: { min: b.min, max: b.max } }))
  return draw({ id: `roofs_${b.min}`, from: fills.fill({ in: band, per: "feature", pattern: "lines", angle: 45, spacing: b.spacing }) })
})
draw({ id: "buildings", from: lines.rings(buildings) })
draw({ id: "tall", from: lines.rings(areas.grow(tall, -0.35)) })

// Names along the roads and in the parks, placed so that none covers another.
const names = modules.labels({ from: [features.tiles("road_names"), features.tiles("parks")], size: "1.8mm", minSize: "1.2mm" })
draw({ id: "names", from: names.lines })
// A title on the lake, in a box of its own.
/** @type {TextSpec} */
const heading = { at: ["74%", "50%"], text: "LAKE MERRITT", size: "4mm" }
const plate = areas.shape({ at: ["74%", "50%"], rect: [62, 11] })
draw({ id: "title", from: lines.text(heading) })
draw({ id: "plate", from: lines.rings(plate) })

// The roads clear the dots and the waves under them; a building clears everything under it.
compose.mask({ from: roads.area, occludes: ["parks", "water"] })
compose.mask({ from: buildings, occludes: ["parks", "water", "roads", "trails"] })
// The water keeps the dots out, and a hair round it keeps them off the shore line.
compose.mask({ from: areas.grow(water, "0.3mm"), occludes: ["parks"] })
// Everything drawn so far is the map; the names and the title clear it.
const map = ["water", "shore", "parks", "roads", "trails", ...roofs, "buildings", "tall"]
compose.mask({ from: names.area, occludes: map })
compose.mask({ from: plate, occludes: [...map, "names"] })
// The second outline's strip stays clear of the hatch.
compose.mask({ from: areas.difference(tall, areas.grow(tall, -0.5)), occludes: roofs })

// For the plotter: join strokes that meet, drop the crumbs, simplify, and sort
// the strokes so the pen travels as little as possible in the air.
compose.linemerge("0.1mm")
compose.filter({ minLength: "0.2mm" })
// As if by hand: a slow tremble, bowed edges, rings that miss closing.
compose.hand({ preset: "sketch" })
compose.simplify("0.05mm")
compose.linesort()
