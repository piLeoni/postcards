# Profiles: the library reference

A profile is a JavaScript file. It calls the draw.land library to say where
the map is, which map data to read, what to make of it, and how to ink it:

```js
title("Parks and buildings")
output({ width: "6in", height: "4in", scale: "1:8000", lat: 37.8771, lng: -122.2562 })

const buildings = areas.polygons(features.tiles("buildings"))
const parks = areas.polygons(features.tiles("landcover:park,garden"))

draw({ id: "park_fill", from: fills.fill({ in: parks, pattern: "dots", spacing: "0.45mm", mark: "0.2mm" }) })
draw({ id: "bldg_fill", from: fills.fill({ in: buildings, per: "feature", pattern: "zigzag", spacing: "0.4mm", angle: 45 }) })
draw({ id: "bldg_ring", from: lines.rings(buildings), stroke: "solid" })
compose.mask({ from: buildings, occludes: ["park_fill"] })
```

The script runs once, in milliseconds, before any data is fetched. It does
not draw anything itself: each call adds a node to a graph (`areas.polygons`
returns a handle to the node it made, not polygons), and the engine then
fetches what the graph reads and runs it in Rust. So a loop over twenty park
kinds costs nothing at draw time beyond the twenty fills it asks for.

[`crates/drawland-script/drawland.d.ts`](../crates/drawland-script/drawland.d.ts)
is the exact description of every function and option below; the web editor
checks scripts against it as you type.

## Running a profile

- **Web**: the editor in the sidebar. Presets are scripts too; picking one and
  moving the map never loads the interpreter (their graphs ship pre-run), and
  editing the script loads it once (about 1.1 MB).
- **CLI**: `drawland map [profile.js] --lat … --lng …` (default
  `configs/postcard.js`). `--dump-graph` prints the graph and stops; a saved
  graph (`.json`) runs as is.

## What the script is

Plain modern JavaScript (`const`, loops, functions, arrow functions,
destructuring, template strings, spread), with no I/O: no `fetch`, no files,
no `Date` or `Math.random` (the same script always draws the same map). A
loop that runs away stops with an error after a million iterations.

Errors name the line and column of *your* call, even when it happens inside
a helper you wrote:

```text
line 12 column 3: areas.union expects an area (from areas.*, engine.* or a module's .area), got lines
```

The same position carries through to errors the engine finds later, such as
a fill pattern it does not know.

## Values

There are three kinds of handle, and every function says which it takes:

| Kind | Made by | Used for |
|---|---|---|
| `Features` | `features.*` | building areas and lines; never drawn directly |
| `Area` | `areas.*`, `engine.*`, `modules.roads().area` | fills, masks, rings, clipping |
| `Lines` | `lines.*`, `fills.fill`, `modules.roads().outlines` … | `draw` |

A **length** is a number of millimetres, or a string with a unit: `"0.5mm"`,
`"2cm"`, `"6in"`, `"1m"`.

## `title(text)` and `output({...})`

`title` names the profile (the web page uses it for the download's file name).

`output` says where and on what paper:

| Key | Meaning |
|---|---|
| `lat`, `lng` | the centre; or `address`, looked up with Nominatim |
| `width`, `height` | the paper; default 6in × 4in |
| `scale` | `"1:10000"` or `10000` |
| `bearing` | degrees clockwise |
| `projection` | `"webmercator"` (default: the web map, north up), `"utm"` (true distances), or a PROJ string with `{lat}` / `{lng}` |
| `padding` | blank margin inside the edge: a length, or `[across, down]` |
| `slices` | `{ columns, rows, gutter }`: the output cut into sheets |
| `warp` | `{ fisheye: k }`, `{ twirl: deg }`, `{ wave: { amplitude, wavelength } }`, or a list of them, applied in order |

When the values are written literally, `output({ … })` on one line, the web
page edits them for you: dragging the frame rewrites `lat`/`lng`, the scale
menu rewrites `scale`, and so on. Computed values work everywhere, but the
page then shows the output as read-only ("output computed by the script").

## `features`: map data

- `features.osm(tags)`: OSM features with any of these tags, from Overpass.
  `{ building: true }`, `{ leisure: ["park", "garden"] }`; `except: {…}`
  drops features another tag selected; `underground: true` keeps tunnels and
  `layer < 0`.
- `features.tiles(...items)`: features from OpenFreeMap's vector tiles, read
  by terramask. An item is a preset (`buildings`, `roads`, `paths`, `rail`,
  `water`, `lakes`, `rivers`, `ocean`, `land`, `forest`, `grass`, `parks`,
  `farmland`, `wetland`, `sand`, `rock`, `glacier`, `urban`) or a rule
  `layer:class,class` on the OpenMapTiles layers, where a name is a class or a
  subclass and `class/subclass` names one pair (`landcover:grass/grass`, the
  lawns). Each feature comes mended across tile edges.

The tiles are a handful of static files per map, cached for years; Overpass
has every OSM tag but is slow and often busy. A profile that uses only
`features.tiles` never asks Overpass, and one that mixes them asks Overpass
only for the keys its `features.osm` calls name. Roads are the usual reason to
mix: OSM's `width` and `lanes` give real widths, which the tiles lack.

| OSM tags | Tiles |
|---|---|
| `building=*` | `"buildings"` |
| `leisure=park` / `garden` | `"landcover:park,garden"` |
| `landuse=grass`, `natural=wood` | `"landcover:grass/grass,wood"` |
| `water=*`, `natural=water` | `"water:lake,river,pond,dock"` |
| `highway=*` | `"roads"`, `"paths"` (with `modules.roads({ from })`) |

## `areas` and `engine`: polygons

| Function | Result |
|---|---|
| `areas.polygons(features)` | the features' polygons, merged |
| `areas.union(a, b, …)` or `areas.union([a, b])` | everything in any of them |
| `areas.difference(base, ...cut)` | `base` without the cuts; with none, `base` itself |
| `areas.intersect(base, keep)` | the part of `base` inside `keep` |
| `areas.fillHoles(a)` | holes closed (yards in blocks, lakes in parks) |
| `areas.grow(a, by)` | grown by a length; negative shrinks |
| `areas.extendToFrame(of, within)` | stretch `of` to the west/east edges of `within` when it already spans most of the height |
| `engine.frame()` | the paper's rectangle |
| `engine.ocean()` | shorthand: `ocean` tiles, clipped to the frame, grown, then `extendToFrame` |

## `lines`: line sets

| Function | Result |
|---|---|
| `lines.rings(area, { exteriorOnly })` | the polygons' outlines (holes too, unless `exteriorOnly`) |
| `lines.of(features)` | the features' own lines |
| `lines.segments(features)` | every edge of every polygon, and the lines: shared walls twice |
| `lines.dedupe(l)` | the same segment drawn twice, once |
| `lines.merge(l)` | lines that meet end to end, joined |
| `lines.join(a, b, …)` | several sets as one |
| `lines.clip(l, area, { invert })` | the parts inside `area` (outside with `invert`) |

## `fills.fill({...})`: patterns

`fills.fill({ in: area, pattern, spacing, angle, … })` fills an area with one
of penfill's patterns and returns the lines.

- `pattern`: `rectilinear`, `zigzag`, `lines`, `grid`, `triangles`,
  `honeycomb`, `dots`, `waves`, `wave_grid`, `scales`, `sunburst`, `spiral`,
  `concentric`, `hilbert`, `stipple`, `grass`, `gravel`, `scribble`,
  `truchet`, `marble`, `wood`, `cracks`, `terrazzo`, `chess`, `pat` (a
  classic hatch by `name`: `BRICK`, `HERRINGBONE`, `ANSI31` …), `none`.
- `spacing` (default 0.5mm), `angle` (degrees), `mark` (dot size), `inset`,
  `seed` (random patterns).
- `per: "feature"`: one pattern per polygon (each building hatched on its own)
  instead of one over the union.
- `anchor: "global"` (default) lays one lattice over the whole map, so
  neighbouring areas meet without a seam; `"local"` places it on each shape.
  `shift: [x, y]` moves it; `centre: [x, y]` places a sunburst or spiral.
- Per pattern: `lattice` (dots), `line_width` (honeycomb), `hatch`
  (terrazzo), `cell` (chess), `name` and `scale` (pat).
- `source: { file, size, position, repeat }` draws an SVG into the area
  instead of a pattern.
- `content: lines` fills the area with lines made elsewhere, cut to it: a
  burin document (`burin.terrain(…)`, which covers the whole output) or any
  `lines.*`. `fills.fill({ in: gardens, content: natural })`.

## `modules.roads()`: roads

`const roads = modules.roads()` builds the roads with their widths, crossings
and bridges, from OSM's `highway` features, or from `modules.roads({ from:
features.tiles("roads", "paths") })`. It returns:

| Output | Kind | What |
|---|---|---|
| `roads.area` | area | the carriageway and the strip each trail covers: the mask |
| `roads.outlines` | lines | the carriageway's edge |
| `roads.centerlines` | lines | a centre line down each road 6 m wide or more; dash it with the draw's `stroke` |
| `roads.seams` | lines | where a bridge deck crosses the road below |
| `roads.details` | lines | the centre lines already dashed, and the seams |
| `roads.trails` | lines | footways, paths, tracks, steps, cycleways as single lines |

The widths come from OSM's `width` or `lanes` (3 m a lane); tile roads have
neither, so their class decides. The module's lines can be drawn, not
transformed (`lines.clip(roads.outlines, …)` is an error); call it once.

## `draw({...})`: ink

`draw({ id, from, stroke })` puts lines on paper as one SVG group and returns
its id. Groups are written in draw order; that order cuts nothing (masks
do). `id` defaults to the node's name; a plotter can
give each group its own pen. `stroke` is `"solid"`, `"dash"`, `"dotted"`,
`"none"`, or `{ style, dash, gap, mark }`; without one, lines are inked as
they are (fills are lines already).

## `compose`: order and masks

- `compose.order(...ids)`: the sequence groups are written (and plotted) in.
  Default: draw order. It cuts nothing.
- `compose.mask({ name, from: area, occludes: [ids] })`: the area hides
  exactly the listed groups, wherever they are in the order. A group no mask
  lists is never cut, so a second ink drawn over everything stays whole. A
  mask that should spare part of another is area work before it:
  `from: areas.difference(parks, water)`.
- `compose.clip(value)`: which masks cut: `"auto"` (default: the masks that
  list the group), `"none"`, or exactly these areas.

Since `draw` returns the id, groups collect naturally:

```js
const road = [
  draw({ id: "roads_out", from: roads.outlines, stroke: "solid" }),
  draw({ id: "roads_trail", from: roads.trails, stroke: "solid" }),
]
compose.mask({ name: "bldg_cover", from: buildings, occludes: [...road] })
```

## The graph

What the engine runs is the graph as JSON (`drawland map --dump-graph`): one
entry per node in four typed sections, the draws, the composition, and the
output. Each node keeps `at: [line, column]`, the script position that made
it. Its shape is documented in `crates/drawland-core/src/grammar.rs`; nobody
writes it by hand.

## Examples

- [`configs/postcard.js`](../configs/postcard.js): the full postcard, with
  park kinds in a loop, shared walls, roads and four masks.
- [`web/src/presets/`](../web/src/presets/): the web page's presets, from
  "buildings only" to every layer from Overpass.
