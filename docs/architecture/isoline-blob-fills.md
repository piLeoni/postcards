# Isoline blob fills (design)

**Status:** MVP in penfill (`fill_isoline_blobs_with_coverage`); draw.land generator `isoline-blobs` (strokes only). Coverage → `$areas` + compose not wired yet.  
**Target look:** reference drawings (nested contour “cells” on paper; sparse scattered masses or dense all-over texture).  
**Split:** penfill generates **strokes + coverage polygons**; draw.land clips to the host area and applies **compose masks** to other layers.

This is **not** a symbolic tree icon, a regular hatch, or a single vein texture. The product is **many closed isolines per blob**, nested like height lines on a soft hill, with spacing that can read as light and shadow.

## Visual target (reference art)

**Files:** [`img/isoline-blob-fills/`](img/isoline-blob-fills/) — commit reference PNGs/JPEGs here; link them from this section.

### Scattered (primary reference)

![Scattered isoline blobs](img/isoline-blob-fills/reference-scattered.png)

Few separate organic clusters; empty paper between them. Each cluster is a stack of **closed** loops following one irregular silhouette; inner loops shrink toward a ridge or centre.

### Dense (second reference — add when available)

Place as `img/isoline-blob-fills/reference-dense.png` (or `.jpg`) and embed below. Same line language, but clusters tile the region, overlap, and **line spacing** reads as shadow (tighter = darker).

Two variants of the same language:

| Variant | Composition | Line work |
| --- | --- | --- |
| **Scattered** | Few to many separate organic clusters; lots of empty paper between them | Nested closed loops per blob |
| **Dense** | Edge-to-edge; overlapping masses | Same; spacing varies for shading |

Shared traits to reproduce in vector:

- **Isoline stacks:** each blob is a scalar field sliced at several levels; output is **contour lines**, not filled solids (except coverage — see below).
- **Organic silhouette:** amoeboid boundaries with controlled **wobble**, not CAD circles.
- **Density as shading:** contour spacing varies (light direction + local noise).
- **Layered overlap (dense mode):** draw order + optional mask, not SVG transparency.

Compare implementation output to these files, not to built-in gallery patterns.

## Problem

We need a fill that:

1. Lives inside a map polygon (forest, cloud bank, mist, lichen, etc.).
2. Emits **plotter linework** (the isoline stacks).
3. Emits **one or more polygons** describing the **occupied extent** of the blobs (for erasing dots, hatches, or terrain underneath via `compose.mask`).
4. Accepts **particle sites** either generated inside the region or supplied (e.g. real tree positions).

Today penfill returns only strokes; draw.land `$fills` are only `Lines`. Masking expects `$areas`.

## Concepts

| Term | Meaning |
| --- | --- |
| **Host region** | The map polygon (with holes) the fill is drawn in — park, cloud mask, etc. |
| **Blob** | One connected mass of nested isolines; may overlap neighbours in dense mode. |
| **Site** | Point that seeds a blob’s local height field (procedural scatter or user/OSM points). |
| **Strokes** | All isoline polylines (open or closed), clipped to the host. |
| **Coverage** | Union of blob **outer envelopes** (see below), used only for occlusion — not every inner ring. |

**Coverage vs strokes:** Masks should follow the **silhouette** of each blob (the outermost meaningful loop or an explicit envelope polygon), not every interior contour. Otherwise a `compose.mask` would punch hairline slits.

## Generation model (proposed)

### Per-blob scalar field

At site `c`, build a smooth height `h(p)` on the plane, e.g.:

- Radial falloff from `c` (defines blob size).
- Plus low-frequency noise (shape).
- Optional domain warp (wobble).
- Optional **light bias:** tilt the field or bias level spacing so contours crowd on the “dark” side (parameter: light direction + strength).

Extract **multiple isolines** at levels `h = h₁, h₂, …` using marching squares (penfill already has `field::fill_isolines` for arbitrary `h`). Clip each polyline to **host ∩ blob support** (or clip only to host if blobs are allowed to merge visually).

Parameters exposed to profiles (names TBD):

- `spacing` — typical contour interval in mm (may vary with light).
- `levels` or `depth` — how many nested loops per blob.
- `blob_radius` / `size` — spatial extent of one mass.
- `jitter` / `warp` — edge wobble.
- `density` — site count or global tightness of level spacing.
- `seed` — reproducibility.

### Scattered vs dense mode

- **Scattered:** Poisson (or similar) sites with minimum separation; only blobs whose support intersects the host are drawn. Matches sparse reference.
- **Dense:** more sites, smaller min distance, or continuous field over the whole host with many level sets. Overlap handled by **z-order** (later blobs on top) and/or **coverage union** for masks.

### Custom sites

Penfill API receives `Vec<(x, y)>` in output mm (draw.land converts feature centroids). Sites outside the host are skipped. Optional per-site radius override.

Optional later: custom **footprint** artwork per site; isolines still generated in that footprint’s bounds.

## Penfill deliverable

```rust
pub struct FillWithCoverage {
    pub strokes: Strokes,
    pub coverage: Region, // multipolygon + holes
}
```

- **strokes:** all isolines (and any deliberate centre marks if we add them later), each clipped to the host region.
- **coverage:** union of per-blob envelope polygons, clipped to host by default.

Envelope per blob: outer isoline at the lowest level, or an explicit offset of the support where `h` exceeds a threshold — pick one rule and test against reference art.

Streaming: strokes via existing `Sink`; coverage accumulated once at end (small).

Public name TBD (`fill_isoline_blobs`, `fill_nested_contours`, …).

## draw.land deliverable

| Responsibility | Owner |
| --- | --- |
| Host polygon, scale mm, stroke style | Profile + `grammar_run` |
| Resolve `particles.from` features → points | draw.land |
| Run penfill, get strokes + coverage | `fill.rs` fill pass |
| Clip strokes to host | penfill (invariant) |
| Punch holes in other groups | `compose.mask({ from: $areas.*, occludes })` |

### Graph shape (sketch)

Avoid running the generator twice:

- **Option A:** one `tools_fill` def caches `{ lines, coverage }`; companion `tools_fill_coverage` reads cache, or fill pass registers both `$fills.x` and `$areas.x_coverage`.
- **Option B:** explicit second def with shared params (document dedup).

Profile sketch:

```js
// sites from OSM
const trees = features.select({ natural: "tree" })

$fills:
  forest_isolines:
    tools_fill:
      in: $areas.woodland
      pattern: isoline-blobs   // name TBD
      particles: { from: trees, at: centroid }
      spacing: 0.4mm
      // ...

$areas:
  forest_cover: { tools_fill_coverage: { from: $fills.forest_isolines } }

compose.mask({
  name: "forest_over_dots",
  from: $areas.forest_cover,
  occludes: ["ground_dots"],
})

draw({ id: "ground_dots", from: $fills.dots })
draw({ id: "forest", from: $fills.forest_isolines })
```

Z-order: list `forest` after `ground_dots` in `compose.order`; mask removes hidden ink from dots where coverage sits.

## Phases

1. **Penfill prototype** — fixed grid of sites + per-blob isolines; gallery SVG beside reference art.
2. **Coverage union** — stable mask polygon; unit tests `coverage ⊆ host`, strokes ⊆ host.
3. **draw.land wire-up** — pattern id, coverage area def, one preset on a single park polygon.
4. **Particles from features** — centroids in mm.
5. **Dense mode + light** — spacing bias; draw-order for overlap.
6. **Streaming + budget** — WASM memory guard.

## Tests

- Visual regression against reference (checked in gallery or committed small fixture).
- Deterministic seed.
- Mask integration: lines under coverage removed from occluded group only.

## Related docs

- [fills-compose.md](fills-compose.md) — masks and fill pipeline.
- penfill: [isoline-blob-fills.md](../../../penfill/docs/architecture/isoline-blob-fills.md) — implementation notes (`field`, `Region`).

## Decisions (when built)

Record in [decisions.md](decisions.md): fills may publish **coverage** areas for compose; isoline blob pattern is the reference aesthetic above, not a reuse of symbolic nature icons.
