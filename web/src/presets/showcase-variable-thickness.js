title("Showcase: Line weight by feature")
output({
  width: "152.4mm",
  height: "101.6mm",
  scale: "1:8000",
  lat: 37.8771145,
  lng: -122.256196,
  tileZoom: 14,
})

// Roads heavier than buildings: each layer its own colour, width and cap.

// Feature sources
const buildingFeatures = features.tiles("buildings")
const roadFeatures = features.tiles("roads", "paths")

// Areas
const buildings = areas.polygons(buildingFeatures)
const roads = modules.roads({ from: roadFeatures })

// Lines
const buildingRings = lines.rings(buildings)

// Fills
const buildingFills = fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 })

// Draw with hierarchical styling
draw({ 
  id: "buildings_fill_light", 
  from: buildingFills, 
  stroke: { 
    color: "#D3D3D3", 
    width: "0.1mm", 
    cap: "round" 
  } 
})

draw({ 
  id: "buildings_outline_medium", 
  from: buildingRings, 
  stroke: { 
    style: "solid", 
    color: "#A9A9A9", 
    width: "0.25mm", 
    cap: "square" 
  } 
})

draw({ 
  id: "roads_main", 
  from: roads.outlines, 
  stroke: { 
    style: "solid", 
    color: "#FF0000", 
    width: "0.5mm", 
    cap: "round" 
  } 
})

draw({ 
  id: "roads_secondary", 
  from: roads.trails, 
  stroke: { 
    style: "solid", 
    color: "#FF6347", 
    width: "0.35mm", 
    cap: "round" 
  } 
})

draw({ 
  id: "roads_centerlines", 
  from: roads.centerlines, 
  stroke: { 
    style: "dash", 
    dash: "0.3mm", 
    gap: "0.35mm", 
    color: "#8B0000", 
    width: "0.2mm", 
    cap: "butt" 
  } 
})