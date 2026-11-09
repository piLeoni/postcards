title("Sketchbook")
output({
  width: "6in",
  height: "4in",
  scale: "1:10000",
  bearing: 0,
  projection: "webmercator",
  lat: 37.8056294,
  lng: -122.4462699,
  tileZoom: 14,
  padding: "0.1in",
})

// A map drawn quickly by hand in a sketchbook. Very little is drawn: streets
// as single loose strokes (main roads doubled), buildings fused into block
// masses and cross-hatched, the sea as rows of curling waves, and parks as
// doodled trees, and the hills shaded in quick downhill strokes. Names are
// lettered in a geometric single-stroke face, loosened like the rest.
// Everything goes through `compose.hand` at the end.

const PEN = 0.2
const pen = (k) => PEN * k
/** @param {Exclude<Stroke, string>} s @returns {Stroke} */
const inked = (s) => /** @type {Stroke} */ ({ ...s, width: pen(1), cap: "round" })
const SOLID = inked({ style: "solid" })

// The sea: rows of scallops, arcs dipping between sharp points, one stroke a
// row — drawn precisely by penfill (`scallop-waves`), then loosened by the hand
// like everything else, and frayed toward the shore.
/** @type {Omit<FillOptions, "in">} */
const SEA = { pattern: "scallop-waves", spacing: pen(14), wavelength: 1.35, depth: 0.35, stagger: 0.5, fray: pen(10) }

// One seed everywhere, so strokes that meet in different layers tremble together.
/** @type {HandOptions} */
const HAND = { preset: "sketch", wobble: pen(2.5), bow: 0.025, overshoot: pen(3.5), corners: pen(5), retrace: 0.35, retraceOffset: pen(1.5), seed: 5 }
/** @type {HandOptions} */
const HAND_HATCH = { preset: "steady", wobble: pen(2.5), overshoot: pen(3), seed: 5 }
/** @type {HandOptions} */
const HAND_WAVES = { preset: "steady", wobble: pen(5), wavelength: pen(45), tremor: pen(0.55), bow: 0.045, overshoot: pen(2.5), close: 0, seed: 5 }
/** @type {HandOptions} */
const HAND_RELIEF = { preset: "steady", wobble: pen(4), wavelength: pen(50), tremor: pen(0.5), bow: 0.05, overshoot: pen(3), reach: pen(60), retrace: 0.25, retraceOffset: pen(1.5), seed: 5 }
/** Lettering: written, not typeset — bowed strokes, a tremble, loose ends, the odd retrace. */
/** @type {HandOptions} */
const HAND_LETTERS = { preset: "sketch", wobble: pen(2.2), tremor: pen(0.6), bow: 0.05, overshoot: pen(1.8), corners: pen(1.5), retrace: 0.25, retraceOffset: pen(0.8), close: 0, seed: 11 }
/** @type {HandOptions} */
const HAND_TREES = { preset: "steady", wobble: pen(2.5), tremor: pen(0.3), overshoot: 0, close: 0, seed: 5 }

// Names: districts big, main roads small, in EMS Tech (geometric, mixed case).
/** @type {LabelFont} */
const LETTERS = "ems-tech"
const NAME_BIG   = pen(16)   // 3.2 mm
const NAME_SMALL = pen(9)    // 1.8 mm
const NAME_CLEAR = pen(11)   // paper kept clear round every name (2.2 mm)

const frame = engine.frame()

// Streets
const MAJOR = "transportation:motorway,trunk,primary,secondary"
const majorLines = lines.of(features.tiles(MAJOR))
const majorArea = areas.buffer(majorLines, pen(3.5))
const streets = lines.of(features.tiles("transportation:tertiary,minor"))

// Blocks: row houses fuse into masses; small leftovers drop out.
const BLOCK_MERGE = pen(5)
const blocks = areas.difference(
  areas.fillHoles(areas.grow(areas.grow(areas.polygons(features.tiles("buildings")), BLOCK_MERGE), -BLOCK_MERGE)),
  majorArea,
)

// Water
const ocean = areas.extendToFrame(
  areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), pen(1.75)),
  frame,
)
const water = areas.union(areas.polygons(features.tiles("water:lake,river,pond,dock")), ocean)
const inFrame = areas.grow(frame, pen(-1.5))

// Parks and woods: only trees, no outlines.
const greens = areas.difference(
  areas.polygons(features.tiles("landcover:park,recreation_ground,village_green", "forest", "landuse:forest")),
  water,
  blocks,
  majorArea,
)

// The hills: burin strokes running downhill, the way water would (angle 90,
// across the contours), in chiaroscuro — packed on the slopes turned from the
// light (top left), long and wide apart on the lit ones — and crossed at 45°
// by a lighter pass in the shade. They ease
// out before the built-up city so the streets stay clean.
const built = areas.union(areas.grow(blocks, pen(6)), majorArea)
const land = areas.difference(frame, water)
const relief = burin.terrain((b) => {
  b.batch({
    angle: 90,
    outside: "built",
    mask_start_m: 0,
    mask_reach_m: 120,
    mask_fade: 0.3,
    mask_fray_m: 60,
    style: {
      // Chiaroscuro by spacing alone: continuous lines everywhere, wide apart
      // on the lit slopes, close together in the shade.
      space_light: 12, space_dark: 4.5, space_steep: 0.5,
      dash_light: 1, dash_dark: 1, dash_cutoff: 0,
      mod_jitter: 0.1, mod_flat: 0,
      sun_azimuth: 315, sun_altitude: 35,
      // No stubs: a stroke is at least this long (px) or not drawn.
      engine_min: 14,
    },
  })
  // The cross: a lighter pass at 45° to the downhill strokes, only in the
  // shade, so the dark slopes are cross-hatched and the lit ones stay single.
  b.batch({
    angle: 45,
    outside: "built",
    mask_start_m: 0,
    mask_reach_m: 120,
    mask_fade: 0.3,
    mask_fray_m: 60,
    style: {
      // Only on the shaded ground (tone above the floor): light stays single.
      batch_floor: 0.5,
      // Spacing carries over from the downhill pass in burin, so the cross is
      // lightened by its dashes instead: broken, about a third of the ink.
      dash_light: 0.2, dash_dark: 0.45, dash_period: 30, dash_cutoff: 0.2,
      mod_jitter: 0.2, mod_flat: 0.5,
      sun_azimuth: 315, sun_altitude: 35,
      engine_min: 22,
    },
  })
}, { in: land, regions: { built }, water })

const names = modules.labels({
  from: [
    features.tiles("place:suburb,neighbourhood,quarter,island"),
    features.tiles("transportation_name:motorway,trunk,primary,secondary"),
  ],
  font: LETTERS,
  size: NAME_SMALL,
  minSize: NAME_SMALL,
  rules: [{ tags: { "tiles:layer": "place" }, size: NAME_BIG, minSize: NAME_BIG }],
})
const namesClear = areas.union(names.area, areas.buffer(names.lines, NAME_CLEAR))

draw({ id: "lines_relief", from: relief, stroke: SOLID })
draw({ id: "lines_shore", from: lines.clip(lines.rings(water), inFrame), stroke: SOLID })
// The sea runs under bridges and piers: roads over water and pier decks are
// cut out of it, and the waves fray toward them as they do toward the shore.
// It is filled past the sheet (compose clips it back), so the fray stays off
// the paper's edge.
// Only what is drawn is cut out: a gap in the waves always has its pier or
// road on paper. Pier decks only — the marina's finger docks (lines) are too
// fussy for a sketch, so the waves simply run through them.
const piers = areas.polygons(features.tiles("transportation:pier"))
const decks = areas.intersect(areas.union(majorArea, areas.buffer(streets, pen(2.5)), piers), water)
const seaArea = areas.difference(areas.grow(frame, pen(25)), land, areas.grow(decks, pen(2)))
draw({ id: "fill_sea", from: fills.fill({ in: seaArea, ...SEA }), stroke: SOLID })
draw({ id: "lines_major",   from: lines.rings(majorArea), stroke: SOLID })
draw({ id: "lines_streets", from: streets, stroke: SOLID })
draw({ id: "lines_blocks",  from: lines.rings(blocks), stroke: SOLID })
draw({ id: "lines_piers",   from: lines.rings(piers), stroke: SOLID })
draw({ id: "fill_blocks",   from: fills.fill({ in: blocks, per: "feature", pattern: "scribble", inset: pen(3), spacing: pen(8), angle: 40 }), stroke: SOLID })
draw({ id: "fill_trees",    from: fills.fill({ in: greens, pattern: "doodle-trees", spacing: pen(20), coverage: 0.8, edge: "inside", seed: 9 }), stroke: SOLID })

draw({ id: "lines_names", from: names.lines, stroke: SOLID })

compose.mask({ name: "mask_major", from: majorArea, occludes: ["lines_streets", "fill_trees", "lines_relief"] })
compose.mask({ name: "mask_built", from: areas.union(blocks, greens), occludes: ["lines_relief"] })
compose.mask({
  name: "mask_names",
  from: namesClear,
  occludes: ["lines_relief", "lines_shore", "fill_sea", "lines_major", "lines_streets", "lines_blocks", "lines_piers", "fill_blocks", "fill_trees"],
})

const outlines = ["lines_shore", "lines_major", "lines_streets", "lines_blocks", "lines_piers"]
compose.linemerge(outlines, pen(2))
compose.filter(outlines, { minLength: pen(8) })
compose.simplify(outlines, pen(0.3))
compose.hand(outlines, HAND)
compose.hand("fill_sea", HAND_WAVES)
compose.hand("fill_blocks", HAND_HATCH)
compose.hand("fill_trees", HAND_TREES)
compose.hand("lines_names", HAND_LETTERS)
compose.filter("lines_relief", { minLength: pen(5) })
compose.simplify("lines_relief", pen(0.15))
compose.hand("lines_relief", HAND_RELIEF)
compose.linesort({ except: ["lines_names"] })
