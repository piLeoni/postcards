# Roads

How highway ways become pen strokes. Companion to
`postcards/utils/filters/roads.py`.

## Pipeline

1. Keep OSM features with `highway=*`; drop sidewalk/crossing footways and points.
2. Resolve a **stacking index** per way (`layer`, with `bridge`/`tunnel` signals).
3. Drop underground ways (negative layer, `location=underground`, inferred tunnels).
4. Estimate carriageway **width in metres**, convert to card mm, buffer by
   **half-width** with flat caps, union into one mask.
5. **Bridge overlay**: positive `layer` polygons are cut by higher layers; their
   *internal* seams (not the outer silhouette) become `details`.
6. Outlines = mask boundary.

No road fill — only outlines + bridge seams. Cross-theme occlusion lives in
`composition.py`. Hierarchy else is width (motorway fatter than residential).

## Width priority

1. `width=*` — metres by default; `12 ft`, `16'3"`, `2 m` converted
2. `width:lanes=*` (and `:forward` / `:backward`) — summed across lanes
3. `lanes=*` × 3 m
4. per-`highway` average in `WIDTH_BY_TYPE`

Absurd values are soft-clamped per class (e.g. residential ≤ 15 m).

OSM's default unit is the **metre**, worldwide. No country-based feet guess,
no Nominatim call.

## Vertical index

| Signal | Effect |
|---|---|
| `layer=N` | used as stacking index |
| `bridge=*` and layer missing or `0` | treated as layer 1 |
| `tunnel=yes` (not `building_passage`) | treated as underground → dropped |
| `tunnel=building_passage` | kept (covered ground walk) |
| `level=*` | **ignored** for roads (indoor semantics) |

## Design notes

- **Area model** (buffer → union → outline) matches printed maps better than
  stroking the centerline. Junctions fuse; bridge deck edges add the extra ink
  a pen needs to read overpasses.
- Connected OSM ways that share layer + width are **linemerged** before
  buffering. Joints where width changes (or a link meets a motorway) get a
  disk of the larger radius; a ~2.5 m morphological close clears leftover
  wedges at acute merges without gluing dual carriageways.
- Emitting every elevated way's full boundary (or class-cut edges) as `details`
  turns a stack interchange into a tiled wireframe — too much for one pen.
  Only *internal* bridge seams are drawn.
- Wide carriageways (≥ 6 m) get a fine dashed centre-line in `details`. Where
  a higher `layer` / bridge crosses, that centre-line is cut so the overpass
  reads as sitting on top.
- This is *not* [osm2streets](https://github.com/a-b-street/osm2streets). That
  library rebuilds lane-level networks. We steal `half_width = total/2`, not the
  schema.

## Still open

- Intersection trimming (pull centerlines back, convex junction polygons)
- Dual-carriageway merging
- `man_made=bridge` area outlines as extra detail rings (needs OSM tag fetch)
- Profile knobs for `BUFFER_FUDGE` / `LANE_WIDTH_M` if city tuning becomes real
