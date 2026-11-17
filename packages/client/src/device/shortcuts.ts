/**
 * Keyboard shortcuts, written the way Electron writes them ("CommandOrControl+Shift+Space"), so the one text
 * serves a global shortcut registered with the system and a key watched inside the window.
 *
 * Nothing here touches a keyboard: a key press comes in as plain values, and `mac` says whether the Command
 * key is the one that stands for Control, as it does on a Mac.
 */

/** A key pressed, as a browser reports it. `code` names the key's place on the keyboard, whatever its layout. */
export interface KeyPress {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** The keys by the name Electron gives them, from the place a browser names. Letters, digits and F-keys are worked out. */
const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`'
}
const CODES = Object.fromEntries(Object.entries(NAMED).map(([code, name]) => [name, code]))

/** The key a browser's `code` names, as Electron calls it. Nothing for a modifier or a key a shortcut cannot use. */
export function keyOf(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  return NAMED[code]
}

function codeOf(key: string): string | undefined {
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^\d$/.test(key)) return `Digit${key}`
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return key
  return CODES[key]
}

const MODIFIERS = ['CommandOrControl', 'Control', 'Command', 'Super', 'Alt', 'Shift'] as const
type Modifier = (typeof MODIFIERS)[number]
const ALIASES: Record<string, Modifier> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  control: 'Control',
  ctrl: 'Control',
  command: 'Command',
  cmd: 'Command',
  super: 'Super',
  meta: 'Super',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
}

/** A shortcut taken apart: its modifiers, and the one key pressed with them. */
interface Parsed {
  modifiers: Set<Modifier>
  key: string
}

function parse(accelerator: string): Parsed | undefined {
  const parts = accelerator.split('+')
  // "+" is a key too: "Shift+Plus" is how Electron writes it, so a "+" here is always a separator.
  const key = parts.pop()
  if (key === undefined || codeOf(key) === undefined) return undefined
  const modifiers = new Set<Modifier>()
  for (const part of parts) {
    const modifier = ALIASES[part.toLowerCase()]
    if (!modifier || modifiers.has(modifier)) return undefined
    modifiers.add(modifier)
  }
  return { modifiers, key }
}

/** Whether a text is a shortcut this app can use: modifiers Electron knows, then one key. */
export function isShortcut(accelerator: string): boolean {
  return parse(accelerator) !== undefined
}

/** The keys a shortcut needs held, as a press would report them on this system. */
function needs(parsed: Parsed, mac: boolean) {
  const has = (one: Modifier) => parsed.modifiers.has(one)
  return {
    ctrl: has('Control') || (!mac && has('CommandOrControl')),
    meta: has('Command') || has('Super') || (mac && has('CommandOrControl')),
    alt: has('Alt'),
    shift: has('Shift')
  }
}

/** Whether a key press is the shortcut: the same key, with exactly the same modifiers held. */
export function matchesShortcut(press: KeyPress, accelerator: string, mac: boolean): boolean {
  const parsed = parse(accelerator)
  if (!parsed || codeOf(parsed.key) !== press.code) return false
  const held = needs(parsed, mac)
  return held.ctrl === press.ctrl && held.meta === press.meta && held.alt === press.alt && held.shift === press.shift
}

/** Two shortcuts that the same keys press, however each is written. */
export function sameShortcut(one: string, other: string, mac: boolean): boolean {
  const a = parse(one)
  const b = parse(other)
  if (!a || !b || a.key !== b.key) return false
  return JSON.stringify(needs(a, mac)) === JSON.stringify(needs(b, mac))
}

/** Shortcuts the window keeps for editing text and for the system: taking one would break typing or closing. */
const KEPT = ['C', 'V', 'X', 'A', 'Z', 'Y', 'Q', 'W']

export type Recorded =
  /** Only modifiers are held so far: wait for a key. */
  | { is: 'waiting' }
  | { is: 'shortcut'; accelerator: string }
  /** The keys cannot be a shortcut, and why, in words for the user. */
  | { is: 'refused'; problem: string }

/**
 * The shortcut a key press makes, while the user records one. A shortcut needs Control, Command or Alt held,
 * except on an F-key: anything else would fire while the user types.
 */
export function recordShortcut(press: KeyPress, mac: boolean): Recorded {
  const key = keyOf(press.code)
  if (key === undefined) return { is: 'waiting' }
  const modifiers: Modifier[] = []
  if (press.ctrl) modifiers.push(mac ? 'Control' : 'CommandOrControl')
  if (press.meta) modifiers.push(mac ? 'CommandOrControl' : 'Super')
  if (press.alt) modifiers.push('Alt')
  if (press.shift) modifiers.push('Shift')
  const accelerator = [...modifiers, key].join('+')
  const strong = press.ctrl || press.meta || press.alt
  if (!strong && !/^F\d+$/.test(key))
    return {
      is: 'refused',
      problem: `${describeShortcut(accelerator, mac)} would fire while you type. Hold Ctrl, Alt or ${mac ? 'Command' : 'the Windows key'} too.`
    }
  const editing = (press.ctrl || press.meta) && !press.alt && !press.shift && KEPT.includes(key)
  if (editing) return { is: 'refused', problem: `${describeShortcut(accelerator, mac)} is kept for editing text and for the window.` }
  return { is: 'shortcut', accelerator }
}

const MAC_SYMBOLS: Record<Modifier, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Super: '⌘', Alt: '⌥', Shift: '⇧' }
const PC_NAMES: Record<Modifier, string> = { CommandOrControl: 'Ctrl', Command: 'Win', Control: 'Ctrl', Super: 'Win', Alt: 'Alt', Shift: 'Shift' }
const KEY_NAMES: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Escape: 'Esc', Delete: 'Del', Backspace: '⌫', Enter: '↵' }
/** The order a system writes modifiers in. */
const MAC_ORDER: Modifier[] = ['Control', 'Alt', 'Shift', 'CommandOrControl', 'Command', 'Super']
const PC_ORDER: Modifier[] = ['CommandOrControl', 'Control', 'Super', 'Command', 'Alt', 'Shift']

/** The keys of a shortcut as this system's keyboard labels them, one per key: ["Ctrl", "Shift", "Space"] or ["⇧", "⌘", "Space"]. */
export function shortcutKeys(accelerator: string, mac: boolean): string[] {
  const parsed = parse(accelerator)
  if (!parsed) return []
  const order = mac ? MAC_ORDER : PC_ORDER
  const names = mac ? MAC_SYMBOLS : PC_NAMES
  const modifiers = order.filter((modifier) => parsed.modifiers.has(modifier)).map((modifier) => names[modifier])
  return [...new Set(modifiers), KEY_NAMES[parsed.key] ?? parsed.key]
}

/** A shortcut in words, for a sentence: "Ctrl+Shift+Space", "⇧⌘Space". */
export function describeShortcut(accelerator: string, mac: boolean): string {
  const keys = shortcutKeys(accelerator, mac)
  return mac ? keys.join('') : keys.join('+')
}
