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
  | "rectilinear" | "zigzag" | "lines" | "grid" | "triangles" | "honeycomb" | "dots" | "waves" | "wave_grid"
  | "scales" | "sunburst" | "spiral" | "concentric" | "hilbert" | "stipple" | "grass" | "gravel" | "scribble"
  | "truchet" | "marble" | "wood" | "cracks" | "terrazzo" | "chess" | "pat" | "none" | "solid"

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
  /** `honeycomb`: double the walls this far apart. */
  line_width?: Length
  /** `terrazzo`: the hatch inside the stones. */
  hatch?: Length
  /** `chess`: the size of a square. */
  cell?: Length
  /** `pat`: which hatch. */
  name?: PatName
  /** `pat`: the hatch's size. */
  scale?: Length
  /** An SVG drawn into the area instead of a pattern. */
  source?: { file: string; size?: string; position?: string; repeat?: string }
}

/** `solid`, `dash`, `dotted`, `none`, or an object: the dashes' sizes and the ink (`color`, `width` in mm, `cap`). */
type Stroke =
  | "solid" | "dash" | "dotted" | "none"
  | { style?: "solid" | "dash" | "dotted" | "none"; dash?: Length; gap?: Length; mark?: Length; color?: string; width?: Length; cap?: "round" | "square" | "butt" }

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
  /** Every road's surface: a mask for what roads cover. */
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
  terrain(build: (burin: BurinBuilder) => void, options?: { in?: Area }): Lines
  /** The same: a burin document, whatever it draws. */
  script(build: (burin: BurinBuilder) => void, options?: { in?: Area }): Lines
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

/** Compiled recipes. */
declare const modules: {
  /** Roads with their widths, crossings and bridges; from OSM `highway` unless given features. Call once. */
  roads(options?: { from?: Features }): Roads
  /**
   * Names written on the map in a single-stroke (Hershey) font, placed so
   * that none covers another: along each road, bent with it where it curves,
   * and level inside areas. Larger the more the feature matters (a road's
   * class, an area's size); the most important are placed first.
   */
  labels(options: LabelOptions): Labels
}

interface LabelOptions {
  /** The named features, `features.tiles("road_names")`, or several sets placed together. */
  from: Features | Features[]
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
  /** A built-in single-stroke font. Default `"futural"`. */
  font?: "futural"
}

/** What the labels module publishes. */
interface Labels {
  /** The letters, as pen strokes. */
  readonly lines: Lines
}

/** Put lines on paper; returns the group id. Later draws go on top. */
declare function draw(options: DrawOptions): string

/** How the drawn groups stack and cover each other. */
declare const compose: {
  /** Group ids, bottom first; groups left out go on top in draw order. Default: draw order. */
  order(...ids: (string | string[])[]): void
  /** `from` hides exactly the listed groups, wherever they are in the order. */
  mask(options: { name?: string; from: Area; occludes: string[] }): void
  /** Which masks cut: `"auto"` (default), `"none"`, or exactly these areas. */
  clip(value: "auto" | "none" | Area[]): void
}

/** Where the map is and on what paper. The page edits this call when its values are written literally. */
declare function output(options: OutputOptions): void

/** The profile's name. */
declare function title(text: string): void
