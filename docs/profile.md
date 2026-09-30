# Profile grammar — proposal

**Status: a proposal to edit, nothing here is implemented yet.** Once it
settles, it replaces the current schema (`module:` / `steps:` layers,
`compose.order`) and `configs/*.yaml` are rewritten in it.

## Why change it

Today a profile says *what* each layer draws, but not how the layers
compose:

- **Order is implicit.** Layers are listed bottom-first and "each layer is
  clipped by the areas of the layers after it". That rule lives in a
  comment and in `compose.rs`, not in the file.
- **Masks are implicit.** Which shape hides the layers below is decided
  inside each module (buildings: the union; parks: the union without holes,
  while its fill ignores the holes; rail: nothing).
- **Modules hide structure.** Park kinds claim area in a fixed order, and a
  "leftover" kind fills the rest. Both are a stack inside the layer that
  the profile can't see.
- **Steps are procedural.** `select → union → emit mask → outline → emit
  outlines → fill_each` has to be traced in order to know what it draws.

## The model

```text
card ──► areas ──► layers ──► stack ──► SVG
          │          │          │
          │          │          └─ top first: each layer hides the layers
          │          │             below it, wherever its mask is
          │          └─ each layer: select → area → outline / lines / details / fill
          └─ named areas: computed once, used by name anywhere
```

Four rules cover everything:

1. **A layer is a fixed set of keys, each answering one question.** No step
   lists: nothing depends on the order the keys are written in.
2. **The stack is one list, top first**, like the layers panel of a drawing
   program. The layer at the top is drawn over everything.
3. **What isn't written isn't drawn.** No hidden default outlines, no
   default fills. A module can compute geometry, but the profile decides
   which parts are drawn and how.
4. **Areas have names.** A shape built from other shapes is written once
   in `areas:`, computed once, and used by name wherever it's needed.

## Layer keys

| Key | Question | Value |
|---|---|---|
| `select` | Which OSM features? | Tag filter: any listed tag matches. `except:` removes features, `underground: include` keeps negative `layer`/`level`. |
| `module` | Is the geometry computed by built-in code? | `roads/v1`. It replaces `select` and `area` and offers named `details`. |
| `area` | What surface does the layer own? | See [Areas](#areas). Default: the union of the selected polygons. |
| `outline` | How is the area's boundary drawn? | A stroke. `rings: exterior` skips the holes. |
| `lines` | How are the selected linear features drawn? | A stroke (rail, paths, contour lines). |
| `details` | Which extra strokes inside the area? | Named sets: `shared_walls` for OSM areas, module-specific ones for modules. Each takes a stroke. |
| `fill` | Which pattern inside the area? | A fill spec. `per: feature` fills each feature on its own instead of the whole area. |
| `mask` | What hides the layers below? | Default `area`. `none`, or an area expression (e.g. `{ from: area, grow: 0.3mm }`). |
| `hides` | Which layers below? | Default `below` (all of them). A list of ids to hide only those. |
| `group` | Is this layer a small stack? | A list of member layer ids, top first. See [Groups](#groups). |

### Strokes

`solid`, `none`, or a mapping:

```yaml
outline: { style: dash, dash: 0.45mm, gap: 0.40mm }   # solid | dash | dotted | none
lines:   { style: dotted, gap: 0.5mm, mark: 0.1mm }
```

### Fills

The same fill spec as today, with `pattern` as the name of the penfill
generator (`generator` stays as an alias):

```yaml
fill: { pattern: zigzag, spacing: 0.5mm, angle: 45, inset: 0.1mm, seed: 7 }
fill: { pattern: dots, spacing: 0.5mm, mark: 0.2mm, lattice: hex }   # generator options inline
fill: { source: { file: art.svg, size: contain } }                   # an SVG instead of a pattern
fill: { pattern: zigzag, spacing: 0.5mm, per: feature }              # each footprint on its own
```

## Areas

`area` is either a keyword or a mapping.

| Keyword | Means |
|---|---|
| *(omitted)* | Union of the selected polygons (`features`). |
| `features` | Same, written out. |
| `card` | The whole card. |
| `rest` | The card minus the masks of every layer above this one in the stack. Inside a group, the group's area minus the members above. |
| `ocean` | Sea polygons, when the card shows a coastline. |
| `<name>` | A named area from `areas:`, or another layer's area by its id. |

The mapping form combines them. Keys apply in this order:

```yaml
area:
  from: [features, ocean]   # union of these (one keyword or a list)
  lines: 1.2mm              # also: the selected lines, buffered to this width
  fill_holes: true          # drop the holes
  within: parks             # keep only what is inside these areas
  minus: [water, roads]     # remove these areas
  grow: 2mm                 # buffer out (negative: shrink)
```

### Named areas: the variables

A shape that depends on earlier shapes is defined once in `areas:` and
then used by name. An entry takes the same keys as a layer's `area`, plus
an optional `select`:

```yaml
areas:
  wet:     { select: { water: true, natural: water }, from: [features, ocean] }
  green:   { select: { leisure: park, landuse: [grass, forest] }, fill_holes: true }
  built:   { select: { building: true } }
  dry:     { from: green, minus: wet }                     # green, without its ponds
  shore:   { from: wet, grow: 3mm, minus: wet }            # a 3 mm band along every shore
  open:    { from: card, minus: [built, roads, wet] }      # roads: the roads layer's area
  meadows: { from: open, within: shore }                   # uses two other names
```

- **One namespace.** A name is either an entry in `areas:` or a layer id,
  which stands for that layer's area. `<id>.mask` is the layer's mask when
  it differs from its area. Using the same name twice is an error.
- **Computed once.** However many layers and areas use `shore`, it's built
  once and shared. An area nobody uses isn't computed at all.
- **Areas before ink.** Referencing a layer waits for its area, not for its
  fill or outline. `open` can start as soon as the roads *area* exists,
  while roads' details are still being drawn.
- **Order doesn't matter.** Entries can refer to entries written below
  them. The planner sorts them (a dependency graph) and computes what's
  independent in parallel. A loop is an error naming the areas involved.
- `rest` is the one name that isn't global: it depends on where the layer
  sits in the stack, so it's only valid inside a layer.
- `postcards-rs areas --profile … --show shore` (later) writes one named
  area as an SVG, to check a step of the chain.

## Masks and the stack

Composition is exactly this, and nothing else:

> Walk the stack from the top. Each layer's ink is clipped away wherever a
> layer above it has a mask that `hides` it.

- A layer's `mask` is its `area` unless it says otherwise.
- A layer with only `lines` (rail) has no area, so its mask is `none`
  unless it asks for one: `mask: { from: lines, grow: 0.3mm }`.
- `mask: { from: area, grow: 0.3mm }` leaves a white halo: the layers below
  stop short of the edge.
- `hides: [parks, terrain]` lets a layer cover some layers and draw over
  others.
- A layer in `layers` but not in `stack` (or in a group) is an error:
  shapes that are only computed, not drawn, go in `areas:`.

## Groups

A group is a stack inside a layer. Park kinds are the example: a garden
inside a park claims its area first, so the park's fill doesn't draw over
it.

```yaml
parks:
  group: [garden, park, wood, grass, wild]   # top first, like the stack
  area: { fill_holes: true }                 # the group's area: union of its members
  outline: { style: dash, dash: 0.45mm, gap: 0.40mm, rings: exterior }
  fill: { pattern: dots, angle: 45, mark: 0.2mm }   # members inherit it
```

- The group's area is the union of its members' areas, then the group's
  own `area` keys apply (`fill_holes`, `minus`, …).
- Members compose among themselves inside the group's area. The outer
  stack sees only the group's mask.
- Members inherit the group's `fill` fields they don't set.
- Members' ink goes into the group's SVG groups (`parks_filling`, …).

A group is only shorthand. The same parks written out with named areas,
where each kind subtracts the kinds above it:

```yaml
areas:
  garden_a: { select: { leisure: garden } }
  park_a:   { select: { leisure: park }, minus: garden_a }
  wood_a:   { select: { natural: wood, landuse: forest }, minus: [garden_a, park_a] }
  parks_a:  { from: [garden_a, park_a, wood_a], fill_holes: true }
  wild_a:   { from: parks_a, minus: [garden_a, park_a, wood_a] }

layers:
  parks:
    area: parks_a
    outline: { style: dash, dash: 0.45mm, gap: 0.40mm, rings: exterior }
  # … plus one fill-only layer per kind, each with `area: garden_a` etc.
```

Both are valid. The group is shorter and keeps the claim order in one
list; the long form is there when a kind needs to be carved by something
outside the park (e.g. `wood_a: { …, minus: shore }`).

## Modules

A module is built-in code for geometry the keys can't express. It replaces
`select` and `area`, and publishes named `details` the profile can draw or
leave out. Only `roads/v1` remains:

```yaml
roads:
  module: roads/v1
  outline: solid
  details:
    centerlines: { style: dash, dash: 0.3mm, gap: 0.35mm }   # ways ≥ 6 m wide, erased under higher decks
    bridge_seams: solid                                       # where a deck crosses a road below
  options:
    widths: { motorway: 15m, primary: 7m, residential: 4m }  # overrides the built-in table
```

roads/v1 selects `highway=*` (minus crossings, sidewalks and tunnels) and
buffers each way by half its ground width. The width comes from `width`,
then `width:lanes`, then `lanes`, then the table. Bridges are stacked by
`layer`.

Buildings, parks and water no longer need modules: they are plain layers
and a group (see below).

## Example 1 — the default card

Equivalent to today's `configs/postcard.yaml`.

```yaml
card:
  width: 6in
  height: 4in
  scale: "1:10000"
  bearing: 0
  projection: utm            # utm | webmercator
  # address: "1730 Highland Pl, Berkeley, CA 94709"   (--address / --lat --lng override)

stack:                       # top first: each layer hides the ones below it
  - buildings
  - roads
  - water
  - parks

layers:
  buildings:
    select: { building: true }
    outline: solid
    details: { shared_walls: solid }
    fill: { pattern: zigzag, spacing: 0.5mm, angle: 45, per: feature }

  roads:
    module: roads/v1
    outline: solid
    details:
      centerlines: { style: dash, dash: 0.3mm, gap: 0.35mm }
      bridge_seams: solid

  water:
    select: { water: true, natural: water }
    area: { from: [features, ocean] }
    outline: solid
    fill: { pattern: waves, spacing: 0.75mm, angle: 0 }

  parks:
    group: [garden, park, wood, grass, wild]
    area: { fill_holes: true }
    outline: { style: dash, dash: 0.45mm, gap: 0.40mm, rings: exterior }
    fill: { pattern: dots, angle: 45, mark: 0.2mm }

  garden: { select: { leisure: garden }, fill: { spacing: 0.25mm } }
  park:   { select: { leisure: park }, fill: { spacing: 0.45mm } }
  wood:   { select: { natural: wood, landuse: forest, leisure: nature_reserve }, fill: { spacing: 0.70mm } }
  grass:  { select: { landuse: [grass, meadow], natural: grassland }, fill: { spacing: 0.85mm } }
  wild:   { area: rest, fill: { spacing: 0.70mm } }    # inside parks, claimed by no kind
```

## Example 2 — more layers, no modules but roads

Equivalent to today's `configs/examples/steps.yaml`: terrain on whatever
is left, piers, dashed rail.

```yaml
card: { width: 6in, height: 4in, scale: "1:10000" }

stack:
  - buildings
  - rail
  - roads
  - piers
  - water
  - parks
  - terrain

layers:
  buildings:
    select: { building: true }
    outline: solid
    fill: { pattern: zigzag, spacing: 0.75mm, angle: 45, per: feature }

  rail:
    select: { railway: [rail, light_rail, tram, subway], except: { tunnel: [yes] } }
    lines: { style: dash, dash: 1.2mm, gap: 0.6mm }
    # no area, so no mask: rail draws over roads without cutting them

  roads:
    module: roads/v1
    outline: solid

  piers:
    select: { man_made: pier }
    outline: solid
    fill: { pattern: lines, spacing: 0.6mm, angle: 90 }

  water:
    select: { water: true, natural: water }
    area: { from: [features, ocean] }
    outline: solid
    fill: { pattern: waves, spacing: 0.75mm }

  parks:
    group: [garden, green]
    area: { fill_holes: true }
    outline: { style: dash, dash: 0.45mm, gap: 0.40mm, rings: exterior }
    fill: { pattern: dots, angle: 45, mark: 0.2mm }
  garden: { select: { leisure: garden }, fill: { spacing: 0.25mm } }
  green:  { select: { leisure: park, natural: [wood, grassland], landuse: [forest, grass, meadow] }, fill: { spacing: 0.6mm } }

  terrain:
    area: rest                 # the card minus every mask above
    fill: { pattern: stipple, spacing: 1.6mm, mark: 0.15mm, seed: 7 }
```

## Example 3 — using the masks

A sketchier card that uses the parts of the grammar the first two don't:
a chain of named areas (`coast` is built on `wet`, `near_sea` on
`coast`), `grow`, a halo mask and `hides`.

```yaml
card: { width: 6in, height: 4in, scale: "1:5000", bearing: 25 }

areas:
  wet:     { select: { water: true, natural: water }, from: [features, ocean] }
  coast:   { from: wet, grow: 3mm, minus: wet }        # built on wet
  woods:   { select: { natural: wood, landuse: forest }, minus: coast }
  near_sea: { from: coast, grow: 10mm, minus: [wet, coast] }   # built on coast

stack:
  - buildings
  - roads
  - beach
  - water
  - trees
  - dunes
  - terrain

layers:
  buildings:
    select: { building: true }
    outline: solid             # no fill: outlines only
    hides: [terrain]           # buildings cut the stipple but not the beach

  roads:
    module: roads/v1
    outline: solid
    mask: { from: area, grow: 0.4mm }   # a white halo along every road

  beach:
    area: coast
    fill: { pattern: stipple, spacing: 0.5mm, mark: 0.1mm }

  water:
    area: wet
    fill: { pattern: waves, spacing: 1mm }   # no outline: the beach edge draws the shore

  trees:
    area: woods                # the woods, never on the beach
    fill: { pattern: grass, spacing: 0.8mm }

  dunes:
    area: { from: near_sea, minus: woods }
    fill: { pattern: scribble, spacing: 1.2mm }

  terrain:
    area: rest
    fill: { source: { file: art/relief.svg, size: cover } }   # later: burin
```

## From today's profile

| Today | Proposed |
|---|---|
| `map:` | `card:` |
| `layers:` list, bottom-first, `compose.order` | `stack:` list, top first. `layers:` is a map by id. |
| `- id: x` | `x:` |
| `module: buildings/v1` | `select: { building: true }`, `details: { shared_walls }`, `fill: { per: feature }` |
| `module: parks/v1` + `kinds` + `options.leftover` | A `group` of member layers, `rest` for the leftover |
| `module: water/v1` | `select` + `area: { from: [features, ocean] }` |
| `module: roads/v1` | Unchanged, plus named `details` |
| `steps:` | `select` / `area` / `outline` / `lines` / `fill` / `mask` keys |
| `region: leftover` | `area: rest` |
| `difference x` / `intersect x` | `area: { minus: x }` / `area: { within: x }` |
| A step chain reused by several layers | A named entry in `areas:` |
| `buffer` | `area: { grow: … }` or `area: { lines: … }` |
| `emit: mask` | Implicit (`mask` defaults to `area`), or `mask:` |
| `fill_each` | `fill: { per: feature }` |
| `stroke:` | `outline:` or `lines:` |
| `fill.generator` | `fill.pattern` (alias kept) |

What behaves differently:

- **Order reads the other way** (top first).
- **Nothing is drawn by default.** Today a module layer with no `stroke`
  still draws a solid outline.
- **`fill_holes` applies to the mask too.** Today the parks fill covers
  holes that the parks mask leaves open, so a layer below (terrain) also
  draws in them.
- **The kind order is the profile's**, not the module's built-in list.

## Validation

Errors, reported with the layer id:

- Unknown keys, unknown patterns or modules.
- A name in `stack`, `group`, `hides` or an area expression that is
  neither a layer nor an entry in `areas:`.
- The same name used for a layer and a named area.
- A layer in both the stack and a group, in two groups, or in neither.
- `rest` in `areas:` (it only means something inside a layer).
- `module` together with `select` or `area`.
- A loop between areas, reported with the names in the loop
  (`coast → wet → coast`).
- A layer that draws nothing (no `outline`, `lines`, `details` or
  `fill`): a shape that is only computed belongs in `areas:`.

## Open questions

1. **Separate `stack:` or ordered `layers:`?** The proposal keeps the order
   in one short list at the top, so the composition reads at a glance. The
   alternative is `layers:` as an ordered map (top first), which is one
   place instead of two.
2. **Group members as top-level layers or nested?** Top-level (as above)
   keeps a single kind of layer and lets members be referenced by id.
   Nested inside the group is more compact.
3. **`select` values:** `true` for "any value" (today), or `any`?
4. **Defaults:** is "nothing drawn unless written" right, or should a
   layer with an area and no keys at least get a solid outline?
5. **Names:** `card` / `areas` / `stack` / `rest` / `hides` / `pattern` —
   happy with them?
6. **Named areas with `select` inside:** allowed (as above, so `wet` is one
   line), or should `areas:` only combine other names and keywords, leaving
   OSM selection to layers?
