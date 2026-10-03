# Profile grammar — proposal (v3)

**Status: proposal only — no implementation until this reads right.**
YAML is the sketch format; the same graph could be JSON5 or a small DSL.
What matters is the **shape**:

- named geometry, named ink, explicit clip rules;
- **every name you define carries a marker**, so you can tell your things from
  the engine's at a glance — including in someone else's file;
- operations are keywords of a closed kit, and they are **namespaced by
  provenance** (`tools_*`, `engine_*`, `osm_*`, `module_*`).

---

## Decisions taken (v3)

These are settled; the sections below explain them.

| Decision | Chosen |
|---|---|
| Provenance marker | `$` on the section: `$areas.river` is yours |
| Expressions | `~` on the name: `spacing: ~dense` — recognised, **not implemented** in v3 |
| Draw ids | explicit `id:`, falling back to the def name when omitted |
| `primitives_*` | recipes expandable into `tools_*`: sugar, no new code |
| `module_*` | compiled code (roads); not expressible in the kit |

### Two symbols, two questions

- **`$` answers "whose is it?"** — `$areas.river` is defined in this file; a
  name with no `$` that is not a kit keyword or a module output is an error.
- **`~` answers "is it an expression?"** — `spacing: ~dense` is a value
  computed from the variables in "$expressions", not a fixed length.

A plain `0.5mm` is a length, `$areas.river` is geometry, `~dense` is an
expression: three visibly different things. Nothing else starts with `$` or
`~`, so both markers are unambiguous.

`*` cannot be used: in YAML it is already the alias marker (`*name` refers to
an anchor `&name`) and the parser rejects it. `!` and `%` are reserved too.
`$`, `~`, `@` and `+` are free.

## Implementation status

The grammar is implemented and **runs**. `postcards-core::grammar` parses and
validates it; `postcards-core::grammar_run` evaluates it against OSM data and
writes the SVG. The CLI picks the v3 path by itself when the file starts with
`card:` or `$features:`.

Verified end to end on 1730 Highland Pl, Berkeley: 3396 features in, all
thirteen groups out (`parks_ring`, `parks_fill_*`, `water_ring`, `water_fill`,
`roads_out`, `roads_det`, `bldg_wall`, `bldg_fill`, `bldg_ring`).

What runs today:

- `card`, the four `$` sections, `draw`, `compose.order` / `masks` / `clip`,
  including `clip.default`;
- every operation in the toolkit table, with section typing: `tools_rings`
  written under `$areas` is a load error;
- references (`$areas.river`), and module outputs (`roads.outlines`,
  `roads.area`) in `draw.from` and `masks.from`;
- `module_roads`, reusing the compiled roads theme, published as
  `roads.area` / `roads.outlines` / `roads.details`;
- selective occlusion: a mask cuts only the ids it lists in `occludes`;
- defs evaluated in waves, each once, and in parallel;
- `$expressions` and `~name`: recognised, rejected with a "lands in v4" error;
- `primitives_*`: shape proposed (above), not defined in this build;
- loops between defs, duplicate names, dangling references, two operations in
  one def: load errors, not surprises at render time.

Still to come: `$recipes` / `primitives_*`, and the park kinds inside a
primitive (today the profile spells the four kinds out).

### Ids are labels, not variables

An `id` in `draw` names an SVG group; nothing is ever looked up through it, so
it carries no marker and no type. It is the contract with the outside (the
plotter, an editor, the parity tools). `compose` refers to it.

When `id` is omitted, the group is named after the def it draws:
`from: $fills.garden` → `fills_garden`. An explicit `id` wins, which keeps
today's group names (`buildings_filling`, …) available while short profiles
stay short.

### The boundary: composition in the profile, algorithms in code

| Family | Prefix | What it is | Expandable? |
|---|---|---|---|
| kit | `tools_*` | boolean / line / buffer / fill operations | — (vocabulary) |
| sources | `osm_*`, `engine_*` | OSM selections, card, ocean | — |
| recipes | `primitives_*` | a canned chain of the above | **yes**, in YAML |
| compiled | `module_*` | e.g. roads | **no**, it is code |

The rule for placing a new thing:

> If `tools_*` can express it, it is a **primitive**. If it needs code the
> operations do not have, it is a **module**.

A primitive is not a fifth kind of name. It is a **macro**: a name that stands
for a chain of `tools_*`, and that the engine can print back to you.

---

## Chains: one operation per def, lined up by hand

This is the decision that shapes the rest, so it is worth stating plainly.
**A def holds exactly one operation.** A chain is several defs, each naming the
one before it:

```yaml
$areas:
  inner:     { tools_grow: { of: $areas.dissolved, by: -0.1mm } }
$lines:
  bldg_seg:  { tools_segments: $features.bldg }
  bldg_dedupe: { tools_dedupe: $lines.bldg_seg }
  walls:     { tools_clip: { lines: $lines.bldg_dedupe, within: $areas.inner } }
```

No `{ tools_dedupe: $lines.bldg_seg }` nested inside another operation. That is
deliberate:

- **Every intermediate has a name.** You can `draw` it, use it as a mask, or
  diff it against the previous render. Nesting hides the middle of the chain.
- **One error message per line.** With nesting, a bad ref reports the outer
  operation and you count brackets. Here the def is the unit: `$lines.walls`
  failed, and the message says which of its two inputs is missing.
- **The document already has the shape.** The old `steps:` list was a chain in
  disguise; splitting it into named defs buys back the ability to reuse a step
  without a second syntax for "define but don't draw".
- **A test can check it.** Flat defs are trivially walkable: refs, cycles and
  section types are all checkable before anything renders.

The cost is verbosity: three lines where one nested expression would do. The
compensation is **primitives**.

---

## `primitives_*`: a chain with a name

The Python filters all return the same contract — `LayerParts(outlines,
details, filling, mask)` — and each one is a fixed sequence of geo operations.
That sequence is exactly what a primitive names.

### The uniform shape

A primitive is written like a module — it is *called*, and it *publishes named
outputs* — but its outputs are declared in YAML, not compiled:

```yaml
$recipes:                       # later: a second file, see open questions
  primitives_buildings:
    select:  { osm_select: { building: true } }
    dissolve: { tools_polygons: $features.bldg }
    inner:   { tools_grow: { of: $areas.dissolve, by: -0.1mm } }
    outlines: { tools_rings: $areas.dissolve }
    details:  { tools_clip: { lines: { tools_segments: $features.bldg }, within: $areas.inner } }
    filling:  { tools_fill: { in: $areas.dissolve, per: feature, pattern: zigzag } }
    mask:     { tools_polygons: $features.bldg }
```

Called from a layer, and drawn by output name:

```yaml
$areas:
  bldg: { primitives_buildings: { from: $features.bldg } }

draw:
  - { id: bldg_ring, from: $areas.bldg.outlines, stroke: solid }
  - { id: bldg_wall, from: $areas.bldg.details, stroke: solid }
  - { id: bldg_fill, from: $areas.bldg.filling }
```

### The rules that make it uniform

1. **The output names are fixed**, and they are the four from `LayerParts`:
   `outlines`, `details`, `filling`, `mask`. Not a primitive's choice: this is
   what lets a primitive be swapped for a module, and what `compose` can assume.
2. **The four are always present**, possibly empty. A primitive that has no
   `details` declares `details: {}` — an empty line set — instead of omitting
   it. So `buildings.outlines` is never "sometimes defined".
3. **A primitive is an area-ish object, not a line set.** `$areas.bldg` is a
   bundle; you reach into it with `.$output`. That is why it fits `$areas` and
   not `$lines`: its `mask` is an area, and `compose` can use it unchanged
   (`from: $areas.bldg.mask`).
4. **The expansion is canonical.** For each primitive the engine has a `tools_*`
   rendering that must produce the identical SVG, and a test proves it. The
   primitive is sugar, and the sugar is checkable.
5. **Only `tools_*` inside.** If a primitive needs arithmetic on a tag, a lookup
   table or a loop, it is a module, not a primitive. The danger signals below
   are the test.

This is the same shape as `module_roads` (`roads.area` / `roads.outlines` /
`roads.details`), which is deliberate: one day `roads` can gain a pure-`tools`
"basic" recipe behind the same three output names, and a profile that used the
module keeps working.

### Why a call and not just a `$def`

Because the four outputs must be nameable. A plain `$areas.bldg` def would give
you one name for four geometries, and `draw` would need `from:` to mean four
things. The dotted output is the smallest syntax that keeps one call and four
draws.

### What the four outputs mean (from the Python contract)

| Output | What it is | Drawn? |
|---|---|---|
| `outlines` | the theme's boundary strokes | yes, with `stroke:` |
| `details` | secondary strokes inside the theme (kerbs, shared walls, bridge seams) | yes, with `stroke:` |
| `filling` | a penfill pattern already generated (`$fills`-like) | yes |
| `mask` | the solid area the theme covers | no: it is what `compose.masks` occludes with |

A primitive that only wants to be drawn as three line sets has an empty
`mask`; one that only masks has everything else empty. The card does not lose
the ability to be minimal — it just gains one written name for "the whole
buildings thing".

### The first four

| Primitive | from | Produces |
|---|---|---|
| `primitives_buildings` | `{ building: true }` | ring + shared-wall detail + zigzag fill + footprint mask |
| `primitives_parks` | the park tags, by kind | dot fills per kind (garden → grass) + one dash outline + union mask |
| `primitives_water` | `{ water: true, natural: water }` | solid outline + waves fill + water mask |
| `primitives_green` | trees, scrub, hedges | dots, no mask (and optionally a border) |

Each one is the Python filter written as defs, and the per-kind park logic is
what makes `$recipes` earn its keep: the four park kinds are the same chain run
four times, which is exactly what a parameterised recipe is for.

### Is a chain needed for *every* theme?

No. The chain (`$areas` / `$lines` defs) stays the primitive's *definition*. For
a one-off shape — a river, a school yard — you write the defs directly. The
primitive is the escape hatch for the four things every card has, where writing
eleven defs every time is the actual problem.

**Danger signals** — when one of these appears, the answer is a module or a
plugin, never new syntax:

- a lookup table keyed on a tag (`highway` → metres);
- an `if`/`else` inside an operation instead of between values;
- a loop, a counter, or an accumulator;
- arithmetic (`width_m * 0.5 + 0.2mm`);
- `and`/`or` between conditions;
- an intermediate variable defined inside an expression.

### Expressions (later, v4)

Recognised by the parser, rejected with a clear error in v3. Shape: a
dictionary in `$expressions`, two constructs only, and **no inline
conditionals scattered through the file**:

```yaml
$expressions:
  dense:   { when: { area_m2: { "<": 50 } }, then: 0.3mm, else: 0.5mm }
  by_zoom: { stops: { input: scale, at: [ [2000, 0.3mm], [10000, 0.2mm] ], interpolate: linear } }
```

Used by name: `spacing: ~dense`. The engine publishes the variables they may
read: per render (`scale`, `width_mm`, `height_mm`, `bearing`) and per feature
(`area_m2`, `width_m`, `length_m`). Expressions **read the world, they do not
build it**: no arithmetic, no nesting, no composition. When a calculation is
needed, it belongs in a module and is published as an output.

## Why: provenance, not just namespaces

In v1 a profile looked like today's product: a `stack` of `buildings`, `roads`,
`water`, `parks`. Then `compose: { from: parks_ext }` and you had no way to know
whether `parks_ext` was yours, the engine's, or a leftover from a module.

So the rule is not "use namespaces". It is:

> **A name is either the engine's, or it is yours — and the name says which.**

Four families of names, each with a fixed prefix:

| Family | Looks like | Who owns it | Enforced? |
|---|---|---|---|
| **Yours** | `$areas.river`, `$lines.river` | this file | yes: the `$` is required |
| **Kit operations** | `tools_union`, `tools_fill` | the engine's toolkit | yes: closed list |
| **Engine sources** | `osm_select`, `tiles_select`, `engine_card`, `engine_ocean` | the engine | yes: closed list |
| **Modules** | `module_roads`, `roads.outlines` | a compiled module | yes: declared by the module |

The `$` means **"defined in this file"**. Nothing else in the grammar may start
with `$`, and no OSM tag, pattern or module name ever does — so the meaning is
unambiguous without reading the rest of the file.

Why this is a **rule** and not a convention: the parser must know where to look.
If `$areas.river` and `$lines.river` can coexist, the type cannot be inferred
from the name alone, and a mistake surfaces halfway through rendering the card.
With the marker, the type is syntactic and the error comes at load:

> `masks.from` wants an area; `$fills.river` is not one.

---

## The four sections

```text
title             a name for the profile (optional)         (schema, no marker)
card              paper frame, centre, projection          (schema, no marker)
$features         OSM selections: tag filters (Overpass) or tile layers
$areas            areas  (multi-polygons in card mm)
$lines            line sets
$fills            penfill patterns: already line sets
$recipes          reusable chains of the above (optional)
draw              which names become ink, and how          (schema, no marker)
compose           order, masks, selective clip              (schema, no marker)
```

Sections **without** `$` (`title`, `card`, `draw`, `compose`) are the engine's schema.
Sections **with** `$` are yours. That single visual rule tells you, on opening
any profile, what is grammar and what is content.

`title: Parks and buildings` names the profile, so a shared file carries its
name; nothing draws it. The web app shows it under the config's buttons, to
be renamed there, and names the saved file after it.

`card.projection` picks how the ground lands on the paper:

| `projection` | What it gives |
|---|---|
| `webmercator` (default) | A crop of the web map, north up, one scale for both axes (the web map's metres at the card's centre). The drawing matches the web app's Mapbox preview to the pixel. |
| `utm` | True distances and shapes, but north turns away from the page's up the further the card sits from its UTM zone's meridian: 0.5° in Berkeley, 1.4° in Boston, where a 6 in card's sides move 1.9 mm against the preview. |
| a PROJ string | Any projection proj4rs knows: `aea`, `cea`, `eqc`, `geos`, `krovak`, `laea`, `lcc`, `merc`, `mill`, `moll`, `somerc`, `stere`, `sterea`, `tmerc`, `utm`. `{lat}` and `{lng}` stand for the card's centre: `"+proj=laea +lat_0={lat} +lon_0={lng}"`. The scale holds at the centre (a small square of ground keeps its area); the preview no longer matches. |

At a city's scale most projections draw the same streets; what tells them
apart is how they turn north. `"+proj=lcc +lat_1=30 +lat_2=60 +lon_0=-100"`
over Boston tilts the card about 20°.

`card.warp` bends the ground right after projecting: features, the sea and
the card's frame, before anything is drawn from them. Areas, roads and rings
come out bent; fills are laid afterwards, so patterns stay flat, and roads
keep their width. Every warp keeps the card's edge where it is, so nothing
slides off the paper. One warp or a list, applied in order:

| `warp` | What it does |
|---|---|
| `{ fisheye: 0.6 }` | Magnifies the centre, from 0 to about 1; a negative value pinches it. |
| `{ twirl: 90 }` | Turns the centre by that many degrees, less and less towards the edge. |
| `{ wave: { amplitude: 1.5mm, wavelength: 25mm } }` | Ripples both ways, calming to nothing at the edge. |

```yaml
card:
  projection: webmercator
  warp: [{ twirl: 45 }, { fisheye: 0.3 }]
```

Paper × scale = terrain. The card writes the paper (`width`, `height`) and
the `scale`; the terrain follows. The web app notes it beside the scale,
`scale: "1:8000"   # terrain 1.22 × 0.813 km`, and lets you edit it: more
terrain on the same paper is a smaller scale.

`card.bearing` turns the ground under the card, in degrees clockwise like the
web map's bearing; the paper stays square to the page. In the web app the
transform menu's ↻ rotate turns it by dragging left and right, in 15° steps
with Shift.

`card.padding` leaves a blank margin inside the paper's edge: the paper keeps
its size and the drawing stops short of it. `card.slices` cuts the card into
`columns × rows` sheets of equal size, each written as its own SVG
(`card_r1c2.svg`: row 1, column 2, next to `card.svg`; the web app downloads
one file per sheet). `slices.gutter` is the blank between neighbouring
sheets' drawings, half on each side of a cut; the outer edges keep the card's
padding. The sheets hang side by side like a triptych with the map hidden in
the gaps. Both take one length, or two, across then down:

```yaml
card:
  padding: [5mm, 3mm]
  slices: { columns: 3, rows: 2, gutter: 4mm }
```

The web app writes all three from the transform menu, live, and draws the cut
lines and the margins over the card.

---

## The kit: every operation has a name

Operations are keywords, not call syntax. They are written with their family
prefix so that a `union` is recognisably the engine's `union`:

### Kit operations — `tools_*`

| Operation | Result | Notes |
|---|---|---|
| `tools_union: [a, b, …]` | area | Boolean union. |
| `tools_difference: { base, cut }` | area | `base` minus `cut`; `cut` may be a list. |
| `tools_intersect: { base, keep }` | area | Clip `base` to `keep`. |
| `tools_fill_holes: <area>` | area | Drop interior rings. |
| `tools_grow: { of, by: ±len }` | area | Buffer out / inset (negative = shrink). |
| `tools_polygons: <feature set>` | area | Union of the polygon parts. |
| `tools_rings: <area>` | lines | Boundary rings (holes included). |
| `tools_rings: { of, exterior_only: true }` | lines | Outer rings only. |
| `tools_segments: <feature set>` | lines | Every edge of every polygon, plus line features. |
| `tools_clip: { lines, within, invert: false }` | lines | Keep inside / outside an area. |
| `tools_dedupe: <lines>` | lines | Merge duplicate segments. |
| `tools_merge: <lines>` | lines | Join lines whose endpoints meet. |
| `tools_lines: <feature set>` | lines | The linestrings of those features. |
| `tools_join: [a, b, …]` | lines | Concatenate line sets. |
| `tools_fill: { in, pattern, … }` | lines | penfill into an area. `per: feature` runs one pattern per polygon. `anchor: global` (default) lays one lattice over the whole card, so neighbouring areas meet with no seam; `anchor: local` places it on each shape. `shift: [x, y]` (mm) moves it. A `sunburst` is local unless given a `centre`. |

### Engine sources — `engine_*` / `osm_*` / `tiles_*`

| Source | Result | Notes |
|---|---|---|
| `engine_card: {}` | area | The card rectangle. |
| `engine_ocean: {}` | area | The sea, from OpenFreeMap's vector tiles. **Not** an OSM tag: a host function, empty inland. |
| `osm_select: { building: true }` | features | Tag filter, from Overpass; `except:`, `underground:`. |
| `tiles_select: [buildings, "landcover:park,garden"]` | features | Layers of OpenFreeMap's vector tiles (OpenMapTiles schema), read by terramask. |

`tiles_select` takes terramask's selectors: presets (`buildings`, `roads`,
`paths`, `rail`, `water`, `forest`, `parks`…) and `layer:class` rules, where a
name is a class or a subclass (`landcover:park` is the parks among landcover
`grass`) and `class/subclass` names one pair (`landcover:grass/grass`, the
lawns). Each feature comes mended across tile edges, so a building or a road
cut by two tiles is one feature again, with the tile's attributes as tags
(`class`, `subclass`, `brunnel`, `layer`…). The tiles are a handful of static
files per card on a CDN, cached for years; Overpass has every OSM tag but is
slow and often busy. A card that uses only `tiles_select` never asks Overpass.

The two mix, feature set by feature set. Overpass is asked for the keys the
card's `osm_select`s name and nothing else, so taking only the roads from it
(where `width` and `lanes` give real widths; the tiles have neither) keeps the
request small: over Berkeley `highway=*` alone is 1.4 MB against 4.2 MB for
the whole card. `configs/compare/` holds the card three ways: `tiles.yaml`,
`mixed.yaml` (roads from Overpass, the rest from tiles) and `overpass.yaml`.

```yaml
$features:
  bldg: { tiles_select: buildings }
  ways: { osm_select: { highway: true } }
$areas:
  roads: { module_roads: { from: $features.ways } }
```

| OSM tags (Overpass) | Tiles |
|---|---|
| `building=*` | `buildings` |
| `leisure=park` / `garden` | `landcover:park,garden` |
| `landuse=grass`, `landuse=forest`, `natural=wood` | `landcover:grass/grass,wood` |
| `water=*`, `natural=water` | `water:lake,river,pond,dock` |
| `highway=*` | `roads`, `paths` (with `module_roads: { from: … }`) |

`osm_` and `engine_` are different prefixes because they are different things:
one is **data**, the other is **computed geometry**. `$areas.wet` below unions
them only when you want a single shape.

### Modules — `module_*`

A module is compiled code, published as one def:

```yaml
$areas:
  roads:
    module_roads: {}
```

It reads every OSM feature by default. `from` hands it a feature set of its
own instead, such as the roads of the vector tiles, which it reads in their
OpenMapTiles terms (class, subclass, `brunnel`):

```yaml
$features:
  ways: { tiles_select: [roads, paths] }
$areas:
  roads: { module_roads: { from: $features.ways } }
```

It defines fixed outputs the profile may use or ignore — for roads/v1:

| Output | Result |
|---|---|
| `roads.area` | the carriageway plus the strip each trail covers (the mask) |
| `roads.outlines` | the carriageway boundary |
| `roads.centerlines` | a centre line down each road 6 m wide or more, whole: dash it (or not) with the draw's `stroke` |
| `roads.seams` | where a bridge deck crosses over the road below |
| `roads.details` | the centre lines already dashed (0.3 mm on, 0.35 mm off) plus the seams |
| `roads.trails` | footways, paths, tracks, steps, cycleways, bridleways as single lines |

The width comes from OSM's `width` or `lanes` (3 m a lane) when Overpass
gives them; tile roads have neither, so their class decides (secondary and
up are 6 m or more). Style the centre lines like any line, or leave the draw
out to have none:

```yaml
draw:
  - { id: roads_center, from: roads.centerlines, stroke: { style: dash, dash: 0.3mm, gap: 0.35mm } }
  - { id: roads_seam,   from: roads.seams, stroke: solid }
```

The module's internal names are **not** module-prefixed (`roads.area`, not
`module_roads.area`): the `module_` prefix belongs to the *definition*, and the
outputs are namespaced by the instance name you gave it. That lets two road
families coexist later (`roads`, `roads_historic`) without collisions.

Module names never start with `$`: they are code, not your variables.

---

## Yours: `$features`, `$areas`, `$lines`, `$fills`, `$recipes`

Every entry is a **key you choose** plus **exactly one operation** as its value.
The key may repeat across sections — that is the point:

```yaml
$areas:
  river: { tools_difference: { base: { osm_select: { waterway: river } }, cut: … } }
$lines:
  river: { tools_rings: $areas.river }
$fills:
  river: { tools_fill: { in: $areas.river, pattern: grass, spacing: 0.6mm } }
```

Three different `river`s, told apart by the section. A reference is always
qualified — `$areas.river`, `$fills.river` — so `from: $lines.river` cannot be
confused with any other `river`.

### Types are checked by the section

| Section | Holds | `from:` of a draw needs |
|---|---|---|
| `$features` | feature sets | — (sources, not drawn) |
| `$areas` | areas | an area, when used as a mask |
| `$lines` | line sets | a line set |
| `$fills` | line sets (penfill output) | a line set |

`$fills` is really `$lines` produced by a pattern. Keeping it separate is a
declaration of intent, and it is what makes the toolkit list readable: fills are
the only entries that call penfill.

### `$recipes` — named chains (optional, for later)

A recipe names a **chain of operations**, so a shape used by several draws is
written once. It is not a function call: it is a sub-graph with named outputs.

```yaml
$recipes:
  building-shell:
    from: { osm_select: { building: true } }
    outlines: { tools_rings: { tools_union: $areas.footprints } }
    details:
      tools_clip:
        lines: { tools_dedupe: { tools_segments: { osm_select: { building: true } } } }
        within: $areas.inner-band
```

Whether recipes land in v3 or later is an open question below. The long form
without recipes must stay expressible.

---

## `draw:` — ink, not geometry

Each entry takes geometry (a `$lines` or `$fills` name, or a module output) and
gives it a style and an SVG group id.

```yaml
draw:
  - { id: parks_ring, from: $lines.parks_edge, stroke: { style: dash, dash: 0.45mm, gap: 0.40mm } }
  - { id: parks_fill, from: $fills.parks }
  - { id: river_line, from: $fills.river }
  - { id: roads_out,  from: roads.outlines, stroke: solid }
  - { id: roads_det,  from: roads.details }
  - { id: bldg_wall,  from: $lines.shared_walls, stroke: solid }
  - { id: bldg_fill,  from: $fills.buildings }
  - { id: bldg_ring,  from: $lines.building_outline, stroke: solid }
```

`draw.from` accepts engine names too (`roads.outlines`), but nothing without a
`$` can be a name you invented — a typo like `from: parks_ext` fails at load.

`id` is free-form; it is what `compose` refers to. Keeping it unmarked is
deliberate: it is not a variable, it is an SVG group.

---

## `compose:` — order, masks, selective clip

```yaml
compose:
  order:                 # bottom → top in the SVG
    - parks_ring
    - parks_fill
    - water_ring
    - water_fill
    - roads_out
    - roads_det
    - bldg_wall
    - bldg_fill
    - bldg_ring

  masks:                 # areas that hide ink
    parks_cover:
      from: $areas.parks_ext
      occludes: [water_fill, water_ring, roads_out, roads_det, bldg_wall, bldg_fill, bldg_ring]
    wet_cover:
      from: $areas.wet
      occludes: [parks_fill, parks_ring, roads_out, roads_det, bldg_wall, bldg_fill, bldg_ring]
    roads_cover:
      from: roads.area
      occludes: [parks_fill, parks_ring, water_fill, water_ring]
    bldg_cover:
      from: $areas.dissolved
      occludes: [parks_fill, parks_ring, water_fill, water_ring, roads_out, roads_det]

  clip:
    default: auto
```

The three answers composition gives:

1. **order** — plot order of the draw ids.
2. **masks** — `from:` must be an area (`$areas.*` or `roads.area`); `occludes`
   lists the draw ids it hides.
3. **clip** — per draw id:

| `clip` value | Behaviour |
|---|---|
| `auto` | subtract the union of the masks **above** this id in `order` whose `occludes` mentions it |
| `none` | never clipped (a hatch drawn on top that cuts nothing) |
| `[$areas.a, …]` | explicit list |

Because `occludes` names ids, a mask can hide some things and not others —
the case that today's engine cannot express (`compose.rs` unions every mask
above and clips everything).

A draw id with no mask entry draws and cuts nothing. That is how a card can
hatch schools over everything without punching holes in the terrain.

---

## Walkthrough — one name, three sections

River, dashed inside, with a stipple in the same file:

```yaml
$features:
  river_f: { osm_select: { waterway: river } }

$areas:
  river: { tools_polygons: { tools_grow: { of: $features.river_f, by: 30m } } }

$lines:
  river: { tools_rings: $areas.river }

$fills:
  river: { tools_fill: { in: $areas.river, pattern: grass, spacing: 0.6mm } }

draw:
  - { id: river_edge, from: $lines.river, stroke: { style: dash, dash: 0.6mm, gap: 0.4mm } }
  - { id: river_fill, from: $fills.river }
```

Reading `from: $lines.river` you know three things at once: it is yours, it is a
line set, and it is the river's. In the v2 form (`from: river_lines`) you knew
none of them without scrolling.

---

## Full sketch — default postcard

```yaml
card:
  width: 6in
  height: 4in
  scale: "1:10000"
  bearing: 0
  projection: webmercator

$features:
  garden: { osm_select: { leisure: garden } }
  park:   { osm_select: { leisure: park } }
  wood:   { osm_select: { natural: wood, landuse: forest, leisure: nature_reserve } }
  grass:  { osm_select: { landuse: [grass, meadow], natural: grassland } }
  wet:    { osm_select: { water: true, natural: water } }
  bldg:   { osm_select: { building: true } }

$areas:
  garden: { tools_polygons: $features.garden }
  park:   { tools_difference: { base: { tools_polygons: $features.park }, cut: $areas.garden } }
  wood:   { tools_difference: { base: { tools_polygons: $features.wood }, cut: [$areas.garden, $areas.park] } }
  grass:  { tools_difference: { base: { tools_polygons: $features.grass }, cut: [$areas.garden, $areas.park, $areas.wood] } }

  parks:     { tools_union: [$areas.garden, $areas.park, $areas.wood, $areas.grass] }
  parks_ext: { tools_fill_holes: $areas.parks }
  wild:      { tools_difference: { base: $areas.parks_ext, cut: [$areas.garden, $areas.park, $areas.wood, $areas.grass] } }

  inland:  { tools_polygons: $features.wet }
  sea:     { engine_ocean: {} }
  wet:     { tools_union: [$areas.inland, $areas.sea] }

  footprints: { tools_polygons: $features.bldg }
  dissolved:  { tools_union: [$areas.footprints] }
  inner_band: { tools_grow: { of: $areas.dissolved, by: -0.1mm } }

  roads: { module_roads: {} }

$lines:
  parks_edge: { tools_rings: { of: $areas.parks_ext, exterior_only: true } }
  wet_ring:   { tools_rings: $areas.wet }

  building_outline:
    tools_join:
      - { tools_rings: $areas.dissolved }
      - { tools_lines: $features.bldg }

  shared_walls:
    tools_clip:
      lines: { tools_dedupe: { tools_segments: $features.bldg } }
      within: $areas.inner_band

$fills:
  garden: { tools_fill: { in: $areas.garden, pattern: dots, spacing: 0.25mm, mark: 0.2mm, angle: 45 } }
  park:   { tools_fill: { in: $areas.park,   pattern: dots, spacing: 0.45mm, mark: 0.2mm, angle: 45 } }
  wood:   { tools_fill: { in: $areas.wood,   pattern: dots, spacing: 0.70mm, mark: 0.2mm, angle: 45 } }
  grass:  { tools_fill: { in: $areas.grass,  pattern: dots, spacing: 0.85mm, mark: 0.2mm, angle: 45 } }
  wild:   { tools_fill: { in: $areas.wild,   pattern: dots, spacing: 0.70mm, mark: 0.2mm, angle: 45 } }
  wet:    { tools_fill: { in: $areas.wet,    pattern: waves, spacing: 0.75mm, angle: 0 } }
  bldg:   { tools_fill: { in: $areas.footprints, per: feature, pattern: zigzag, spacing: 0.5mm, angle: 45 } }

draw:
  - { id: parks_ring, from: $lines.parks_edge, stroke: { style: dash, dash: 0.45mm, gap: 0.40mm } }
  - { id: parks_fill_g, from: $fills.garden }
  - { id: parks_fill_p, from: $fills.park }
  - { id: parks_fill_w, from: $fills.wood }
  - { id: parks_fill_r, from: $fills.grass }
  - { id: parks_fill_x, from: $fills.wild }
  - { id: water_ring, from: $lines.wet_ring, stroke: solid }
  - { id: water_fill, from: $fills.wet }
  - { id: roads_out, from: roads.outlines, stroke: solid }
  - { id: roads_det, from: roads.details }
  - { id: bldg_wall, from: $lines.shared_walls, stroke: solid }
  - { id: bldg_fill, from: $fills.bldg }
  - { id: bldg_ring, from: $lines.building_outline, stroke: solid }

compose:
  order:
    - parks_ring
    - parks_fill_g
    - parks_fill_p
    - parks_fill_w
    - parks_fill_r
    - parks_fill_x
    - water_ring
    - water_fill
    - roads_out
    - roads_det
    - bldg_wall
    - bldg_fill
    - bldg_ring
  masks:
    parks_cover:
      from: $areas.parks_ext
      occludes: [water_fill, water_ring, roads_out, roads_det, bldg_wall, bldg_fill, bldg_ring]
    wet_cover:
      from: $areas.wet
      occludes: [parks_fill_g, parks_fill_p, parks_fill_w, parks_fill_r, parks_fill_x, parks_ring, roads_out, roads_det, bldg_wall, bldg_fill, bldg_ring]
    roads_cover:
      from: roads.area
      occludes: [parks_fill_g, parks_fill_p, parks_fill_w, parks_fill_r, parks_fill_x, parks_ring, water_fill, water_ring]
    bldg_cover:
      from: $areas.dissolved
      occludes: [parks_fill_g, parks_fill_p, parks_fill_w, parks_fill_r, parks_fill_x, parks_ring, water_fill, water_ring, roads_out, roads_det]
  clip:
    default: auto
```

Same look as `configs/postcard.yaml` today, with the composition and the masks
written down instead of implied by list order.

---

## Variant — schools only, no masks

The card that is only hatching, on top of everything:

```yaml
$features:
  school: { osm_select: { amenity: school } }

$areas:
  school: { tools_polygons: $features.school }

$fills:
  school: { tools_fill: { in: $areas.school, pattern: zigzag, spacing: 0.4mm, angle: 45 } }

draw:
  - { id: school_fill, from: $fills.school }

compose:
  order: [school_fill]
  masks: {}          # nothing hides anything
  clip:
    default: none    # never clipped
```

No areas are reused as masks, so no roads, rivers or terrain get cut: exactly
the "draw dashed buildings over another layer without cutting anything" case.

---

## Relation to today

| Today | This proposal |
|---|---|
| `layers[]` + modules | `$features` / `$areas` / `$lines` / `$fills` + `module_roads` |
| Module names hard-coded | Module defines its own outputs; name is the profile's instance key |
| `LayerParts` four slots | sections; you choose what goes in `draw` |
| `compose.rs` clips by union above | `compose.masks[].occludes` names the ids a mask hits |
| `ocean` inside the water filter | `engine_ocean` as a source, unioned only if wanted |
| `steps:` | the same operations, as keys of a section |
| Implicit theme order | `compose.order` only |

What changes in behaviour:

- **Nothing is drawn by default.** A layer with no `draw` entry is geometry only.
- **A mask hits only what it names** — the engine no longer applies "everything
  above clips everything below".
- **`fill_holes` applies to the mask too**, so a park with a pond no longer
  lets terrain show through the pond.

---

## Validation

Load-time errors, each naming the offending key:

- Unknown operation, or an operation in the wrong section (an area op in
  `$lines`).
- A reference without `$` that is not an engine name or a module output.
- A reference to a section that does not exist, or to a name in the wrong
  section (`masks.from: $fills.river`).
- The same name twice inside one section.
- A cycle across `$areas` / `$lines` / `$fills`, reported with the loop.
- `draw.from` pointing at `$features` (feature sets are sources, not ink).
- A module output referenced when the module is not defined.
- A module definition in a section other than the one it publishes.
- An id in `order` that is not in `draw`; an id in `occludes` that is not in
  `draw`.

Debug (later): `postcards-rs def show '$areas.dissolved' -o dissolved.svg`.

---

## Open questions

1. **Kit prefix.** `tools_`, `engine_`, `osm_` as above, or no prefix and rely
   on the closed list of keywords? Prefixes cost verbosity and buy the ability
   to tell "the engine does this" from "I defined this" in one glance.
2. **`$recipes`.** In v3 or later? The long form must stay expressible either
   way.
3. **Same name across sections** — encouraged (as `river` above), or should
   base names be unique across the file to avoid confusion?
4. **Multiple `from` in one draw**, to gather e.g. five park fills into one SVG
   group.
5. **Second file** — split `$features` / `$areas` (catalog) from `draw` /
   `compose` (style) so one catalog serves several cards?
6. **Scale units** — `grow: 30m` mixes metres (ground) with card millimetres
   (`0.5mm`). Intentional, or should everything be card mm?
7. **`~` for expressions** — kept, or reuse `$` and let the section give the
   type? Decided for `~`; revisit if it reads badly in practice.

---

## Older files

- `configs/proposal/postcard.yaml` — v3 shape (this document's grammar).
- `docs/plan.md` — phases; the parser lands as "phase 3b".
