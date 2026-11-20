/**
 * The outline a model acts from, made from Playwright's snapshot of a page "for AI": every element as the page's
 * accessibility tree has it, one per line, indented as they nest, each with a reference (`[ref=e12]`) that
 * Playwright resolves again (`page.getByRef`).
 *
 * That snapshot holds every paragraph too, which makes an article tens of thousands of characters long. The
 * outline keeps what can be used (links, buttons, fields, lists, tabs, options) and the headings that say where
 * they are; the text itself is what `browser_read` gives.
 */

/** Roles a person can use: the lines kept. */
const USABLE = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem'
])

/** Roles kept to say where the usable ones are. */
const LANDMARKS = new Set(['heading', 'dialog', 'alertdialog', 'alert', 'form', 'search', 'navigation', 'main', 'iframe'])

/** States worth keeping after the reference: whether a box is checked, a section open, a button pressed. */
const KEPT_STATES = /\[(?:checked(?:=\w+)?|disabled|expanded(?:=\w+)?|selected|pressed(?:=\w+)?|level=\d+|active)\]/g

/** The longest a line of the outline is, in characters. */
const LINE_LENGTH = 200

/** One line of a snapshot, read. */
interface SnapshotLine {
  /** How deep it is, from its indentation. */
  depth: number
  role: string
  name: string
  ref: string | undefined
  /** The line as the outline shows it, without its indentation. */
  shown: string
}

const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/i

/** A line of the snapshot, or nothing for a line that is not an element (a property such as `/url:`, plain text). */
export function readLine(line: string): SnapshotLine | undefined {
  const match = LINE.exec(line)
  if (!match) return undefined
  const [, indent = '', role = '', quoted, rest = ''] = match
  const name = quoted === undefined ? '' : quoted.replace(/\\(.)/g, '$1')
  const ref = /\[ref=([a-z0-9]+)\]/i.exec(rest)?.[1]
  // What follows a colon is the element's own text, when it has one: a link written `- link [ref=e3]: Home`.
  const text = /\]?\s*:\s*(.+)$/.exec(rest)?.[1]?.trim()
  const states = rest.match(KEPT_STATES)?.join(' ') ?? ''
  const label = name ? ` "${name}"` : ''
  const own = text && !text.startsWith('"') && text !== name ? `: ${text}` : ''
  const shown = `- ${role}${label}${states ? ` ${states}` : ''}${ref ? ` [ref=${ref}]` : ''}${own}`
  return { depth: Math.floor(indent.length / 2), role, name, ref, shown: shown.length > LINE_LENGTH ? `${shown.slice(0, LINE_LENGTH - 1)}…` : shown }
}

export interface Outline {
  /** The kept lines, indented by how many kept lines they sit in. */
  lines: string[]
  /** Each reference's role and name, for every element of the snapshot, kept or not. */
  refs: Map<string, { role: string; name: string }>
}

/** The outline of a snapshot: what can be used, under the headings and landmarks it sits in. */
export function outlineOf(snapshot: string): Outline {
  const lines: string[] = []
  const refs = new Map<string, { role: string; name: string }>()
  // The kept lines this one is inside, by their depth in the snapshot.
  const open: number[] = []
  for (const raw of snapshot.split('\n')) {
    const line = readLine(raw)
    if (!line) continue
    if (line.ref) refs.set(line.ref, { role: line.role, name: line.name })
    while (open.length > 0 && (open.at(-1) as number) >= line.depth) open.pop()
    const usable = USABLE.has(line.role)
    const landmark = LANDMARKS.has(line.role)
    // A landmark with nothing to say is not worth a line: a navigation is kept, an unnamed form is not.
    if (!usable && !(landmark && (line.name !== '' || line.role === 'navigation' || line.role === 'main' || line.role === 'dialog'))) continue
    lines.push(`${'  '.repeat(open.length)}${line.shown}`)
    // A link's own parts (its picture, its text) say nothing more than its name: only containers keep their children nested.
    if (!usable || line.role === 'listbox' || line.role === 'combobox') open.push(line.depth)
  }
  return { lines, refs }
}

/** An outline as text, cut at a line once it reaches `length` characters. */
export function outlineText(outline: Outline, length: number): { text: string; cut: boolean } {
  let used = 0
  const kept: string[] = []
  for (const line of outline.lines) {
    if (used + line.length + 1 > length) return { text: kept.join('\n'), cut: true }
    kept.push(line)
    used += line.length + 1
  }
  return { text: kept.join('\n'), cut: false }
}

/**
 * The lines of `after` that `before` did not have, as they read without indentation: what an action brought.
 * Where the focus is (`[active]`) is shown but is not a change: a field clicked into is not new.
 */
export function changesBetween(before: readonly string[], after: readonly string[]): string[] {
  const plain = (line: string) => line.replace(' [active]', '').trim()
  const had = new Set(before.map(plain))
  return after.map((line) => line.trim()).filter((line) => !had.has(plain(line)))
}
