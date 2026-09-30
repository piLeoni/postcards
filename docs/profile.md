# Profile grammar — proposal (v2)

**Status: proposal only — no implementation until this reads right.**  
YAML is the sketch format; the same graph could be JSON5 or a small DSL. What
matters is the **shape**: named geometry, named ink, explicit clip rules — not
four fixed theme names.

## What was wrong with v1

The first draft still looked like today's product: a `stack` of `buildings`,
`roads`, `water`, `parks`, each with implicit `outline` + `fill` + `mask`. That
presupposes:

- every theme is an **area** with contour + riempimento;
- **composition** is one line: "everything above clips everything below";
- **ocean** is a keyword beside OSM tags, not a different kind of source;
- **buildings** is a layer id instead of something you **build** from tags and
  booleans.

You want something closer to the Python pipeline: a short list of **sources**
and **operations** (union, difference, clip lines, buffer, fill into region),
with **names** you reuse — and then, separately, **what gets drawn**, **how**, and
**who cuts whom**. Roads stay a **module** (too much internal logic); almost
everything else should be composable in the profile.

---

## Three parts of a profile

```text
card          paper frame, centre, projection
defs          named geometry (areas, line sets, fills-as-geometry)
draw          which names become SVG ink, and how (stroke / fill)
compose       draw order, occlusion masks, selective clipping
```

Nothing in `defs` is drawn by itself. Nothing in `draw` computes OSM unless it
points at a `defs` name. A drawable can be **only hatching** with **no mask**,
so it never punches holes in the layers below — e.g. dashed schools on top of
everything.

---

## `defs:` — the geometry graph

Each key is a **variable**: an area (multi-polygon in card mm), a **lines**
set (polylines), or a **fill** result (lines from penfill). Values are one
**operation** (a single-key mapping). The planner builds a DAG; each name is
computed once; unused names are skipped.

### Sources

| Operation | Result | Notes |
|---|---|---|
| `osm: { select: … }` | feature set | Same tag rules as today (`except`, skip underground unless asked). |
| `osm.polygons: <name>` | area | Union of polygon parts of those features. |
| `osm.lines: <name>` | lines | All linestrings from those features. |
| `osm.segments: <name>` | lines | Every edge of every polygon **plus** line features (building walls). |
| `card` | area | The full card rectangle. |
| `ocean: {}` | area | **Not OSM.** Host fetches sea polygons from coastline tiles when the
card cuts the coast (today: watermask). Empty inland. Like calling a function. |

`ocean` and `osm` are different **sources**. Inland water is `osm.select`;
the sea is `ocean`. You combine them only if you want one shape:

```yaml
defs:
  inland:   { osm: { select: { water: true, natural: water } } }
  inland_a: { polygons: inland }
  sea_a:    { ocean: {} }
  all_wet:  { union: [inland_a, sea_a] }
```

### Area ops

| Operation | Meaning |
|---|---|
| `union: [a, b, …]` | Boolean union. |
| `difference: { base, cut }` | `base` minus `cut` (cut may be a list → union of cuts). |
| `intersect: { base, keep }` | Clip `base` to `keep`. |
| `fill_holes: <area>` | Drop interior rings (ponds inside parks). |
| `grow: { of: <area>, by: ±len }` | Buffer out / inset (negative = shrink). |

### Line ops

| Operation | Meaning |
|---|---|
| `rings: <area>` | Boundary rings of polygons (exterior + holes unless `exterior_only`). |
| `rings: { of: <area>, exterior_only: true }` | Outer rings only (park outline today). |
| `dedupe: <lines>` | Merge duplicate segments (shared walls input). |
| `clip: { lines, within: <area> }` | Keep parts inside the area. |
| `clip: { lines, within: <area>, invert: true }` | Keep parts outside. |
| `merge: <lines>` | Merge contiguous lines where endpoints meet. |

### Fill ops (geometry only — pattern runs penfill)

| Operation | Meaning |
|---|---|
| `fill: { in: <area>, pattern: …, per: feature }` | One penfill run per footprint polygon. |
| `fill: { in: <area>, pattern: … }` | One run on the union. |

Fill options are the same as today (`spacing`, `angle`, `mark`, `source: file`, …).

### Modules (roads only)

A module is a **function** that returns a fixed set of named defs the profile
may use or ignore:

```yaml
defs:
  roads:
    module: roads/v1
    # implicitly defines e.g. roads.area, roads.outlines, roads.centerlines,
    # roads.bridge_seams — exact names part of the module contract
```

The profile does **not** reimplement width tables, bridge stacking, or joint disks.
It **does** choose which outputs to `draw` and how.

Optional helpers (not modules) could exist later for repetitive recipes, e.g.
`recipe: building_footprints` → `{ footprints, outline, shared_walls }` from
one `osm.select`, but the long form below must always be expressible.

---

## Example — buildings the way Rust/Python do it today

From `building=*` footprints:

1. **Union** → `footprints` (area). This is what occludes roads when used as a mask.
2. **Rings** of the union (+ open building line work) → `building_outline` (lines).
3. **All segments** of footprints, **deduped**, **clipped** to an **inset** of the
   union by 0.1 mm → `shared_walls` (lines). That is the “inner detail”: not
   “internal rings of the polygon”, but **shared edges** that fall inside the
   dissolved block after a slight shrink.

Declarative form:

```yaml
defs:
  bldg: { osm: { select: { building: true } } }

  footprints: { polygons: bldg }
  dissolved:  { union: [footprints] }          # one area for outline + mask

  building_outline:
    union_lines:
      - { rings: dissolved }
      - { osm.lines: bldg }                   # rare open building linework

  inner_band: { grow: { of: dissolved, by: -0.1mm } }

  shared_walls:
    clip:
      lines: { dedupe: { segments: bldg } }
      within: inner_band

  building_hatch:
    fill:
      in: footprints
      per: feature
      pattern: zigzag
      spacing: 0.5mm
      angle: 45
```

None of this **must** be drawn, and **`dissolved` need not occlude anything**.
Another card might only expose `building_hatch` with a dashed stroke and
`compose` that never registers a building mask.

---

## Example — schools vs rest (same mechanism, no “buildings layer”)

```yaml
defs:
  schools:   { osm: { select: { amenity: school, building: school } } }
  schools_a: { polygons: schools }

  all_built: { osm: { select: { building: true } } }
  other_a:   { difference: { base: { polygons: all_built }, cut: schools_a } }

  school_hatch:
    fill: { in: schools_a, pattern: zigzag, spacing: 0.4mm, angle: 45 }

  other_hatch:
    fill: { in: other_a, per: feature, pattern: zigzag, spacing: 0.5mm, angle: 45 }
```

`draw` and `compose` decide whether schools sit on top without cutting terrain,
whether footprints punch roads, etc.

---

## `draw:` — ink, not geometry

Each entry takes geometry from `defs` and assigns **style** and an **svg id**
(group name in the SVG).

```yaml
draw:
  - id: parks_dots
    from: park_hatch          # a fill: def → already lines
    # fill style optional if baked into def; override allowed

  - id: parks_edge
    from: parks_exterior
    stroke: { style: dash, dash: 0.45mm, gap: 0.40mm }

  - id: building_shell
    from: building_outline
    stroke: solid

  - id: building_walls
    from: shared_walls
    stroke: solid

  - id: building_zigzag
    from: building_hatch
    # penfill output; no extra stroke

  - id: schools_sketch
    from: school_hatch
    stroke: { style: dash, dash: 0.3mm, gap: 0.25mm }   # if you hatch via stroke tool instead
```

**No** entry is required to have an outline, a fill, or a mask. If it is not
listed in `draw`, it never hits the SVG.

---

## `compose:` — order, masks, selective clip

Composition is **not** “the stack implies four themes”. It answers:

1. **In what order** are `draw` groups stacked in the SVG (plot order)?
2. **Which defs are occlusion masks** (areas that can hide ink)?
3. **For each drawable, which masks clip it?**

```yaml
compose:
  order:                    # bottom → top in SVG (same as today’s Python list)
    - parks_edge
    - parks_dots
    - water_fill
    - water_edge
    - roads_outline
    - roads_details
    - building_walls
    - building_zigzag
    - building_shell
    - schools_sketch

  masks:                    # names in defs → who they occlude when active
    dissolved:
      from: dissolved
      occludes: [parks_dots, parks_edge, water_fill, water_edge, roads_outline, roads_details]

    roads.area:
      from: roads.area       # from module
      occludes: [parks_dots, parks_edge, water_fill, water_edge]

    # schools_sketch: no mask entry → draws on top, cuts nothing

  clip:                     # optional per draw id; default shown
    parks_dots:    auto      # union of masks listed in occludes from items above in order
    parks_edge:    auto
    water_fill:    auto
    building_zigzag: auto
    schools_sketch: none      # never clipped
```

| `clip` value | Behaviour |
|---|---|
| `auto` | Clip against the union of **`masks`** contributed by draw ids **above** this one in `order`, restricted to ids that list this draw id in their `occludes`. |
| `none` | Never clip (decorative overlay). |
| `[mask names…]` | Explicit list of defs to subtract (your “cut only from these two layers”). |

So a mask can affect **some** drawables below and not others — unlike today's
engine, where every mask above hits everyone.

**Default card (today’s behaviour)** in this scheme:

- `order` bottom → top: parks → water → roads → buildings (parts).
- `dissolved` occludes everything below building ink.
- `roads.area` occludes parks and water.
- Most entries use `clip: auto`.

That matches `STACK_ORDER` in the Python reference without naming layers
`buildings` or `parks` in the schema — only **draw ids** and **def names** you
chose.

---

## Water split: inland, sea, and things on the sea

```yaml
defs:
  inland_a:  { polygons: { osm: { select: { water: true, natural: water } } } }
  sea_a:     { ocean: {} }
  lakes_only: { difference: { base: inland_a, cut: sea_a } }   # if you ever need it

  wet:       { union: [inland_a, sea_a] }
  wet_fill:  { fill: { in: wet, pattern: waves, spacing: 0.75mm } }
  wet_edge:  { rings: wet }

  pier_a:    { polygons: { osm: { select: { man_made: pier } } } }
  pier_fill: { fill: { in: pier_a, pattern: lines, spacing: 0.6mm, angle: 90 } }
```

`compose.order` puts `pier_*` above `wet_*` if piers should sit on the water;
`pier_a` can get its own `masks.pier` entry occluding only `terrain`, not roads.

---

## Parks without a module

Claim order (garden before park before wood…) is **just defs**:

```yaml
defs:
  g_a: { polygons: { osm: { select: { leisure: garden } } } }
  p_a: { polygons: { osm: { select: { leisure: park } } } }
  w_a: { polygons: { osm: { select: { natural: wood, landuse: forest } } } }

  p_claim: { difference: { base: p_a, cut: g_a } }
  w_claim: { difference: { base: w_a, cut: [g_a, p_a] } }

  parks_u: { union: [g_a, p_a, w_a] }
  parks_ext: { fill_holes: parks_u }

  wild: { difference: { base: parks_ext, cut: [g_a, p_a, w_a] } }

  garden_dots: { fill: { in: g_a, pattern: dots, spacing: 0.25mm, mark: 0.2mm } }
  # … one fill def per kind + wild
  parks_edge: { rings: { of: parks_ext, exterior_only: true } }
```

A **`group:` sugar** (optional) could expand to this graph; the long form is the
reference.

---

## Full sketch — default postcard

Same look as `configs/postcard.yaml`, rewritten. Names are arbitrary; ids are
what `compose` uses.

```yaml
card:
  width: 6in
  height: 4in
  scale: "1:10000"
  bearing: 0
  projection: utm

defs:
  # --- parks ---
  g_f: { osm: { select: { leisure: garden } } }
  p_f: { osm: { select: { leisure: park } } }
  w_f: { osm: { select: { natural: wood, landuse: forest, leisure: nature_reserve } } }
  r_f: { osm: { select: { landuse: [grass, meadow], natural: grassland } } }
  g_a: { polygons: g_f }
  p_a: { difference: { base: { polygons: p_f }, cut: g_a } }
  w_a: { difference: { base: { polygons: w_f }, cut: [g_a, p_a] } }
  r_a: { difference: { base: { polygons: r_f }, cut: [g_a, p_a, w_a] } }
  parks_u: { union: [g_a, p_a, w_a, r_a] }
  parks_ext: { fill_holes: parks_u }
  wild_a: { difference: { base: parks_ext, cut: [g_a, p_a, w_a, r_a] } }
  park_dots_g: { fill: { in: g_a, pattern: dots, spacing: 0.25mm, mark: 0.2mm, angle: 45 } }
  park_dots_p: { fill: { in: p_a, pattern: dots, spacing: 0.45mm, mark: 0.2mm, angle: 45 } }
  park_dots_w: { fill: { in: w_a, pattern: dots, spacing: 0.70mm, mark: 0.2mm, angle: 45 } }
  park_dots_r: { fill: { in: r_a, pattern: dots, spacing: 0.85mm, mark: 0.2mm, angle: 45 } }
  park_dots_x: { fill: { in: wild_a, pattern: dots, spacing: 0.70mm, mark: 0.2mm, angle: 45 } }
  parks_ring: { rings: { of: parks_ext, exterior_only: true } }

  # --- water ---
  inland_a: { polygons: { osm: { select: { water: true, natural: water } } } }
  sea_a: { ocean: {} }
  wet: { union: [inland_a, sea_a] }
  wet_fill: { fill: { in: wet, pattern: waves, spacing: 0.75mm, angle: 0 } }
  wet_ring: { rings: wet }

  # --- roads (module) ---
  roads: { module: roads/v1 }

  # --- buildings ---
  bldg: { osm: { select: { building: true } } }
  footprints: { polygons: bldg }
  dissolved: { union: [footprints] }
  building_outline:
    union_lines:
      - { rings: dissolved }
      - { osm.lines: bldg }
  inner_band: { grow: { of: dissolved, by: -0.1mm } }
  shared_walls:
    clip:
      lines: { dedupe: { segments: bldg } }
      within: inner_band
  building_hatch:
    fill: { in: footprints, per: feature, pattern: zigzag, spacing: 0.5mm, angle: 45 }

draw:
  - { id: parks_ring,  from: parks_ring,  stroke: { style: dash, dash: 0.45mm, gap: 0.40mm } }
  - { id: parks_fill,  from: park_dots_g }   # multiple from: or union in defs — see open Q
  - { id: water_ring,  from: wet_ring,      stroke: solid }
  - { id: water_fill,  from: wet_fill }
  - { id: roads_out,   from: roads.outlines, stroke: solid }
  - { id: roads_det,   from: roads.details }
  - { id: bldg_wall,   from: shared_walls,  stroke: solid }
  - { id: bldg_fill,   from: building_hatch }
  - { id: bldg_ring,   from: building_outline, stroke: solid }

compose:
  order:
    - parks_ring
    - parks_fill
    - water_ring
    - water_fill
    - roads_out
    - roads_det
    - bldg_wall
    - bldg_fill
    - bldg_ring
  masks:
    parks_cover:  { from: parks_ext,  occludes: [water_fill, water_ring, roads_out, roads_det, bldg_wall, bldg_fill, bldg_ring] }
    wet_cover:    { from: wet,        occludes: [parks_fill, parks_ring, roads_out, roads_det, bldg_wall, bldg_fill, bldg_ring] }
    roads_cover:  { from: roads.area, occludes: [parks_fill, parks_ring, water_fill, water_ring] }
    bldg_cover:   { from: dissolved,  occludes: [parks_fill, parks_ring, water_fill, water_ring, roads_out, roads_det] }
  clip:
    default: auto
```

(Park fill is five defs today — `draw` might list five ids or one `union_lines`
of fills; see open questions.)

---

## Relation to today

| Today | This proposal |
|---|---|
| `layers[]` + modules | `defs` graph + optional `roads/v1` |
| `LayerParts` slots | You choose what to put in `draw` |
| `compose.rs` global union | `compose.masks` + `compose.clip` per drawable |
| `ocean` inside water filter | `ocean: {}` source, combined only if you want |
| `steps:` in YAML | Same ops as explicit `defs` |
| Implicit theme order | `compose.order` only |

---

## Validation

- Unknown op, unknown def reference, cycle in `defs`.
- `draw.from` must point to a def with the right kind (lines vs fill output).
- `compose.order` ids must exist in `draw`.
- `masks.*.from` must be area defs; `occludes` must name draw ids.
- `module` outputs referenced but module missing.
- Host capability: `ocean: {}` used but card has no coastline (empty area, OK).

Debug (later): `postcards-rs def show dissolved -o dissolved.svg`.

---

## Open questions

1. **Syntax sugar:** keep `defs` as named ops only, or allow a linear `as:`
   form (`- union: … as: dissolved`) for people who think in steps?
2. **Multiple `from` in one draw** (e.g. five park fills → one SVG group)?
3. **`union_lines` / list ops** — exact spellings vs a minimal core.
4. **`clip: auto` rules** — is “masks above in `order` that list me in
   `occludes`” the right default?
5. **Second file** — split `catalog.yaml` (defs only) vs `style.yaml` (draw +
   compose) for reuse across cards?
6. **Language** — stay YAML, or a tiny expression language for defs when maps
   get deep?

---

## Older files

- `configs/proposal/postcard.yaml` — v1 shape; **obsolete** relative to this doc.
- When v2 is accepted, replace it with a profile that matches the sketch above.
