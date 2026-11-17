import { DEFAULT_PERSONAS } from '../../packages/core/src/personas/defaults.ts'

/**
 * No code names a persona (docs/SPEC.md, section 11).
 *
 * A persona is data, and the user chooses what it is called. The default names are written once, in the
 * file imported above. This rule is built from that file, so it follows the defaults if they change, and
 * refuses any identifier, text or string that contains one of them anywhere else: `halVoice`, 'Jarvis', <p>HAL</p>.
 */

/** Where the default names are written, and so the one file the rule leaves alone. */
export const PERSONA_DEFAULTS_FILE = 'packages/core/src/personas/defaults.ts'

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * A name as a word of its own inside a larger name or sentence: `hal`, `halVoice`, `isHal`, `HAL_VOICE`, "ask HAL",
 * and never "shall", "Half" or "HALT".
 */
function asWord(name) {
  const lower = escape(name.toLowerCase())
  const upper = escape(name.toUpperCase())
  const capital = escape(name[0].toUpperCase() + name.slice(1).toLowerCase())
  const starts = `(?<![A-Za-z])(?:${lower}|${capital})(?![a-z])`
  const inside = `(?<=[a-z])${capital}(?![a-z])`
  const shouted = `(?<![A-Za-z])${upper}(?![A-Za-z])`
  return `${starts}|${inside}|${shouted}`
}

const names = DEFAULT_PERSONAS.map((persona) => persona.name)
const pattern = names.map(asWord).join('|')
const message = (what) =>
  `No code names a persona: ${what} contains a default name, which is written only in ${PERSONA_DEFAULTS_FILE}. Depend on the stance or the accent, and use a made-up name in a test.`

/** Selectors for `no-restricted-syntax`: every place a name can be written in a source file. */
export const personaNameSelectors = [
  { selector: `Identifier[name=/${pattern}/]`, message: message('this identifier') },
  { selector: `Literal[value=/${pattern}/]`, message: message('this text') },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message: message('this text') },
  { selector: `JSXText[value=/${pattern}/]`, message: message('this text') }
]
