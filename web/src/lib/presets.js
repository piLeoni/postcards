/**
 * The card documents this app ships, matching the CLI's configs. The app
 * starts from one of these and edits it in the sidebar; the text is what
 * `render` takes, so anything the CLI reads, the page reads too.
 *
 * Checked against the parser: `examples/check_web_presets.rs` runs the parser
 * over each one, so a preset that stops parsing fails a test rather than a
 * browser. `examples/wasm_render.rs` renders them from a canned Overpass reply.
 */

/**
 * Everything: parks, water, roads and buildings, in the CLI's own order and
 * with its masks. This is the card the plotter gets. Its data comes from
 * OpenFreeMap's vector tiles (`tiles_select`): no Overpass.
 */
export const FULL_DOC = `card:
  width: 6in
  height: 4in
  scale: "1:8000"
  bearing: 0
  projection: utm
  lat: 37.8771145
  lng: -122.256196

$features:
  bldg:  { tiles_select: buildings }
  green: { tiles_select: "landcover:park,garden,grass/grass,wood" }
  wet:   { tiles_select: "water:lake,river,pond,dock" }
  ways:  { tiles_select: [roads, paths] }

$areas:
  roads:     { module_roads: { from: $features.ways } }
  buildings: { tools_polygons: $features.bldg }
  parks:     { tools_polygons: $features.green }
  inland:    { tools_polygons: $features.wet }
  sea:       { engine_ocean: {} }
  water:     { tools_union: [$areas.inland, $areas.sea] }

$lines:
  park_ring: { tools_rings: $areas.parks }
  bldg_ring: { tools_rings: $areas.buildings }
  water_ring: { tools_rings: $areas.water }

$fills:
  park_fill:  { tools_fill: { in: $areas.parks, pattern: dots, spacing: 0.45mm, mark: 0.2mm, angle: 45 } }
  water_fill: { tools_fill: { in: $areas.water, pattern: waves, spacing: 0.75mm } }
  bldg_fill:  { tools_fill: { in: $areas.buildings, per: feature, pattern: zigzag, spacing: 0.4mm, angle: 45 } }

draw:
  - { id: park_ring,  from: $lines.park_ring, stroke: { style: dash, dash: 0.45mm, gap: 0.4mm } }
  - { id: park_fill,  from: $fills.park_fill }
  - { id: water_ring, from: $lines.water_ring, stroke: solid }
  - { id: water_fill, from: $fills.water_fill }
  - { id: roads_out,  from: roads.outlines, stroke: solid }
  - { id: roads_trail, from: roads.trails, stroke: solid }
  - { id: roads_center, from: roads.centerlines, stroke: { style: dash, dash: 0.3mm, gap: 0.35mm } }
  - { id: roads_seam, from: roads.seams, stroke: solid }
  - { id: bldg_fill,  from: $fills.bldg_fill }
  - { id: bldg_ring,  from: $lines.bldg_ring, stroke: solid }

compose:
  order:
    - park_ring
    - park_fill
    - water_ring
    - water_fill
    - roads_out
    - roads_trail
    - roads_center
    - roads_seam
    - bldg_fill
    - bldg_ring
  masks:
    parks_cover:
      from: $areas.parks
      occludes: [water_fill, water_ring, roads_out, roads_trail, roads_center, roads_seam, bldg_fill, bldg_ring]
    wet_cover:
      from: $areas.water
      occludes: [park_ring, park_fill, roads_out, roads_trail, roads_center, roads_seam, bldg_fill, bldg_ring]
    roads_cover:
      from: roads.area
      occludes: [park_ring, park_fill, water_ring, water_fill]
    bldg_cover:
      from: $areas.buildings
      occludes: [park_ring, park_fill, water_ring, water_fill, roads_out, roads_trail, roads_center, roads_seam]
`

/** Buildings and green only: the quickest to fetch and draw. */
export const DEFAULT_DOC = `card:
  width: 6in
  height: 4in
  scale: "1:8000"
  bearing: 0
  projection: utm
  lat: 37.8771145
  lng: -122.256196

$features:
  bldg:  { tiles_select: buildings }
  green: { tiles_select: "landcover:park,garden" }
  wet:   { tiles_select: "water:lake,river,pond,dock" }

$areas:
  buildings: { tools_polygons: $features.bldg }
  parks:     { tools_polygons: $features.green }
  inland:    { tools_polygons: $features.wet }
  sea:       { engine_ocean: {} }
  water:     { tools_union: [$areas.inland, $areas.sea] }

$lines:
  bldg_ring: { tools_rings: $areas.buildings }
  park_ring: { tools_rings: $areas.parks }

$fills:
  bldg_fill: { tools_fill: { in: $areas.buildings, per: feature, pattern: zigzag, spacing: 0.4mm, angle: 45 } }
  park_fill: { tools_fill: { in: $areas.parks, pattern: dots, spacing: 0.45mm, mark: 0.2mm } }
  water_fill: { tools_fill: { in: $areas.water, pattern: waves, spacing: 0.75mm } }

draw:
  - { id: park_ring,  from: $lines.park_ring, stroke: { style: dash, dash: 0.45mm, gap: 0.4mm } }
  - { id: park_fill,  from: $fills.park_fill }
  - { id: water_fill, from: $fills.water_fill }
  - { id: bldg_fill,  from: $fills.bldg_fill }
  - { id: bldg_ring,  from: $lines.bldg_ring, stroke: solid }

compose:
  order: [park_ring, park_fill, water_fill, bldg_fill, bldg_ring]
`

/** Just buildings: the fastest draw there is. */
export const SMALL_DOC = `card:
  width: 80mm
  height: 60mm
  scale: "1:4000"
  lat: 37.8771145
  lng: -122.256196

$features:
  bldg: { tiles_select: buildings }

$areas:
  buildings: { tools_polygons: $features.bldg }

$lines:
  bldg_ring: { tools_rings: $areas.buildings }

$fills:
  bldg_fill: { tools_fill: { in: $areas.buildings, per: feature, pattern: zigzag, spacing: 0.4mm, angle: 45 } }

draw:
  - { id: bldg_fill, from: $fills.bldg_fill }
  - { id: bldg_ring, from: $lines.bldg_ring, stroke: solid }

compose:
  order: [bldg_fill, bldg_ring]
`

/**
 * The everything card with its data from Overpass instead (`osm_select`):
 * every OSM tag, road widths from \`width\` and \`lanes\`, but a busy server.
 */
export const OVERPASS_DOC = FULL_DOC.replace(
  /\$features:[\s\S]*?\n\n\$areas:\n  roads: +\{ module_roads: \{ from: \$features.ways \} \}/,
  `$features:
  bldg:  { osm_select: { building: true } }
  green: { osm_select: { leisure: [park, garden], landuse: [grass, forest], natural: wood } }
  wet:   { osm_select: { water: true, natural: water } }

$areas:
  roads:     { module_roads: {} }`,
)

/**
 * The everything card with each layer from the source that suits it: roads
 * from Overpass (widths and lanes), in a request for \`highway\` alone, so
 * small and more likely to get through; the rest and the sea from tiles.
 */
export const MIXED_DOC = FULL_DOC.replace(
  '  ways:  { tiles_select: [roads, paths] }',
  '  ways:  { osm_select: { highway: true } }',
)

export const PRESETS = [
  {
    id: 'full',
    name: 'Everything · vector tiles',
    hint: 'roads, trails, parks, water, buildings; all from OpenFreeMap',
    doc: FULL_DOC,
  },
  {
    id: 'mixed',
    name: 'Everything · tiles, roads from Overpass',
    hint: 'the same card; only the roads asked of Overpass',
    doc: MIXED_DOC,
  },
  {
    id: 'overpass',
    name: 'Everything · Overpass',
    hint: 'the same card, all from Overpass',
    doc: OVERPASS_DOC,
  },
  {
    id: 'parks',
    name: 'Parks and buildings',
    hint: 'green, water, buildings',
    doc: DEFAULT_DOC,
  },
  {
    id: 'buildings',
    name: 'Buildings only',
    hint: 'the fastest draw',
    doc: SMALL_DOC,
  },
]
