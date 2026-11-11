title("Napkin sketch (lite)")
output({ width: "6in", height: "4in", scale: "1:40000", lat: 45.4344693, lng: 12.3377579, tileZoom: 14, padding: "0.1in" })
// Napkin sketch: Venice drawn quickly by hand. Penfill draws everything
// precisely — scribbled blocks, rows of curling waves, doodled trees — and
// `compose.hand` loosens it at the end: tremble, bowed runs, overshot corners.
// The full preset is Napkin sketch in the gallery.

// ── 1. Parameters & palette ─────────────────────────────────────────────
const PEN = 0.2
const pen = (k) => PEN * k
/** @type {Stroke} */
const INK = { style: "solid", width: pen(1), cap: "round" }

// The sea: rows of scallops, one stroke a row, fraying out toward the shore.
/** @type {Omit<FillOptions, "in">} */
const SEA = { pattern: "scallop-waves", spacing: pen(14), wavelength: 1.35, depth: 0.35, stagger: 0.5, fray: pen(10) }
/** @type {Omit<FillOptions, "in">} */
const SCRIBBLE = { per: "feature", pattern: "scribble", inset: pen(3), spacing: pen(8), angle: 40 }
/** @type {Omit<FillOptions, "in">} */
const TREES = { pattern: "doodle-trees", spacing: pen(20), coverage: 0.8, edge: "inside", seed: 9 }

// One seed for every hand, so strokes that meet in different layers tremble together.
/** @type {HandOptions} */
const HAND = { preset: "sketch", wobble: pen(2.5), bow: 0.025, overshoot: pen(3.5), corners: pen(5), retrace: 0.35, seed: 5 }
/** @type {HandOptions} */
const HAND_FILLS = { preset: "steady", wobble: pen(2.5), overshoot: pen(3), seed: 5 }
/** @type {HandOptions} */
const HAND_WAVES = { preset: "steady", wobble: pen(5), wavelength: pen(45), bow: 0.045, close: 0, seed: 5 }

// ── 2. Data & geometry ──────────────────────────────────────────────────
const frame = engine.frame()
const major = areas.buffer(lines.of(features.tiles("transportation:motorway,trunk,primary,secondary")), pen(3.5))
const streets = lines.of(features.tiles("transportation:tertiary,minor"))

// Blocks: grow then shrink the buildings by the same amount, and row houses
// fuse into one mass per block (a morphological close); holes filled.
const MERGE = pen(5)
const blocks = areas.difference(areas.fillHoles(areas.grow(areas.grow(areas.polygons(features.tiles("buildings")), MERGE), -MERGE)), major)

const ocean = areas.extendToFrame(areas.grow(areas.intersect(areas.polygons(features.tiles("ocean")), frame), pen(1.75)), frame)
const water = areas.union(areas.polygons(features.tiles("water")), ocean)
const land = areas.difference(frame, water)
// Parks and woods are only trees, no outline.
const greens = areas.difference(areas.polygons(features.tiles("parks", "grass", "forest")), water, blocks, major)

// ── 3. Draws ────────────────────────────────────────────────────────────
// The sea is filled past the sheet (compose clips it back), so its fray
// stays on the shore and off the paper's edge.
draw({ id: "sea", from: fills.fill({ in: areas.difference(areas.grow(frame, pen(25)), land), ...SEA }), stroke: INK })
draw({ id: "shore", from: lines.clip(lines.rings(water), areas.grow(frame, -0.3)), stroke: INK })
// Main roads as two strokes: the outline of a strip round the centre line.
draw({ id: "major", from: lines.rings(major), stroke: INK })
draw({ id: "streets", from: streets, stroke: INK })
draw({ id: "blocks", from: lines.rings(blocks), stroke: INK })
draw({ id: "hatch", from: fills.fill({ in: blocks, ...SCRIBBLE }), stroke: INK })
draw({ id: "trees", from: fills.fill({ in: greens, ...TREES }), stroke: INK })

// ── 4. Compose: clear the main roads, then loosen every stroke by hand ──
compose.mask({ name: "under_major", from: major, occludes: ["streets", "trees"] })
const outlines = ["shore", "major", "streets", "blocks"]
compose.linemerge(outlines, pen(2))      // one long stroke, not many short ones, before the hand
compose.filter(outlines, { minLength: pen(8) })
compose.hand(outlines, HAND)
compose.hand(["hatch", "trees"], HAND_FILLS)
compose.hand("sea", HAND_WAVES)
compose.linesort()
