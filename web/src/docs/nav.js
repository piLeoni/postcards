/**
 * The documentation's index: the left column, in order. Each entry names the
 * section `Section` renders and the title it shows here; `sub` are the
 * sections nested under it.
 */
export const NAV = [
  { id: 'start', title: 'draw.land', sub: [] },
  { id: 'building', title: 'Building a map', sub: ['profiles', 'engine', 'kinds', 'walkthrough'] },
  { id: 'features', title: 'features', sub: ['features-tiles', 'features-osm', 'features-where'] },
  { id: 'geometry', title: 'Areas and lines', sub: ['areas', 'lines', 'fills', 'modules', 'terrain'] },
  { id: 'ink', title: 'Ink and stacking', sub: ['ink', 'draw', 'compose'] },
  { id: 'reference', title: 'Reference', sub: ['output', 'lengths', 'errors', 'graph'] },
  { id: 'languages', title: 'Languages', sub: ['language-rust', 'language-cli', 'language-python'] },
  { id: 'library', title: 'Libraries', sub: ['libraries', 'projects'] },
]

/** Every section id, in order, for the scroll spy. */
export const SECTION_IDS = NAV.flatMap((g) => g.sub)

/** The group each section belongs to. */
export const GROUP_OF = Object.fromEntries(NAV.flatMap((g) => g.sub.map((id) => [id, g.id])))
