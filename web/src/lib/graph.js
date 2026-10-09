/**
 * From the profile script to the graph the engine draws.
 *
 * The script interpreter is a WASM module (public/pkg-script), loaded on
 * first compile. The graph always comes from running that script — never from
 * a saved graph. `graphs.json` is only for CI (`check_web_presets`) and
 * headless renders (`wasm_render`), not the live app.
 */
import { outputOf } from './doc'

let interpreter = null

/** The interpreter module, loaded once. */
export function loadInterpreter() {
  if (!interpreter) {
    interpreter = Function('return import("/pkg-script/drawland_script_wasm.js")')().then(async (m) => {
      await m.default()
      return m
    })
  }
  return interpreter
}

/** Whether the interpreter has been fetched (for the page to say so). */
export const interpreterRequested = () => interpreter !== null

/**
 * The graph for `text`, as the engine's JSON, with the page's output when the
 * script writes it literally. Resolves to `{ json, computed, ran }`: `computed`
 * when the output is the script's own. Rejects with the script's error,
 * `line N column M: …` when it says where.
 */
export async function compile(text) {
  const output = outputOf(text)
  const js = await loadInterpreter()
  const graph = JSON.parse(js.evaluate(text))
  const out = { ...graph }
  if (output?.kind === 'literal') out.output = output.value
  return { json: JSON.stringify(out), computed: output?.kind === 'computed', ran: true }
}

/**
 * The output's centre and size, from the literal `output({…})` alone (no graph
 * needed): what `outputInfo` says of it, or `null` when the script computes
 * its output or has none.
 */
export function literalOutputInfo(engine, text) {
  const output = outputOf(text)
  if (output?.kind !== 'literal') return null
  return JSON.parse(JSON.stringify(engine.outputInfo(JSON.stringify({ output: output.value }))))
}
