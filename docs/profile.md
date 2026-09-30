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
card ──► layers ──► stack ──► SVG
          │           │
          │           └─ top first: each layer hides the layers below it,
          │              wherever its mask is
          └─ each layer: select → area → outline / lines / details / fill
```

Three rules cover everything:

1. **A layer is a fixed set of keys, each answering one question.** No step
   lists: nothing depends on the order the keys are written in.
2. **The stack is one list, top first**, like the layers panel of a drawing
   program. The layer at the top is drawn over everything.
3. **What isn't written isn't drawn.** No hidden default outlines, no
   default fills. A module can compute geometry, but the profile decides
   which parts are drawn and how.

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
| `<layer id>` | Another layer's area. |

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

Referring to another layer's area makes this layer wait for it. `rest`
waits for every layer above. A loop is an error.

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
- A layer in `layers` but not in `stack` is **not drawn**. It can still be
  used as an area by name. It's a helper, e.g. a "coast" band that two
  layers share.

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
a helper area, `within`, `grow`, a halo mask and `hides`.

```yaml
card: { width: 6in, height: 4in, scale: "1:5000", bearing: 25 }

stack:
  - buildings
  - roads
  - beach
  - water
  - trees
  - terrain

layers:
  coast:                       # helper: not in the stack, so not drawn
    area: { from: water, grow: 3mm, minus: water }

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
    select: { water: true, natural: water }
    area: { from: [features, ocean] }
    fill: { pattern: waves, spacing: 1mm }   # no outline: the beach edge draws the shore

  trees:
    select: { natural: wood, landuse: forest }
    area: { minus: coast }     # the woods, but never on the beach
    fill: { pattern: grass, spacing: 0.8mm }

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
- An id in `stack`, `group`, `hides` or an area expression that doesn't
  exist.
- A layer in both the stack and a group, or in two groups.
- `rest` in a layer that is in neither the stack nor a group.
- `module` together with `select` or `area`.
- A loop between area references.
- A layer in the stack that draws nothing (no `outline`, `lines`,
  `details` or `fill`), unless it's a helper that is only referenced.

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
5. **Names:** `card` / `stack` / `rest` / `hides` / `pattern` — happy with
   them?
