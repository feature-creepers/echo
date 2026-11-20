/**
 * A key or a combination as the assistant names it ("Enter", "Control+S", "Ctrl + Shift + ArrowDown"), read once
 * here for every system: each system's helper then presses it in its own words.
 */

export type Modifier = 'control' | 'shift' | 'alt' | 'meta'

/** Keys with a name, as every system's helper knows them. A key of one character is that character. */
const NAMED_KEYS = [
  'enter',
  'escape',
  'tab',
  'backspace',
  'delete',
  'space',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'home',
  'end',
  'pageup',
  'pagedown',
  'insert',
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`)
] as const
type NamedKey = (typeof NAMED_KEYS)[number]

export interface Combination {
  modifiers: Modifier[]
  /** A named key, or one character, in lower case. */
  key: NamedKey | string
}

// Maps rather than objects, so that a word such as "constructor" is not found on every object's prototype.
const MODIFIERS = new Map<string, Modifier>([
  ['control', 'control'],
  ['ctrl', 'control'],
  ['shift', 'shift'],
  ['alt', 'alt'],
  ['option', 'alt'],
  ['meta', 'meta'],
  ['command', 'meta'],
  ['cmd', 'meta'],
  ['win', 'meta'],
  ['super', 'meta']
])

const ALIASES = new Map<string, NamedKey>([
  ['return', 'enter'],
  ['esc', 'escape'],
  ['del', 'delete'],
  ['up', 'arrowup'],
  ['down', 'arrowdown'],
  ['left', 'arrowleft'],
  ['right', 'arrowright'],
  ['pgup', 'pageup'],
  ['pgdn', 'pagedown'],
  ['ins', 'insert'],
  ['spacebar', 'space']
])

/** A combination read from its name, or why it cannot be pressed, in words a model acts on. */
export function readKey(written: string): Combination | { problem: string } {
  const parts = written
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
  // "Control++" names the plus key.
  if (written.trim().endsWith('++')) parts.push('+')
  const modifiers: Modifier[] = []
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS.get(part)
    if (!modifier) return { problem: `"${part}" is not a modifier: use Control, Shift, Alt or Meta, as in "Control+S".` }
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }
  const last = parts.at(-1)
  if (last === undefined) return { problem: 'Name a key to press, such as "Enter" or "Control+S".' }
  const key = ALIASES.get(last) ?? last
  if ((NAMED_KEYS as readonly string[]).includes(key) || [...key].length === 1) return { modifiers, key }
  return {
    problem: `"${last}" is not a key: use Enter, Escape, Tab, Backspace, Delete, Space, the arrows, Home, End, PageUp, PageDown, F1 to F12, or a character.`
  }
}
