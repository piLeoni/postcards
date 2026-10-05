import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { START_DOC } from './presets'

// Settings saved while the app was called postcards are copied to the
// drawland prefix before any atom reads them. This runs on import, ahead of
// the atoms below; doing it in `main.jsx` would be too late, since its
// imports (this module among them) are evaluated first.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('postcards.')) continue
    const renamed = `drawland.${key.slice('postcards.'.length)}`
    if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key))
    localStorage.removeItem(key)
  }
  // The search used to be saved between visits; it is now a session atom
  // (`searchAtom`), so drop the old key rather than leave a stale query behind.
  localStorage.removeItem('drawland.search')
} catch {
  // No localStorage (private mode): nothing was saved.
}

/**
 * What the page keeps between visits, in one place: the script, where the map
 * was, and how wide the column was. Each is a Jotai atom stored in
 * `localStorage` under a `drawland.` key, so a reload — or a closed tab
 * reopened tomorrow — comes back where it was left. A page with no
 * `localStorage` (private mode) still works; the atoms just start at their
 * defaults.
 *
 * The search is not among them: it lives for one session only (see
 * `searchAtom`), and a reload starts it empty again.
 */

/** Read the stored value on the very first render, not a moment after: the
    script must be the real one before the engine compiles it, or the page
    would compile the default, then the stored one, and could write the
    default back. */
const ON_INIT = { getOnInit: true }

/** The script as it was last left: the preset, or the edits made to it. */
export const docAtom = atomWithStorage('drawland.doc', START_DOC, undefined, ON_INIT)

/** Where the map was looking: the centre and zoom, not the bearing (that is the output's). */
export const mapViewAtom = atomWithStorage('drawland.mapView', null, undefined, ON_INIT)

/** The right column's width, in px. */
export const sidebarWidthAtom = atomWithStorage('drawland.sidebarWidth', 448, undefined, ON_INIT)

/**
 * The search, for one session only: the text typed, the matches it found, and
 * the place picked from them, if any. It is deliberately *not* in
 * `localStorage`: a reload should start from a clean field, not come back to a
 * query and quietly run it again. Within the session it is kept whole, so
 * closing the panel and reopening it shows the same results without another
 * lookup.
 */
export const searchAtom = atom({ query: '', rows: [], state: 'idle', place: null })
