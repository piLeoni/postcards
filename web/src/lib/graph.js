/**
 * From the profile script to the graph the engine draws.
 *
 * The script interpreter is a WASM module of its own (public/pkg-script),
 * fetched the first time a script has to run. Most of the time none has to:
 * the graph does not depend on the output (a script cannot read it), so a
 * graph is cached under the script's shape (the script with its literal
 * title and output blanked), and the presets ship theirs pre-run. Dragging,
 * rescaling, renaming or loading a preset touch only the literals, so they
 * reuse the graph and swap the output in.
 */
import { outputOf, shapeOf } from './doc'
import { PRESETS } from './presets'

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

const LIMIT = 24
const cache = new Map(PRESETS.map((p) => [shapeOf(p.doc), p.graph]))

function remember(key, graph) {
  cache.delete(key)
  cache.set(key, graph)
  while (cache.size > LIMIT + PRESETS.length) cache.delete(cache.keys().next().value)
}

/**
 * The graph for `text`, as the engine's JSON, with the page's output when the
 * script writes it literally. Resolves to `{ json, computed, ran }`: `computed`
 * when the output is the script's own, `ran` when the interpreter ran. Rejects
 * with the script's error, `line N column M: …` when it says where.
 */
export async function compile(text) {
  const output = outputOf(text)
  const key = shapeOf(text)
  let graph = output && output.kind !== 'computed' ? cache.get(key) : undefined
  let ran = false
  if (!graph) {
    const js = await loadInterpreter()
    graph = JSON.parse(js.evaluate(text))
    ran = true
    remember(key, graph)
  }
  const out = { ...graph }
  if (output?.kind === 'literal') out.output = output.value
  return { json: JSON.stringify(out), computed: output?.kind === 'computed', ran }
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
