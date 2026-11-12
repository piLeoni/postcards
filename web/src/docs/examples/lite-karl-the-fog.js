title("Karl the Fog (lite)")
output({ width: "6in", height: "4in", scale: "1:15000", lat: 37.7687541, lng: -122.483286, tileZoom: 14, padding: "0.1in" })
// Karl the Fog: San Francisco's fog over Golden Gate Park, seen from above.
// A plain city plan underneath; on top, penfill's `clouds`. `fills.cover`
// gives the clouds' footprint, which hides the map under them, and
// `areas.move` slides that footprint down-sun to cast their shadow.
// The full preset is Karl the Fog in the gallery.

// ── 1. Parameters & palette ─────────────────────────────────────────────
const PEN = 0.2
const pen = (k) => PEN * k
/** @type {Stroke} */
const INK = { style: "solid", width: pen(1), cap: "round" }

/** @type {FillStyle} */
const CLOUDS = {
  pattern: "clouds",
  spacing: pen(25),     // one puff: 5 mm
  cell: pen(220),       // the size of a cloud mass and the clear sky between them
  coverage: 0.38,       // share of the sky under cloud
  light_angle: 225,     // the sun, from the top left
  light_elevation: 30,
  seed: 4,
}
const SHADOW_DROP = pen(40)  // how far a shadow falls from its cloud: the clouds' height
/** @type {FillStyle} */
const SHADOW = { pattern: "stipple", spacing: pen(2.6), mark: pen(0.6) }
/** @type {FillStyle} */
const PARK = { pattern: "dots", spacing: pen(3.75), mark: pen(1.1), angle: 30 }
/** @type {FillStyle} */
const SEA = { pattern: "waves", spacing: pen(3.75) }

// ── 2. Data & geometry: the city ────────────────────────────────────────
const sky = engine.frame()
const roads = modules.roads({ from: features.tiles("roads") })
const buildings = areas.polygons(features.tiles("buildings"))
const water = areas.union(areas.polygons(features.tiles("water")), areas.extendToFrame(areas.intersect(areas.polygons(features.tiles("ocean")), sky), sky))
const park = areas.difference(areas.polygons(features.tiles("parks", "grass", "forest")), water, roads.area)

// ── 2b. The clouds ──────────────────────────────────────────────────────
// The footprint of the very fill drawn below (same options, one penfill run).
const cloudCover = fills.cover({ in: sky, ...CLOUDS })
// The sun shines from `light_angle`; the shadow falls the other way.
const sun = (CLOUDS.light_angle * Math.PI) / 180
const cast = areas.move(cloudCover, [-Math.cos(sun) * SHADOW_DROP, -Math.sin(sun) * SHADOW_DROP])
// Only the part of the shadow that lands on the paper and is not under a cloud.
const shadow = areas.difference(areas.intersect(cast, sky), cloudCover)

// ── 3. Draws ────────────────────────────────────────────────────────────
const map = [
  draw({ id: "sea", from: fills.fill({ in: water, ...SEA }), stroke: INK }),
  draw({ id: "shore", from: lines.clip(lines.rings(water), areas.grow(sky, -0.25)), stroke: INK }),
  draw({ id: "park", from: fills.fill({ in: park, ...PARK }), stroke: INK }),
  draw({ id: "roads", from: roads.outlines, stroke: INK }),
  draw({ id: "buildings", from: lines.rings(buildings), stroke: INK }),
]
draw({ id: "cloud_shadow", from: fills.fill({ in: shadow, ...SHADOW }), stroke: INK })
draw({ id: "clouds", from: fills.fill({ in: sky, ...CLOUDS }), stroke: INK })

// ── 4. Masks: roads over the park, clouds over everything ───────────────
compose.mask({ name: "under_roads", from: roads.area, occludes: ["park", "buildings"] })
compose.mask({ name: "under_clouds", from: cloudCover, occludes: map })
compose.linesort()
