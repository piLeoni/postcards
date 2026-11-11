/**
 * The documentation's index: the left column, in order. Each group is a
 * section of the page (its id is the section's heading); `sub` are the
 * headings nested under it, titled from `TITLES`. The sections that are
 * generated (tutorial steps, lite styles, patterns, reference) bring their
 * own ids and titles, so the index follows them.
 */
import { TUTORIAL_STEPS } from './Tutorial.jsx'
import { LITE_IDS, LITE_TITLES } from './Lite.jsx'
import { CONCEPTS_IDS, CONCEPTS_TITLES } from './Concepts.jsx'
import { PATTERNS_NAV, PATTERNS_TITLES } from './Patterns.jsx'
import { REFERENCE_NAV, REFERENCE_TITLES } from './Reference.jsx'
import { DEV_IDS, DEV_TITLES } from './Developers.jsx'

export const NAV = [
  { id: 'gallery', title: 'Gallery', sub: [] },
  { id: 'tutorial', title: 'Tutorial', sub: [...TUTORIAL_STEPS.map((s) => s.id), 'tutorial-next'] },
  { id: 'lite', title: 'Styles, simplified', sub: LITE_IDS },
  { id: 'concepts', title: 'Concepts', sub: CONCEPTS_IDS },
  { id: 'patterns', title: 'Patterns', sub: PATTERNS_NAV.sub },
  { id: 'reference', title: 'Reference', sub: REFERENCE_NAV.sub },
  { id: 'developers', title: 'For developers', sub: DEV_IDS },
]

/** The titles the index shows for nested headings. */
export const TITLES = {
  ...Object.fromEntries(TUTORIAL_STEPS.map((s) => [s.id, s.title])),
  'tutorial-next': 'Where next',
  ...LITE_TITLES,
  ...CONCEPTS_TITLES,
  ...PATTERNS_TITLES,
  ...REFERENCE_TITLES,
  ...DEV_TITLES,
}

/** Every heading the scroll spy follows, in order: each group's own, then its nested ones. */
export const SECTION_IDS = NAV.flatMap((g) => [g.id, ...g.sub])

/** The group each heading belongs to. */
export const GROUP_OF = Object.fromEntries(NAV.flatMap((g) => [[g.id, g.id], ...g.sub.map((id) => [id, g.id])]))
