/**
 * The outline a model acts from, made from a window's accessibility tree as each system's helper reads it: one
 * element per line, indented as they nest, each with a reference (`[e12]`) the adapter turns back into the helper's
 * own key for it. The same on every system: only the helper differs.
 */

/** An element as a helper reads it, in the order of the tree, with how deep it is. */
export interface TreeNode {
  /** The helper's own key for it: what it acts on again. */
  key: string
  /** Its role, in the system's words: `ControlType.Button`, `AXButton`, `push button`. */
  role: string
  name: string
  /** What a field holds. Never sent for a password field. */
  value?: string | undefined
  password?: boolean | undefined
  enabled?: boolean | undefined
  /** How deep it is in the window, the window's own children at 0. */
  depth: number
  /** What else names it: an identifier, a help text, a description. */
  hints?: string[] | undefined
}

/** Roles a person uses or reads by: kept even without a name. Others are kept only when they have one. */
const USABLE =
  /\b(button|edit|text field|text area|entry|link|hyperlink|combo ?box|list item|menu item|menu|tab item|page tab|tab|check ?box|radio button|slider|spinner|spin button|tree item|data item|toggle button|document|cell)\b/

/** A role in plain words, the same for every system: `ControlType.ListItem`, `AXListItem` and `list item` all read `list item`. */
export function roleOf(role: string): string {
  return role
    .replace(/^ControlType\./, '')
    .replace(/^AX/, '')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .replace(/^push button$/, 'button')
    .replace(/^static text$|^label$/, 'text')
    .replace(/^password text$|^secure text field$/, 'password field')
    .trim()
}

const quoted = (text: string, length: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return JSON.stringify(one.length > length ? `${one.slice(0, length - 1)}…` : one)
}

export interface Outline {
  text: string
  /** Whether it was cut to the length asked. */
  cut: boolean
  /** The helper's key of each reference given. */
  keys: Map<string, string>
}

/**
 * The outline of a tree, at most `length` characters. An element with neither a name nor a role a person uses is
 * left out and its children rise to its place, so a window's many unnamed panes do not bury what matters.
 * References are numbered from `first`, so those of two looks never clash.
 */
export function outlineOf(nodes: readonly TreeNode[], length: number, first = 1): Outline {
  const keys = new Map<string, string>()
  const lines: string[] = []
  let used = 0
  let cut = false
  let next = first
  // The depth each kept ancestor is shown at, so children of a left-out element rise to its place.
  const shownAt: { depth: number; shown: number }[] = []
  for (const node of nodes) {
    while (shownAt.length > 0 && (shownAt.at(-1) as { depth: number }).depth >= node.depth) shownAt.pop()
    const role = roleOf(node.role)
    const name = node.name.trim()
    if (name === '' && !USABLE.test(role)) continue
    const indent = shownAt.length
    shownAt.push({ depth: node.depth, shown: indent })
    const ref = `e${next++}`
    const value = !node.password && node.value !== undefined && node.value.trim() !== '' && node.value.trim() !== name ? ` = ${quoted(node.value, 80)}` : ''
    const state = node.enabled === false ? ' (disabled)' : ''
    const line = `${'  '.repeat(indent)}- ${role || 'element'}${name ? ` ${quoted(name, 120)}` : ''}${value}${state} [${ref}]`
    if (used + line.length + 1 > length) {
      cut = true
      break
    }
    keys.set(ref, node.key)
    lines.push(line)
    used += line.length + 1
  }
  return { text: lines.join('\n'), cut, keys }
}
