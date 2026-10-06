title("Showcase: Color and Thickness Variation")
output({
  width: "152.4mm",
  height: "101.6mm",
  scale: "1:8000",
  lat: 37.8771145,
  lng: -122.256196,
  tileZoom: 14,
})

// Showcase example demonstrating color and thickness variation
// Different colors and stroke widths for buildings, parks, and water

// Feature sources
const buildingFeatures = features.tiles("buildings")
const parkFeatures = features.tiles("landcover:park,garden,grass/grass,wood")
const waterFeatures = features.tiles("water:lake,river,pond,dock")

// Areas
const buildings = areas.polygons(buildingFeatures)
const parks = areas.polygons(parkFeatures)
const water = areas.polygons(waterFeatures)
const ocean = engine.ocean()

// Combined water areas
const allWater = areas.union(water, ocean)

// Lines
const buildingRings = lines.rings(buildings)
const parkRings = lines.rings(parks)
const waterRings = lines.rings(allWater)

// Fills
const buildingFills = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })
const parkFills = fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.2mm" })
const waterFills = fills.fill({ in: allWater, pattern: "waves", spacing: "0.75mm" })

// Draw with colors and thicknesses
draw({ 
  id: "parks_outline", 
  from: parkRings, 
  stroke: { 
    style: "dash", 
    dash: "0.45mm", 
    gap: "0.4mm", 
    color: "#228B22", 
    width: "0.3mm", 
    cap: "round" 
  } 
})

draw({ 
  id: "parks_fill", 
  from: parkFills, 
  stroke: { 
    color: "#90EE90", 
    width: "0.2mm" 
  } 
})

draw({ 
  id: "water_outline", 
  from: waterRings, 
  stroke: { 
    style: "solid", 
    color: "#4169E1", 
    width: "0.4mm", 
    cap: "round" 
  } 
})

draw({ 
  id: "water_fill", 
  from: waterFills, 
  stroke: { 
    color: "#87CEEB", 
    width: "0.25mm", 
    cap: "round" 
  } 
})

draw({ 
  id: "buildings_fill", 
  from: buildingFills, 
  stroke: { 
    color: "#A9A9A9", 
    width: "0.15mm" 
  } 
})

draw({ 
  id: "buildings_outline", 
  from: buildingRings, 
  stroke: { 
    style: "solid", 
    color: "#696969", 
    width: "0.35mm", 
    cap: "square" 
  } 
})