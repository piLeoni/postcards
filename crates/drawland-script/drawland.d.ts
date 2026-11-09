// The draw.land library: everything a profile script can call.
//
// This file is the library's description. The web editor checks scripts
// against it (autocomplete, argument docs, and lines passed where an area
// goes are underlined); `docs/library.md` is written from it; the crate's
// tests keep it in step with `library.js`, with penfill's patterns and with
// terramask's presets.

/** Features picked from the map data: they are not drawn, areas and lines are made from them. */
declare class Features {
  private readonly __features: never
}
/** Polygons in output millimetres: what fills go in, masks hide with, and rings outline. */
declare class Area {
  private readonly __area: never
}
/** Lines in output millimetres: what `draw` puts on paper. */
declare class Lines {
  private readonly __lines: never
}

/** A length: a number of millimetres, or a string with a unit (`"0.5mm"`, `"6in"`, `"2cm"`). */
type Length = number | `${number}mm` | `${number}cm` | `${number}in` | `${number}m`

/** One value or several, or `true` for any value and `false` for none. */
type TagValue = string | string[] | boolean

/** OSM tags, any of which selects a feature: `{ building: true }`, `{ leisure: ["park", "garden"] }`. */
interface Tags {
  [tag: string]: TagValue | Record<string, TagValue> | undefined
  /** Tags that drop a feature even when another tag selected it. */
  except?: Record<string, TagValue>
  /** Keep features below ground (tunnels, `layer < 0`); dropped by default. */
  underground?: boolean
}

/** A terramask preset, or a rule `layer:class,class` on the OpenMapTiles layers (`landcover:park,garden`). */
type TilePreset =
  | "water" | "ocean" | "lakes" | "rivers" | "land" | "forest" | "glacier" | "wetland" | "sand" | "rock"
  | "grass" | "farmland" | "parks" | "urban" | "buildings" | "roads" | "paths" | "road_names" | "rail"
  | `${string}:${string}`

/** A penfill pattern. */
type Pattern =
  | "amphibolite" | "arena" | "beds" | "bentonite" | "brackets" | "breccia" | "breccia-blobs" | "canopy" | "cell-net" | "chalky-soil"
  | "chess" | "clay-soil" | "coal" | "coarse-stone" | "compacted-soil" | "concentric" | "conglomerate"
  | "conglomerate-flat" | "coquina" | "cracked-earth" | "cracks" | "curl-waves" | "dacite" | "debris-soil" | "diabase" | "diatom"
  | "diorite" | "doodle-trees" | "dots" | "drift" | "dry-cracked-soil" | "eddies" | "erosion-lines" | "feldspar" | "ferrous" | "fill" | "fine-gravel" | "flow-waves"
  | "fluid-grass" | "gabbro" | "gneiss" | "grainy-soil" | "granite" | "granite-x" | "grass" | "gravel" | "gravel-clipped"
  | "gravelly-soil" | "grid" | "growth" | "hilbert" | "honeycomb" | "hornblende" | "isoline-blobs" | "isoline-stack" | "isoline-stack-hatched" | "laminae" | "lava" | "layered-soil" | "lily-pads"
  | "lines" | "loose-soil" | "marble" | "masonry" | "mixed-rocks" | "mulch" | "mulched-soil" | "none" | "ophitic"
  | "organic-topsoil" | "pat" | "pebble-scatter" | "pebbled-soil" | "pebbles" | "rectilinear" | "ripples" | "sandy-soil" | "scales" | "scallop-waves"
  | "scribble" | "shards" | "silty-soil" | "solid" | "spiral" | "sprouts" | "stipple" | "stipple-edge" | "stipple-noise"
  | "stone-cluster" | "sunburst" | "swells" | "terrazzo" | "triangles" | "truchet" | "tufts" | "twigs" | "vines" | "wave-grid" | "wave_grid" | "waves" | "wood"
  | "zigzag"

/** A built-in hatch for `pattern: "pat"`. */
type PatName =
  | "BRICK" | "HERRINGBONE" | "BASKET" | "PARQUET" | "ANSI31" | "ANSI32" | "ANSI33" | "ANSI37" | "EARTH" | "CROSS"
  | "DASH" | "STAIRS" | "GRATE" | "ANGLE"

interface FillOptions {
  /** The area to fill. */
  in: Area
  /** `"feature"`: one pattern per polygon (each building hatched on its own) instead of one over the union. */
  per?: "feature"
  /** The pattern; or leave it out and give a `source` or a `content`. */
  pattern?: Pattern
  /** Lines to fill the area with, cut to it: a burin document, or any `lines.*`. */
  content?: Lines
  /** Distance between lines, rows or dots. Default 0.5mm. */
  spacing?: Length
  /** Degrees; most patterns default to 0 (zigzag and lines to 45). */
  angle?: number
  /** Dot or mark size, for `dots` and `stipple`. Default 0.2mm. */
  mark?: Length
  /** Shrink the area first. `waves` default to 0.1mm. */
  inset?: Length
  /** Perimeter-aware edge fade width: lines break into shorter dashes/dots and disappear before the boundary. */
  fray?: Length
  /** For the random patterns: the same seed draws the same lines. */
  seed?: number
  /** `"global"` (default): neighbouring areas share one grid. `"local"`: each shape on its own. */
  anchor?: "global" | "local"
  /** Move the grid, across and down. */
  shift?: [Length, Length]
  /** Centre the pattern here, in output millimetres (sunburst, spiral). */
  centre?: [Length, Length]
  /** `dots`: a square or a hexagonal lattice. */
  lattice?: "square" | "hexagonal"
  /** `honeycomb`: double the walls this far apart. `growth`: the pen width, so trunk passes sit side by side. Default 0.15 for `growth`. */
  line_width?: Length
  /** `terrazzo`: the hatch inside the stones. `isoline-stack` with `light`: shading hatch spacing in mm, `0` for none. Default 0.4. */
  hatch?: Length
  /** `chess`: the size of a square. */
  cell?: Length
  /** `pat`: which hatch. */
  name?: PatName
  /** `pat`: the hatch's size. */
  scale?: Length
  /** An SVG drawn into the area instead of a pattern. */
  source?: { file: string; size?: string; position?: string; repeat?: string }
  /** Screen-style flat colour under the hatch (SVG fill, not pen ink). */
  background?: string
  /** `isoline-stack`: `clip` cuts at the border; `inside` closes inside it; `overflow` bulges past. Default `clip`. */
  edge?: "clip" | "inside" | "overflow"
  /** `isoline-stack` with `edge: "overflow"`: how far past the border, in mm. Default ~0.4× `spacing`. */
  overflow?: Length
  /**
   * `isoline-stack` / `isoline-blobs`: how patchy the crowns are (0–1), not
   * “this fraction of the polygon’s area”. Low values leave more clearings;
   * `1` fills everywhere the generator allows. Default 0.6.
   */
  coverage?: number
  /** `isoline-stack`: typical bubble radius in mm; smaller is lumpier. Default ~0.3× `spacing`. */
  bubble?: Length
  /** `isoline-stack`: horizontal slices through the stack; more rings. Default 9. */
  slices?: number
  /**
   * `isoline-stack`: contour displacement intensity (`jaggedness`, 0–2.5).
   * `growth`: steering wobble (0–1ish). Default 1.1 for `isoline-stack`, 0.1 for `growth`.
   */
  jitter?: number
  /**
   * `isoline-stack`: jitter wavelength — how many control points sit on each contour
   * (0.2–4; lower = finer serration). Alias: `period`. Default 0.68.
   */
  jitter_period?: number
  /** Alias for `jitter_period`. */
  period?: number
  /**
   * `isoline-stack`: short cross-contour slope ticks at bough clefts and shadowed
   * tiers (0–1.5). Default 0.42.
   */
  ticks?: number
  /** `isoline-stack`: crown elliptical elongation / wind sweep (0–1). Default 0.18. */
  elongation?: number
  /** `isoline-stack`: bough cleft depth and compound sub-crown lobing (0–2.5). Default 1.0. */
  lobes?: number
  /**
   * `isoline-stack`: directional sun strength (0–1). Default 0.82. Lit-side arcs,
   * shadow-side density; use `ticks` for cross-contour hachures.
   */
  light?: number
  /** `isoline-stack` with `light`: degrees the light comes *from* (0 = +x, 90 = +y). Default -45. `doodle-trees`: side the shadow scribble avoids. Default 225. */
  light_angle?: number
  /** `doodle-trees` (`spacing` = crown diameter): curls round each crown's rim, as a multiple of the default. Default 1. */
  loops?: number
  /** `doodle-trees`: share of crowns (0–1) with a shade crescent. Default 0.8. */
  shadow?: number
  /** `curl-waves` (`spacing` = gap between rows): distance between waves along a row, × `spacing`. Default 1.35. `flow-waves` (`spacing` = gap between lines): length of one swell, × `spacing`. Default 13. */
  wavelength?: number
  /** `flow-waves`: swell height, × `spacing`. Default 2.6. */
  amplitude?: number
  /** `flow-waves`: how fast the swell's height and phase change across the sea. Default 1. */
  drift?: number
  /** `flow-waves`: how broken the lines are (0–1, 0 = unbroken). Default 0.5. */
  breaks?: number
  /** `scallop-waves` (`spacing` = gap between rows; `wavelength` = scallop width × spacing, default 1.35): how far each scallop dips, × `spacing`. Default 0.35. */
  depth?: number
  /** `scallop-waves`: arc shape, below 1 rounder, above 1 more pointed. Default 0.8. */
  round?: number
  /** `curl-waves`: radius of each curl, × the wavelength. Default 0.2. */
  curl?: number
  /** `curl-waves`: how far each curl winds in (1 = one full turn). Default 0.95. */
  turns?: number
  /** `curl-waves`: shift every other row by this share of a wave (0–1). Default 0. */
  stagger?: number
  /** `curl-waves`: 1 mirrors the waves so they break the other way. Default 0. */
  flip?: number
  /** `isoline-stack` with `light`: sun height in degrees; lower casts longer shadows. Default 35. */
  light_elevation?: number
  /** `isoline-blobs`: distance between contour lines in mm. Default ~0.045× `spacing`. */
  contour?: Length
  /** `isoline-blobs`: domain warp of the field (0–1). Default 0.45. */
  warp?: number
  /** `isoline-blobs`: field level for patches and coverage (0–1). Default 0.25. */
  threshold?: number
  /**
   * `growth`: dendritic branches grown toward a field of attractor points
   * (space colonization) — river deltas, veins, cracks, roots, lichen;
   * `spacing` is the gap between neighbouring twigs. How many roots it
   * grows from. Default: one per `root_spacing`.
   */
  roots?: number
  /** `growth`: roots this far apart, each draining its own basin. Default ~12× `spacing`. */
  root_spacing?: Length
  /** `growth`: how much trees differ in size (0–1): uneven root spacing, big crowns next to saplings. Default 0.35. */
  variation?: number
  /** `growth`: most pen passes on a trunk; thick near the roots, hairline at the twigs. Default 3. */
  trunk?: number
  /** `growth`: how far a branch advances per step, in mm. Default ~0.16× `spacing`. */
  step?: Length
  /** `growth`: an attractor beyond this from every branch tip pulls nothing. Default ~3.2× `spacing`. */
  reach?: Length
  /** `growth`: an attractor this close to a tip is consumed, in mm. Default ~0.4× `spacing`. */
  kill?: Length
  /** `growth`: a hard cap on growth steps, so a pathological shape cannot hang. Default 20000. */
  max_steps?: number
}

/** `solid`, `dash`, `dotted`, `none`, or an object: the dashes' sizes and the ink (`color`, `width` in mm, `cap`). */
type Stroke =
  | "solid" | "dash" | "dotted" | "none"
  | { style?: "solid" | "dash" | "dotted" | "none"; dash?: Length; gap?: Length; mark?: Length; color?: string; width?: Length; cap?: "round" | "square" | "butt"; join?: "round" | "miter" | "bevel" }

interface DrawOptions {
  /** The SVG group's id; a plotter can give each group its own pen. */
  id?: string
  /** The lines to draw. */
  from: Lines
  /** How the lines are inked. Without one, as they are (fills are already lines). */
  stroke?: Stroke
}

interface OutputOptions {
  /** Where: looked up with Nominatim when there is no `lat`/`lng`. */
  address?: string
  lat?: number
  lng?: number
  /** The paper. Default 6in × 4in. */
  width?: Length
  height?: Length
  /** `"1:10000"`, or the denominator. */
  scale?: `1:${number}` | number
  /** Degrees clockwise. */
  bearing?: number
  /** `"webmercator"` (the web map, north up), `"utm"` (true distances), or a PROJ string with `{lat}` and `{lng}`. */
  projection?: "webmercator" | "utm" | `+proj=${string}`
  /** Blank margin inside the paper's edge: one length, or across and down. */
  padding?: Length | [Length, Length]
  /** The output cut into sheets. */
  slices?: { columns?: number; rows?: number; gutter?: Length | [Length, Length] }
  /** Bend the ground before drawing; the paper's edge stays. */
  warp?: Warp | Warp[]
  /**
   * The vector tiles' zoom, up to 14: deeper holds every building (none below
   * 13), shallower downloads fewer tiles. Unset, the deepest under the cap.
   */
  tileZoom?: number
}

type Warp = { fisheye: number } | { twirl: number } | { wave: { amplitude: Length; wavelength: Length } }

/** What the roads module publishes. */
interface Roads {
  /** Every road's surface, and the strip each trail and railway covers: a mask for what roads cover. */
  readonly area: Area
  /** The roads' edges. */
  readonly outlines: Lines
  /** The centre lines and the seams together. */
  readonly details: Lines
  /** Paths and tracks, as single lines. */
  readonly trails: Lines
  /** The centre lines of the roads, to dash. */
  readonly centerlines: Lines
  /** Where a bridge's edges meet the roads under it. */
  readonly seams: Lines
  /**
   * Railways, as single lines: only when the features include them,
   * `modules.roads({ from: features.tiles("roads", "rail") })`. Their track
   * bed is part of `area`, so whatever `area` masks keeps clear of them.
   */
  readonly rails: Lines
}

/** Map data to build from. */
declare const features: {
  /** OSM features with any of these tags, from Overpass. */
  osm(tags: Tags): Features
  /** Features from OpenFreeMap's vector tiles: presets (`"buildings"`) or rules (`"landcover:park,garden"`). No Overpass. */
  tiles(...items: (TilePreset | TilePreset[])[]): Features
  /**
   * The features whose tags pass every test: a value, a list of them, `true`
   * or `false` for present or absent, or a numeric range, `min` included and
   * `max` not. Ranges side by side split a set into bands, each drawn with
   * its own ink:
   *
   *   features.where(buildings, { render_height: { min: 20, max: 40 } })
   *
   * Tile features carry the vector tile's attributes (`render_height`,
   * `class`, `rank`, `brunnel`); OSM features their tags (`building:levels`).
   */
  where(of: Features, tags: Record<string, TagValue | number | { min?: number; max?: number }>): Features
}

/** Ink worked out from data, for a stroke's `color` and `width`. */
declare const ink: {
  /** The colour at `t` (0 to 1) along evenly spaced `stops`: `ink.ramp(["#fde68a", "#7c2d12"], 0.5)`. */
  ramp(stops: string[], t: number): string
  /** The width at `t` (0 to 1) between `thin` and `thick`: `ink.width(0.1, 0.6, 0.5)` is `"0.35mm"`. */
  width(thin: number | `${number}mm`, thick: number | `${number}mm`, t: number): `${number}mm`
  /** Where `v` sits between `lo` and `hi`, kept to 0 to 1: what `ramp` and `width` take. */
  at(v: number, lo: number, hi: number): number
}

/** Polygons, and what can be done with them. */
declare const areas: {
  /**
   * A band of the elevation as an area: between two heights (`elevMin`,
   * `elevMax`), or two depths below the sea (`depthMin`, `depthMax`), in
   * metres; unset limits are open. The belts an atlas tints — fill it with
   * `pattern: "solid"`. `blur` (px, default 4) smooths the heights before the cut — raise it (15–20) for the sea floor, whose coarse source data otherwise shows as rows of specks; `in`
   * keeps it to an area.
   */
  band(where: TerrainWhere, options?: { in?: Area; blur?: number }): Area
  /** The features' polygons, merged into one area. */
  polygons(of: Features): Area
  /** Everything in any of the areas. */
  union(...areas: (Area | Area[])[]): Area
  /** `base` without the parts in any of `cut`; with nothing to cut, `base` itself. */
  difference(base: Area, ...cut: (Area | Area[])[]): Area
  /** The part of `base` inside `keep`. */
  intersect(base: Area, keep: Area): Area
  /** The area with its holes closed (lakes inside parks, yards inside blocks). */
  fillHoles(of: Area): Area
  /** Grown by a length; a negative one shrinks it. */
  grow(of: Area, by: Length): Area
  /** A disc of radius `by` around every point feature (mapped trees), merged; lines and polygons are ignored. */
  around(of: Features, by: Length): Area
  /** A shape you write: `circle`, `rect`, regular polygon (`sides` + `r`), or `points` in mm from `at`. */
  shape(spec: ShapeSpec): Area
  /** What `lines.text(spec)` covers (for masks). */
  text(spec: TextSpec): Area
  /** A strip around lines: `by` is the half-width (flat caps), merged into one area. */
  /** Half-width strip around the lines, merged. Joins are round; default cap is round. */
  buffer(of: Lines, by: Length, options?: { cap?: "round" | "flat" }): Area
  /**
   * Close the thin gaps between `of` and the edges of `within` (vector-tile
   * water that stops just short of the card border): parts of `of` within
   * `gapMm` (default 1 mm) of an edge are stretched out to it, nothing else.
   */
  extendToFrame(of: Area, within: Area, options?: { gapMm?: Length }): Area
}

/** Areas the engine makes, not OSM. */
declare const engine: {
  /** The paper's rectangle. */
  frame(): Area
  /**
   * Open sea from `features.tiles("ocean")`, buffered and extended to the card.
   * Prefer building the same chain yourself with `areas.extendToFrame`.
   */
  ocean(): Area
}

/** Line sets. */
declare const lines: {
  /** The outlines of an area's polygons. */
  rings(of: Area, options?: { /** Only the outer edge, not the holes. */ exteriorOnly?: boolean }): Lines
  /** The features' own lines (roads, walls drawn as lines). */
  of(features: Features): Lines
  /** Every edge of every polygon, and the lines: shared walls appear twice. */
  segments(features: Features): Lines
  /** The same segment drawn twice, once. */
  dedupe(of: Lines): Lines
  /** Lines that touch end to end, joined. */
  merge(of: Lines): Lines
  /** Several line sets as one. */
  join(...sets: (Lines | Lines[])[]): Lines
  /** The parts inside `within`, or outside with `invert`. */
  clip(of: Lines, within: Area, options?: { invert?: boolean }): Lines
  /**
   * Pen-and-ink terrain in `in`, drawn by burin from the elevation under the
   * output: streamlines along the slope, coloured and weighted per dash, or a
   * flat fill of a height band with `draw: "fill"` and `where`. Needs the
   * terrain tiles, which the host reads on its own when a script draws terrain.
   */
  terrain(options?: TerrainOptions): Lines
  /**
   * One contour belt between two heights, as a flat fill of the band:
   * `lines.contours({ from: 200, to: 400 })`. Call it in a loop over heights
   * to stack the belts, each drawn as its own layer.
   */
  contours(options?: ContoursOptions): Lines
  /** Like `areas.shape`, as strokes; closed unless you pass `points` with `closed: false`. */
  shape(spec: ShapeSpec & { closed?: boolean }): Lines
  /** One line of text centred on `at`; same fonts as `modules.labels`. */
  text(spec: TextSpec): Lines
}

/** Page mm, lengths, or `"50%"`; or `{ lat, lng }` on the ground. */
type ShapeAt = [Length | `${number}%`, Length | `${number}%`] | { lat: number; lng: number }

interface ShapeSpec {
  at?: ShapeAt
  circle?: Length
  rect?: [Length, Length]
  sides?: number
  r?: Length
  points?: [number, number][]
  rotate?: number
}

interface TextSpec {
  at?: ShapeAt
  text: string
  size?: Length
  font?: LabelFont
  rotate?: number
}

/** Burin's terrain line styles: how the streamlines are drawn, and stippled. */
type TerrainStroke = "lines" | "curls" | "waves" | "dots"

/** What `lines.terrain` draws: hatching, a fill of a band, or stippling. */
type TerrainMode = "lines" | "fill" | "dots"

/** The heights or depths a batch keeps to, in metres; unset limits are open. */
type TerrainWhere = {
  /** The lowest height to draw, in metres. */
  elevMin?: number
  /** The highest height to draw, in metres. */
  elevMax?: number
  /** The deepest water to draw, in metres below the surface. */
  depthMin?: number
  /** The shallowest water to draw, in metres below the surface. */
  depthMax?: number
}

/** What `lines.terrain` draws, and how, as burin names the parameters. */
type TerrainOptions = {
  /** The area to draw in; the whole output without one. */
  in?: Area
  /** The field the streamlines run along, in degrees. Default 0. */
  angle?: number
  /** The layer name; `terrain` without one. */
  layer?: string
  /** Draw the shore, the zero contour. Default false. */
  shore?: boolean
  /** Hatching (the default), a fill of `where`, or stippling. */
  draw?: TerrainMode
  /** The heights or depths to keep to. A fill usually wants one. */
  where?: TerrainWhere
  /**
   * The colour at each dash, as burin reads one: a hex string, a grey, an rgb
   * triple, or a tree over the fields (`["lerp", …]`). A constant is `"#000"`.
   */
  color?: unknown
  /**
   * The line width at each dash, as a multiple of the batch's stroke: a
   * number, or a tree over the fields.
   */
  width?: unknown
  /** Style parameters, by burin's names (`line_space`, `stroke`, …). */
  style?: Record<string, number>
} & Record<string, unknown>

/** What `lines.contours` draws: one belt of heights, as a fill. */
type ContoursOptions = Omit<TerrainOptions, "draw" | "where"> & {
  /** The lowest height of the belt, in metres. */
  from?: number
  /** The highest height of the belt, in metres. */
  to?: number
  /** Other bands, if you need a depth instead of a height. */
  where?: TerrainWhere
}

/** Patterns inside areas, by penfill. */
declare const fills: {  /** The area filled with a pattern: lines, ready to draw. */
  fill(options: FillOptions): Lines
  /**
   * What `fill(options)` covers on paper, to mask other layers with. The area
   * itself for most patterns; for `isoline-blobs` and `isoline-stack` their
   * footprint (clearings left out, `edge: "overflow"` spill included). The
   * same options run the pattern once for both.
   */
  cover(options: FillOptions): Area
}

/** Where a burin document is clipped, and the regions its batches name. */
type BurinTerrainOptions = {
  /** Clip the drawing to this area (a hard edge after the mask). */
  in?: Area
  /**
   * Polygons batches name in `within` / `outside`, by name — the same
   * `mask_*` easing as burin-map's engraved sea at the coast.
   */
  regions?: Record<string, Area>
  /**
   * Where the water is (sea, lakes): burin's water mask, so `burin.shore` and
   * `burin.water` follow this outline. Without it burin takes the sea from the
   * elevation (at or below 0.5 m), which detailed terrain tiles can miss.
   */
  water?: Area
}

/**
 * A burin document, built by burin's own language inside this profile. The
 * callback is a real function and runs in the same interpreter, so it is
 * linted and its errors carry this script's positions. The document is burin's
 * own (`burin.batch`, `burin.water`, `burin.shore`, `burin.fill`, the trees);
 * the engine draws it later, from the elevation the host fetched.
 */
declare const burin: {
  /**
   * Draw a burin document in the terrain: streamlines down the slope, the
   * stippled sea, contour belts, the shore — whatever the callback builds.
   *
   *   const natural = burin.terrain((b) => {
   *     b.batch({ angle: 90, style: { space: 3, space_dark: 0.8 } })
   *     b.water("dots", { follow: "shore", style: { space: 10 } })
   *     b.shore({ lines: 2 })
   *   })
   *   draw({ id: "land", from: natural, stroke: "solid" })
   *
   * It covers the whole output. `in` clips it to an area; to put it under
   * other layers, draw it first and mask it like any other group; to fill a
   * shape with it, `fills.fill({ in: shape, content: natural })`.
   */
  terrain(build: (burin: BurinBuilder) => void, options?: BurinTerrainOptions): Lines
  /** The same: a burin document, whatever it draws. */
  script(build: (burin: BurinBuilder) => void, options?: BurinTerrainOptions): Lines
}

/** The `burin` object a burin document sees, the same one as at burin's own front ends. */
interface BurinBuilder {
  /** A batch of hatching, stippling or a fill. */
  batch(options?: Record<string, unknown>): unknown
  /** A fill of a height or depth band: what a contour belt is. */
  fill(options?: Record<string, unknown>): unknown
  /** Lines on water: `"lines"`, `"ripples"` or `"dots"`. */
  water(kind?: "lines" | "ripples" | "dots", options?: Record<string, unknown>): unknown
  /** The shore, the zero contour. */
  shore(options?: Record<string, unknown>): unknown
  /** A colour between two others, by `t`. */
  lerp(a: unknown, b: unknown, t: unknown): unknown
  /** An rgb colour from three trees. */
  rgb(r: unknown, g: unknown, b: unknown): unknown
  /** `x` kept between `lo` and `hi`. */
  clamp(x: unknown, lo: unknown, hi: unknown): unknown
  /** A smooth step between two edges. */
  smoothstep(edge0: unknown, edge1: unknown, x: unknown): unknown
  /** 0 below `edge`, 1 above. */
  step(edge: unknown, x: unknown): unknown
  abs(x: unknown): unknown
  floor(x: unknown): unknown
  ceil(x: unknown): unknown
  round(x: unknown): unknown
  min(a: unknown, b: unknown): unknown
  max(a: unknown, b: unknown): unknown
  /** `t` as a plain fraction, for a colour. */
  mix(a: unknown, b: unknown, t: unknown): unknown
  /** The elevation at the dash. */
  elev: unknown
  /** The tone at the dash: 0 where light, 1 where dark. */
  tone: unknown
  /** The distance to the shore. */
  dist: unknown
  /** The depth below the surface. */
  depth: unknown
}

/**
 * A road measurement: a bare number (interpreted via `widthMode`: metres on the
 * ground or millimetres on paper), or an explicit `{ ground: number }` (metres)
 * or `{ paper: number }` (millimetres on the sheet).
 */
type RoadMeasure = number | { ground: number } | { paper: number }

/**
 * Per-class road configuration in `modules.roads({ classes })`.
 * Either a 2-sided road (`ground` / `paper` / `width`, `lanes`, `centerline`, `clearance`)
 * or a single-line path/rail (`singleLine: true`, `clearance`).
 */
interface RoadClassObject {
  /** Base width in ground metres (per lane when `multiplyByLanes: true`). */
  ground?: number
  /** Base width in paper millimetres (per lane when `multiplyByLanes: true`). */
  paper?: number
  /** Base width in the top-level `widthMode` coordinate space. */
  width?: number
  /** Default lane count when the feature has no `lanes` tag and `inferLanesByClass: true`. */
  lanes?: number
  /** Emit a centre line on `roads.centerlines` when at least `centerlineMinWidth` wide. */
  centerline?: boolean
  /** Draw as a single line on `roads.trails` (or `roads.rails` for `rail`) instead of a 2-sided outline. */
  singleLine?: boolean
  /**
   * For `singleLine: true`: total mask corridor width in `roads.area`.
   * For 2-sided roads: extra mask margin outside the carriageway in `roads.area`.
   */
  clearance?: RoadMeasure
}

type RoadClassSpec = number | RoadClassObject

interface RoadOptions {
  /** Road & rail features (e.g. `features.tiles("roads", "rail")`). Default: all OSM features. */
  from?: Features
  /** Coordinate space for bare numbers: `"ground"` (metres scaled by map scale, default) or `"paper"` (mm on sheet). */
  widthMode?: "ground" | "paper"
  /** Global multiplier applied to 2-sided road widths. Default: `1.0`. */
  widthMultiplier?: number
  /** Honour explicit OSM `width` / `width:lanes` tags when present. Default: `true`. */
  useWidthTag?: boolean
  /** Multiply each class's base width by the lane count. Default: `true`. */
  multiplyByLanes?: boolean
  /** When `multiplyByLanes` is `true` and the feature has no `lanes` tag, use the class's `lanes` count. Default: `true`. */
  inferLanesByClass?: boolean
  /** Minimum carriageway width required to emit `roads.centerlines`. Default: `{ ground: 7.0 }`. */
  centerlineMinWidth?: RoadMeasure
  /** Morphological close radius for smoothing road intersections (`0` disables). Default: `{ ground: 3.0 }`. */
  jointClose?: RoadMeasure
  /** Default extra mask clearance added around 2-sided roads in `roads.area`. Default: `0`. */
  clearance?: RoadMeasure
  /** Per-class road configuration keyed by class name (`"motorway"`, `"primary"`, `"residential"`, `"footway"`, `"rail"`, `"default"`, …). */
  classes?: Record<string, RoadClassSpec>
}

/** Compiled recipes. */
declare const modules: {
  /** Roads with their widths, crossings and bridges; from OSM `highway` unless given features. Call once. */
  roads(options?: RoadOptions): Roads
  /**
   * Names written on the map, in a single-stroke (Hershey) font or an outline
   * font, placed so that none covers another: along each road, bent with it
   * where it curves, and level inside areas. Larger the more the feature
   * matters (a road's class, an area's size); the most important are placed
   * first.
   */
  labels(options: LabelOptions): Labels
}

interface LabelOptions {
  /** The named features, `features.tiles("road_names")`, or several sets placed together. */
  from: Features | Features[]
  /** Area to keep labels inside (default: the drawable sheet area after `output.padding`). */
  in?: Area
  /** Capital height of the most important labels. Default `"2mm"`. */
  size?: Length
  /** Capital height of the least important. Default `"1.1mm"`. */
  minSize?: Length
  /** Clear space kept around every letter. Default `"0.5mm"`. */
  padding?: Length
  /** Distance between two labels of the same name. Default `"70mm"`. */
  spacing?: Length
  /** Bend text along curving roads; `false` labels straight stretches only. Default `true`. */
  curved?: boolean
  /** Write the names in capitals. */
  upper?: boolean
  /** The tags the text is read from, the first present. Default `["name", "ref"]`. */
  keys?: string | string[]
  /** Draw.land Hershey font or a Google outline font. Default `"futural"`. */
  font?: LabelFont
  /**
   * Concentric outlines around each placed name (0 = the letters' strokes only).
   * Each pass adds an outline at `bufferStep`, `2× bufferStep`, … Default `0`.
   */
  buffer?: number
  /** Half-width per buffer pass. Default `"0.1mm"`. */
  bufferStep?: Length
  /** With `buffer` > 0, keep the letters' own strokes. Default `true`; `false` = outlines only. */
  keepCenterline?: boolean
  /**
   * A dot at each place's point (radius, scaled 60–100 % by the place's
   * importance), its name set beside it — right, left, the diagonals, above or
   * below, whichever is free. The dot is part of the label's `area`. Default 0
   * (no dot, name centred on the point).
   */
  marker?: Length
  /**
   * Overrides for features that match `tags` (same syntax as `features.where`).
   * First matching rule wins; unset fields keep the defaults above.
   */
  rules?: LabelRule[]
}

/** One style override inside `modules.labels({ rules: [...] })`. */
interface LabelRule {
  /**
   * When set, labels placed under this rule are also exposed as
   * `labels.<id>.lines` and `labels.<id>.area` for separate ink afterward.
   */
  id?: string
  /** Tag tests, e.g. `{ class: ["motorway", "primary"] }` or `{ "tiles:layer": "park" }`. */
  tags: Tags
  font?: LabelFont
  size?: Length
  minSize?: Length
  padding?: Length
  spacing?: Length
  curved?: boolean
  upper?: boolean
  buffer?: number
  bufferStep?: Length
  keepCenterline?: boolean
  marker?: Length
}

/**
 * `modules.labels` / `lines.text` font: built-in Hershey, EMS/Hershey catalog,
 * custom stroke URL, or Google outline.
 */
type LabelFont =
  | DrawlandFontId
  | DrawlandCatalogFontId
  | DrawlandFont
  | StrokeFont
  | GoogleFont

/** Built-in single-stroke font (Greek/Cyrillic/Latin-ext fallback in WASM). */
type DrawlandFontId = "futural"

/**
 * Evil Mad Scientist / Hershey SVG fonts (downloaded at render time; same URLs
 * as the [oskay/svg-fonts](https://gitlab.com/oskay/svg-fonts) catalog).
 */
type DrawlandCatalogFontId =
  | "ems-readability"
  | "ems-readability-italic"
  | "ems-swiss"
  | "ems-tech"
  | "ems-casual-hand"
  | "ems-allure"
  | "ems-osmotron"
  | "ems-nixish"
  | "ems-bird"
  | "ems-capitol"
  | "hershey-serif-med"
  | "hershey-script"
  | "hershey-goth-english"

interface DrawlandFont {
  origin: "drawland"
  id: DrawlandFontId | DrawlandCatalogFontId | string
  /** Override catalog URL or load a custom Hershey/EMS SVG/JHF file. */
  url?: string
}

/** Any single-stroke SVG or `.jhf` font by URL (`fetch` in browser/CLI). */
interface StrokeFont {
  origin: "stroke"
  url: string
}

interface GoogleFont {
  origin: "google"
  family: string
  weight?: number
  italic?: boolean
}

/** Strokes and covered area for one `rules[].id` bucket. */
interface LabelBucket {
  readonly lines: Lines
  readonly area: Area
}

/**
 * What the labels module publishes. Each `rules[].id` adds a property with the
 * same name (`labels.park`, …) whose value is a `LabelBucket`.
 */
type Labels = {
  readonly lines: Lines
  readonly area: Area
} & Record<string, LabelBucket>

/** Put lines on paper; returns the group id. Later draws go on top. */
declare function draw(options: DrawOptions): string

type LayerTargets = string | string[]

interface DeoverlapOptions {
  /** Corridor half-width (typically the pen width). Default: `"0.3mm"`. */
  tolerance?: Length
  /** Dedup segments within a single polyline too. Default: `true`. */
  selfOverlap?: boolean
  /** Propagate the drawn corridor mask to subsequent layers in this call. Default: `false`. */
  acrossLayers?: boolean
  /** Maximum angular difference in degrees (`0..=90`), or omit to disable angle check. */
  angle?: number
  /** Which overlapping polyline keeps the shared section. Default: `"longest"`. */
  prefer?: "longest" | "first" | "shortest"
  /** Drop remnants shorter than this after clipping. Default: `tolerance`. */
  minLength?: Length
  /** Drop polylines whose retained length is below this fraction (`0..=1`) of their original length. */
  drop?: number
  /** Exclude these layer ids when `layers` is omitted. */
  except?: string[]
}

interface ToleranceOptimizeOptions {
  tolerance?: Length
  except?: string[]
}

interface FilterOptimizeOptions {
  minLength?: Length
  except?: string[]
}

interface ReloopOptimizeOptions {
  except?: string[]
}

/** Starting point for `compose.hand`; any key below overrides it. */
type HandPreset = "steady" | "sketch"

interface HandOptions {
  /** `"steady"` (default): tremble, bowed edges, loose ends. `"sketch"`: also crossing corners and long lines in several strokes. */
  preset?: HandPreset
  /** Slow tremble shared by every stroke, so joins stay joined. Default `"0.25mm"` (sketch `"0.35mm"`). */
  wobble?: Length
  /** Wavelength of that tremble. Default `"15mm"`. */
  wavelength?: Length
  /** Fine tremor along each stroke. Default `"0.04mm"`. */
  tremor?: Length
  /** Sideways sag of straight runs, as a fraction of their length (capped at 0.9mm). Default `0.012`. */
  bow?: number
  /** Open strokes overshoot (or stop short of) their ends by up to this. Default `"0.3mm"`. */
  overshoot?: Length
  /** Closed rings miss closing by up to this (gap or drifting overlap). Default `"0.7mm"`. */
  close?: Length
  /** Longest single pen stroke; longer lines are drawn in several. `0` = off (default; sketch `"40mm"`). */
  reach?: Length
  /** Sharp corners drawn as crossing lines running past by up to this. `0` = off (default; sketch `"0.8mm"`). */
  corners?: Length
  /** Share (0–1) of strokes gone over a second time with their own bows and ends. Default `0` (sketch `0.3`). */
  retrace?: number
  /** How far apart a second pass is set down, at most. Default `"0.25mm"`. */
  retraceOffset?: Length
  /** Seed for the hand's randomness. Default `1`. */
  seed?: number
  /** Exclude these layer ids when `layers` is omitted. */
  except?: string[]
}

/**
 * Preferred drawing direction for pen strokes:
 * - A compass preset (`"lr"`, `"rl"`, `"tb"`, `"bt"`, `"tl-br"`, `"tr-bl"`, `"bl-tr"`, `"br-tl"`, `"e"`, `"se"`, `"s"`, `"sw"`, `"w"`, `"nw"`, `"n"`, `"ne"`)
 * - Or a numeric angle in degrees (`0` = East / left-to-right, `45` = South-East / top-left to bottom-right, `90` = South / top-to-bottom).
 */
type OrientDirection =
  | number
  | "lr" | "left-to-right" | "e" | "east"
  | "tl-br" | "nw-se" | "se" | "southeast"
  | "tb" | "top-to-bottom" | "s" | "south"
  | "tr-bl" | "ne-sw" | "sw" | "southwest"
  | "rl" | "right-to-left" | "w" | "west"
  | "br-tl" | "se-nw" | "nw" | "northwest"
  | "bt" | "bottom-to-top" | "n" | "north"
  | "bl-tr" | "sw-ne" | "ne" | "northeast"

interface OrientOptions {
  /** Preferred stroke direction (compass preset or angle in degrees). Default: `"lr"` (`0`). */
  direction?: OrientDirection
  /** Alias for `direction` when specifying an angle in degrees. */
  angle?: OrientDirection
  /** Leave strokes longer than `maxLength` untouched. */
  maxLength?: Length
  /** Split multi-segment strokes (such as zigzags) where they reverse against `direction` before orienting. Default: `false`. */
  splitReversals?: boolean
  /** Exclude these layer ids when `layers` is omitted. */
  except?: string[]
}

interface LinesortOptions {
  /** Run 2-opt swaps after nearest-neighbour pass. Default: `true`. */
  twoOpt?: boolean
  /** Maximum 2-opt passes. Default: `250`. */
  passes?: number
  /** Do not flip stroke directions during sorting (connect `end -> start` only). Default: `false` (automatically `true` when `direction`/`angle` is set or after `compose.orient`). */
  follow?: boolean
  /** Orient strokes along this preferred direction before sorting, and lock their direction (`follow: true`). */
  direction?: OrientDirection
  /** Alias for `direction`. */
  angle?: OrientDirection
  /** When `direction`/`angle` is set, leave strokes longer than `maxLength` untouched. */
  maxLength?: Length
  /** When `direction`/`angle` is set, split strokes at sharp reversals against `direction` before orienting. Default: `false`. */
  splitReversals?: boolean
  /** Exclude these layer ids when `layers` is omitted. */
  except?: string[]
}

/** How the drawn groups stack, cover each other, and are optimized for the plotter. */
declare const compose: {
  /** Group ids, bottom first; groups left out go on top in draw order. Default: draw order. */
  order(...ids: (string | string[])[]): void
  /** `from` hides exactly the listed groups, wherever they are in the order. */
  mask(options: { name?: string; from: Area; occludes: string[] }): void
  /** Which masks cut: `"auto"` (default), `"none"`, or exactly these areas. */
  clip(value: "auto" | "none" | Area[]): void
  /** Remove overlapping stroke segments within or across layers. */
  deoverlap(layers?: LayerTargets | Length | DeoverlapOptions, options?: Length | DeoverlapOptions): void
  /** Join polylines whose endpoints are within `tolerance` (default `"0.1mm"`). */
  linemerge(layers?: LayerTargets | Length | ToleranceOptimizeOptions, options?: Length | ToleranceOptimizeOptions): void
  /** Ramer-Douglas-Peucker simplification within `tolerance` (default `"0.05mm"`). */
  simplify(layers?: LayerTargets | Length | ToleranceOptimizeOptions, options?: Length | ToleranceOptimizeOptions): void
  /** Drop strokes shorter than `minLength` (default `"0.05mm"`). */
  filter(layers?: LayerTargets | Length | FilterOptimizeOptions, options?: Length | FilterOptimizeOptions): void
  /** Randomize seam vertex on closed loops to avoid ink blobs. */
  reloop(layers?: LayerTargets | ReloopOptimizeOptions): void
  /** Redraw strokes as if by hand: tremble, bowed edges, loose ends, unclosed rings. Runs where it is called in the sequence — usually after `linemerge`, before `simplify`/`linesort`. */
  hand(layers?: LayerTargets | HandPreset | HandOptions, options?: HandPreset | HandOptions): void
  /** Flip open strokes so they flow toward a preferred direction (e.g. `"tl-br"` or `45` degrees) to avoid pen skipping on reversals. */
  orient(layers?: LayerTargets | OrientDirection | OrientOptions, options?: OrientDirection | OrientOptions): void
  /** Nearest-neighbour + 2-opt stroke ordering to minimize pen-up travel. */
  linesort(layers?: LayerTargets | OrientDirection | LinesortOptions, options?: OrientDirection | LinesortOptions): void
}

/** Where the map is and on what paper. The page edits this call when its values are written literally. */
declare function output(options: OutputOptions): void

/** The profile's name. */
declare function title(text: string): void
