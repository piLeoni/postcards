// A postcard of Iceland with no names on it: four views in City Grain, each a
// corner of the card at its own place and scale — the city (Reykjavík round
// Hallgrímskirkja), a fjord (Seyðisfjörður), a crater (Hverfjall, in the lava
// north of Mývatn) and the ice (Jökulsárlón, where the glacier calves into
// its lagoon) — and across the middle, over all four, only where the island
// is: 65°N 18°W, in a monospaced bold, inked solid, the map cleared round it.
// Each corner is labelled the same way, by its own coordinates.
//
//   drawland map configs/sixty-five-north.js -o exports/iceland.svg

title("65°N 18°W")
// The page's own place only says where the card sits on the map (over
// Iceland, its four corners inside it): the page draws no map of its own,
// each view has its own place and scale.
output({
  width: "6in",
  height: "4in",
  scale: "1:4000000",
  projection: "webmercator",
  lat: 64.9,
  lng: -18.6,
  tileZoom: 6,
  padding: 0,
})

// ── 1. PARAMETERS & STYLE PALETTE ───────────────────────────────────────

const PAGE = { w: 152.4, h: 101.6 }
const MARGIN = 5
const GUTTER = 1.2
const STYLE = "city-grain"

// The four corners: top-left, top-right, bottom-left, bottom-right.
// City, fjord, crater, ice. Each its own pen, riso-print colours: the view,
// its frame and its tab.
const SPOTS = [
  { id: "reykjavik", lat: 64.1440, lng: -21.9340, scale: "1:9000", ink: "#765ba7" },
  { id: "seydisfjordur", lat: 65.2800, lng: -13.9300, scale: "1:110000", ink: "#0078bf" },
  { id: "hverfjall", lat: 65.6050, lng: -16.8730, scale: "1:32000", ink: "#ff6c2f" },
  { id: "jokulsarlon", lat: 64.0600, lng: -16.2300, scale: "1:70000", ink: "#00838a" },
]

// The name of the card is where it is: the island's middle, in whole degrees.
const NAME = "65°N 18°W"
/** @param {number} weight @returns {GoogleFont} */
const mono = (weight) => ({ origin: "google", family: "Space Mono", weight })
// Sizes are the capitals' height; `ADVANCE` is the face's step from one
// letter to the next, in those heights, so a line's length is known before
// it is set: the title spans the card less a margin, a tab fits its text.
const ADVANCE = 1.15
const TITLE = { font: mono(700), size: 13.5 }
const TAB = { font: mono(700), size: 1.8, pad: 1.4 }

// One width for every pen. Heavier lines are doubled, not widened; letters
// are filled with diagonal lines, never a thicker stroke. The coordinates
// across the middle are their own pen, black: an outline and a tight hatch.
/** @param {string} color @returns {Stroke} */
const pen = (color) => ({ color, width: 0.2, cap: "round" })
const BLACK = "#1d1d1b"
/** Letters inked solid: diagonal lines just under the nib apart, counters left open. */
/** @type {FillStyle} */
const SOLID_HATCH = { pattern: "lines", spacing: "0.24mm", angle: 45 }
// Paper kept clear round every letter of the title.
const TITLE_CLEAR = "1.4mm"

/** `64.144°N 21.934°W`: a place as the tabs write it. @param {number} lat @param {number} lng */
const coords = (lat, lng) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? "E" : "W"}`

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

// Each corner's coordinates in a tab cut into the card's outer corner of that
// view: a box the view stops at, the text in bold, its letters filled solid.
const tabs = cells.map((c) => {
  const text = coords(c.lat, c.lng)
  const w = text.length * TAB.size * ADVANCE + 2 * TAB.pad
  const h = TAB.size + 2 * TAB.pad
  const cx = c.right ? c.x + cellW - w / 2 : c.x + w / 2
  const cy = c.bottom ? c.y + cellH - h / 2 : c.y + h / 2
  const box = areas.shape({ at: [cx, cy], rect: [w, h] })
  /** @type {TextSpec} */
  const spec = { at: [cx, cy], text, size: `${TAB.size}mm`, font: TAB.font, counters: "open" }
  return { ...c, box, edge: lines.text(spec), letters: areas.text(spec) }
})

/** @type {TextSpec} */
const titleSpec = { at: ["50%", "50%"], text: NAME, size: `${TITLE.size}mm`, font: TITLE.font }
// The map stops a little short of every letter, following its shape.
const titleRoom = areas.grow(areas.text(titleSpec), TITLE_CLEAR)

const frameIds = cells.map((c, i) => draw({ id: `frame_${c.id}`, from: lines.rings(frames[i]), stroke: pen(c.ink) }))
const tabIds = tabs.flatMap((t) => [
  draw({ id: `tab_${t.id}`, from: lines.rings(t.box), stroke: pen(t.ink) }),
  draw({ id: `tab_name_${t.id}`, from: t.edge, stroke: pen(t.ink) }),
  draw({ id: `tab_fill_${t.id}`, from: fills.fill({ in: t.letters, ...SOLID_HATCH }), stroke: pen(t.ink) }),
])
// The coordinates: the letters' outline, and inked solid inside.
draw({ id: "title", from: lines.text(titleSpec), stroke: pen(BLACK) })
draw({ id: "title_fill", from: fills.fill({ in: areas.text({ ...titleSpec, counters: "open" }), ...SOLID_HATCH }), stroke: pen(BLACK) })

// ── 4. OCCLUSION MASKS ──────────────────────────────────────────────────

// The title clears every view, the frames and the tabs under it; each tab
// clears its own view.
compose.mask({ name: "title_room", from: titleRoom, occludes: [...cells.map((c) => c.id), ...frameIds, ...tabIds] })
tabs.forEach((t) => compose.mask({ name: `tab_room_${t.id}`, from: t.box, occludes: [t.id] }))
