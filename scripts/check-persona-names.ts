import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { DEFAULT_PERSONAS } from '../packages/core/src/personas/defaults.ts'

/**
 * No code names a persona (docs/SPEC.md, section 11).
 *
 * A persona is data, and the user chooses what it is called. The default names are written once, in the
 * file imported above. This check is built from that file, so it follows the defaults if they change, and
 * fails when a default name appears anywhere else in the code: in an identifier, in a text or in a file
 * name. Documentation may name them; code may not, and that includes the comments of this file.
 *
 *   node scripts/check-persona-names.ts
 */

/** Where the default names are written, and so the one file the check leaves alone. */
const DEFAULTS_FILE = 'packages/core/src/personas/defaults.ts'
const CODE = /\.(ts|tsx|js|mjs|cjs|css|html|json|jsonc|yml|yaml)$/
const SKIPPED = /(^|\/)pnpm-lock\.yaml$/

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * A name as a word of its own inside a larger name or sentence. For a persona called Ada, that is `ada`,
 * `adaVoice`, `isAda`, `ADA_VOICE` and "ask Ada", and never "adapt", "Adam" or "ADAGIO".
 */
function asWord(name: string): string {
  const lower = literal(name.toLowerCase())
  const upper = literal(name.toUpperCase())
  const capital = literal(name.charAt(0).toUpperCase() + name.slice(1).toLowerCase())
  const starts = `(?<![A-Za-z])(?:${lower}|${capital})(?![a-z])`
  const inside = `(?<=[a-z])${capital}(?![a-z])`
  const shouted = `(?<![A-Za-z])${upper}(?![A-Za-z])`
  return `${starts}|${inside}|${shouted}`
}

const names = new RegExp(DEFAULT_PERSONAS.map((persona) => asWord(persona.name)).join('|'))
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => CODE.test(file) && !SKIPPED.test(file) && file !== DEFAULTS_FILE)

const found: string[] = []
for (const file of files) {
  if (names.test(file)) found.push(`${file}: the file's name`)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // Listed by git but removed from the working copy.
  }
  text.split('\n').forEach((line, index) => {
    if (names.test(line)) found.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`)
  })
}

if (found.length > 0) {
  process.stderr.write(
    `No code names a persona. A default name is written only in ${DEFAULTS_FILE}: depend on the stance or the accent, and use a made-up name in a test.\n\n${found.join('\n')}\n`
  )
  process.exit(1)
}
process.stdout.write(`No persona is named in the code (${files.length} files checked).\n`)
