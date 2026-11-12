// A postcard of France in four views, each a corner of the card drawn in City
// Grain at its own place and scale: Paris (the twelve avenues of the Étoile),
// the sea (Mont-Saint-Michel in its bay), the countryside (the gardens of
// Versailles) and the mountains (Mont Blanc). Each corner is named in a tab
// cut into it; across the middle, over all four, the country's name in a
// geometric sans inked solid in red, as the greeting over it, the map cleared round the word.
//
//   drawland map configs/bonjour-de-france.js -o exports/france.svg

title("Bonjour de France")
// The page's own place only says where the card sits on the map (over
// France, its four corners inside it): the page draws no map of its own,
// each view has its own place and scale.
output({
  width: "6in",
  height: "4in",
  scale: "1:8000000",
  projection: "webmercator",
  lat: 47.2,
  lng: 2.6,
  tileZoom: 6,
  padding: 0,
})

// ── 1. PARAMETERS & STYLE PALETTE ───────────────────────────────────────

const PAGE = { w: 152.4, h: 101.6 }
const MARGIN = 5
const GUTTER = 1.2
const STYLE = "city-grain"

// The four corners: top-left, top-right, bottom-left, bottom-right.
// City, sea, countryside, mountains.
// Each its own pen, riso-print colours: the view, its frame and its tab.
const SPOTS = [
  { id: "paris", name: "Paris", lat: 48.87378, lng: 2.29504, scale: "1:8000", ink: "#0078bf" },
  { id: "msm", name: "Mont-Saint-Michel", lat: 48.6358, lng: -1.5114, scale: "1:8000", ink: "#00838a" },
  { id: "versailles", name: "Versailles", lat: 48.8082, lng: 2.1060, scale: "1:24000", ink: "#00a95c" },
  { id: "montblanc", name: "Mont Blanc", lat: 45.8326, lng: 6.8652, scale: "1:60000", ink: "#ff48b0" },
]

const NAME = "France"
// A vintage "greetings from…" over the name.
const GREETING = "Bonjour de"
/** @param {number} weight @returns {GoogleFont} */
const sans = (weight) => ({ origin: "google", family: "Montserrat", weight })
const TITLE = { font: sans(800), size: 17 }
const TAB = { font: sans(700), size: 2.6, pad: 1.6, em: 0.78 }
const GREET = { font: sans(700), size: 3.4, above: 4.2 }

// One width for every pen. Heavier lines are doubled, not widened; letters
// are filled with diagonal lines, never a thicker stroke. The greeting and
// the name share one more pen, red: an outline and a tight hatch inside.
/** @param {string} color @returns {Stroke} */
const pen = (color) => ({ color, width: 0.2, cap: "round" })
const RED = "#ff4f3a"
/** Letters inked solid: diagonal lines just under the nib apart, counters left open. */
/** @type {FillStyle} */
const SOLID_HATCH = { pattern: "lines", spacing: "0.24mm", angle: 45 }
// Paper kept clear round every letter of the title and the greeting.
const TITLE_CLEAR = "1.2mm"

// ── 2. VIEWS ────────────────────────────────────────────────────────────

const cellW = (PAGE.w - 2 * MARGIN - GUTTER) / 2
const cellH = (PAGE.h - 2 * MARGIN - GUTTER) / 2
const cells = SPOTS.map((s, i) => {
  const right = i % 2 === 1
  const bottom = i >= 2
  const x = MARGIN + (right ? cellW + GUTTER : 0)
  const y = MARGIN + (bottom ? cellH + GUTTER : 0)
  const id = view({ id: s.id, at: [x, y], size: [cellW, cellH], lat: s.lat, lng: s.lng, scale: s.scale, ink: s.ink }, STYLE)
  return { ...s, id, x, y, right, bottom }
})

// ── 3. PAGE: FRAMES, TABS, TITLE ────────────────────────────────────────

const frames = cells.map((c) => areas.shape({ at: [c.x + cellW / 2, c.y + cellH / 2], rect: [cellW, cellH] }))

// Each corner's name in a tab cut into the card's outer corner of that view:
// a box the view stops at, the name in bold, its letters filled solid.
const tabs = cells.map((c) => {
  const w = c.name.length * TAB.size * TAB.em + 2 * TAB.pad
  const h = TAB.size + 2 * TAB.pad
  const cx = c.right ? c.x + cellW - w / 2 : c.x + w / 2
  const cy = c.bottom ? c.y + cellH - h / 2 : c.y + h / 2
  const box = areas.shape({ at: [cx, cy], rect: [w, h] })
  /** @type {TextSpec} */
  const spec = { at: [cx, cy], text: c.name, size: `${TAB.size}mm`, font: TAB.font, counters: "open" }
  return { ...c, box, edge: lines.text(spec), letters: areas.text(spec) }
})

/** @type {TextSpec} */
const titleSpec = { at: ["50%", "50%"], text: NAME.toUpperCase(), size: `${TITLE.size}mm`, font: TITLE.font }
// The greeting just above the name, its letters filled solid.
/** @type {TextSpec} */
const greetSpec = {
  at: ["50%", PAGE.h / 2 - TITLE.size / 2 - GREET.above],
  text: GREETING.toUpperCase(),
  size: `${GREET.size}mm`,
  font: GREET.font,
}
// The map stops a little short of every letter, following its shape.
const titleRoom = areas.union(areas.grow(areas.text(titleSpec), TITLE_CLEAR), areas.grow(areas.text(greetSpec), TITLE_CLEAR))

const frameIds = cells.map((c, i) => draw({ id: `frame_${c.id}`, from: lines.rings(frames[i]), stroke: pen(c.ink) }))
const tabIds = tabs.flatMap((t) => [
  draw({ id: `tab_${t.id}`, from: lines.rings(t.box), stroke: pen(t.ink) }),
  draw({ id: `tab_name_${t.id}`, from: t.edge, stroke: pen(t.ink) }),
  draw({ id: `tab_fill_${t.id}`, from: fills.fill({ in: t.letters, ...SOLID_HATCH }), stroke: pen(t.ink) }),
])
// The name and the greeting alike: the letters' outline, and inked solid inside.
for (const [id, spec] of /** @type {[string, TextSpec][]} */ ([["title", titleSpec], ["greeting", greetSpec]])) {
  draw({ id, from: lines.text(spec), stroke: pen(RED) })
  draw({ id: `${id}_fill`, from: fills.fill({ in: areas.text({ ...spec, counters: "open" }), ...SOLID_HATCH }), stroke: pen(RED) })
}

// ── 4. OCCLUSION MASKS ──────────────────────────────────────────────────

// The title clears every view, the frames and the tabs under it; each tab
// clears its own view.
compose.mask({ name: "title_room", from: titleRoom, occludes: [...cells.map((c) => c.id), ...frameIds, ...tabIds] })
tabs.forEach((t) => compose.mask({ name: `tab_room_${t.id}`, from: t.box, occludes: [t.id] }))
