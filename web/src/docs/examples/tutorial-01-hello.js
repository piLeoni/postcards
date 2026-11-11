// Hello, map: a place, a sheet of paper, and the buildings' outlines.
title("Lake Merritt")
output({ lat: 37.802, lng: -122.263, width: "6in", height: "4in", scale: "1:8000" })

const bldg = features.tiles("buildings")
const buildings = areas.polygons(bldg)

draw({ id: "buildings", from: lines.rings(buildings) })
