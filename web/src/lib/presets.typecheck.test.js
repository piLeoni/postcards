// `npm test`: every preset (and every profile in `configs/`) type-checks
// against drawland.d.ts the way the editor checks it, so an example never
// opens with red squiggles.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const root = join(import.meta.dirname, '..', '..', '..')
const library = join(root, 'crates', 'drawland-script', 'drawland.d.ts')
const dirs = [join(root, 'web', 'src', 'presets'), join(root, 'configs')]
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => join(d, f)))

// The editor's settings (`setUpEditor` in Sidebar.jsx).
const options = { allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2020, lib: ['lib.es2020.d.ts'], skipLibCheck: true }

for (const file of files) {
  test(`${file.slice(root.length + 1)} type-checks`, () => {
    // One script at a time: profiles are scripts, their top-level names would clash.
    const program = ts.createProgram([library, file], options)
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === file || !d.file)
    const text = errors.map((d) => {
      const at = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0) : null
      return `${at ? `${at.line + 1}:${at.character + 1} ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
    })
    assert.deepEqual(text, [], readFileSync(file, 'utf8').length ? text.join('\n') : '')
  })
}
