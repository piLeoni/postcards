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

The grammar in this document is implemented in `crates/postcards-core/src/grammar.rs`
and covered by tests, including a test that loads `configs/proposal/postcard.yaml`.

What loads and validates today:

- `card`, the four `$` sections, `draw`, `compose.order` / `masks` / `clip`;
- every operation in the toolkit table, with section typing: `tools_rings`
  written under `$areas` is a load error;
- references (`$areas.river`), and module outputs (`roads.outlines`,
  `roads.area`) in `draw.from` and `masks.from`;
- `$expressions` and `~name`: recognised, rejected with a "lands in v4" error;
- `module_*`: recorded as `Op::Module` — its outputs are not resolvable yet,
  because v3 has no syntax to name them (see open question 4);
- `primitives_*`: not defined in this build;
- loops between defs, duplicate names, dangling references, two operations in
  one def: load errors, not surprises at render time.

Still to come: the executor that turns this `Grammar` into the geometry
pipeline, and the `compose.masks[].occludes` wiring.

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

A primitive carries a contract: **one canonical expansion**, documented, and
the engine guarantees the primitive and its expansion produce identical output
(a test per primitive, comparing the two SVGs). That is what keeps a primitive
honest sugar instead of an opaque module.

Today: `buildings`, `parks`, `water`, `rail`, `piers` are primitives (all of
them are already `tools_*` chains); `roads` is a module, because ground width
per tag, bridge stacking, joint disks and erased centre lines are code. A
plain "roads primitive" (uniform buffer per class, no bridges) can exist
besides the module, but is not needed yet.

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
| **Engine sources** | `osm_select`, `engine_card`, `engine_ocean` | the engine | yes: closed list |
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
card              paper frame, centre, projection          (schema, no marker)
$features         OSM selections: tag filters only
$areas            areas  (multi-polygons in card mm)
$lines            line sets
$fills            penfill patterns: already line sets
$recipes          reusable chains of the above (optional)
draw              which names become ink, and how          (schema, no marker)
compose           order, masks, selective clip              (schema, no marker)
```

Sections **without** `$` (`card`, `draw`, `compose`) are the engine's schema.
Sections **with** `$` are yours. That single visual rule tells you, on opening
any profile, what is grammar and what is content.

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
| `tools_fill: { in, pattern, … }` | lines | penfill into an area. `per: feature` runs one pattern per polygon. |

### Engine sources — `engine_*` / `osm_*`

| Source | Result | Notes |
|---|---|---|
| `engine_card: {}` | area | The card rectangle. |
| `engine_ocean: {}` | area | The sea, from coastline tiles. **Not** an OSM tag: a host function, empty inland. |
| `osm_select: { building: true }` | features | Tag filter; `except:`, `underground:`. |

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

It defines fixed outputs the profile may use or ignore — for roads/v1:

| Output | Result |
|---|---|
| `roads.area` | the carriageway as one area (the mask) |
| `roads.outlines` | the mask boundary |
| `roads.details` | centre lines and bridge seams, already generated |

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
  projection: utm

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
