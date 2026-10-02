/**
 * The postcards WASM engine: profile in, SVG out. Built by web/build-wasm.sh
 * into public/pkg. Loaded by URL so Vite does not try to bundle it.
 */

let ready = null

export async function loadPostcards() {
  if (!ready) {
    ready = Function('return import("/pkg/postcards_wasm.js")')().then(async (m) => {
      await m.default()
      return m
    })
  }
  return ready
}
