/**
 * The draw.land WASM engine: profile in, SVG out. Built by web/build-wasm.sh
 * into public/pkg. Loaded by URL so Vite does not try to bundle it.
 */

let ready = null

export async function loadDrawland() {
  if (!ready) {
    ready = Function('return import("/pkg/drawland_wasm.js")')().then(async (m) => {
      // `m` is a frozen module namespace, so the memory handle is hung off a
      // small wrapper instead of added to it. It is the module's own
      // `WebAssembly.Memory` export, which the worker reads to size the fill
      // budget. `m.default()` returns the wasm exports object.
      const wasm = await m.default()
      return { ...m, memory: wasm.memory }
    })
  }
  return ready
}
