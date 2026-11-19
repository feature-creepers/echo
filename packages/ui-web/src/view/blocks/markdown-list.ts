/**
 * The lines of a Markdown list read as the lists they make: an item indented under another is within it, and a list
 * changes when its marks do, from bullets to numbers or back, so a numbered list keeps its count past a bulleted one
 * inside it.
 */

export interface MarkdownListItem {
  text: string
  lists: MarkdownList[]
}

export interface MarkdownList {
  ordered: boolean
  /** The number of its first item, for a numbered list. */
  start: number
  items: MarkdownListItem[]
}

/** A line of a list: its indent, its mark, its number and its text. */
export const LIST_LINE = /^(\s*)(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/

interface Line {
  indent: number
  ordered: boolean
  number: number
  text: string
}

/** How far a line is indented, a tab as four spaces. */
const indentOf = (space: string) => space.replace(/\t/g, '    ').length

/** The lists that lines of Markdown make, each line one that `LIST_LINE` reads. */
export function markdownLists(lines: readonly string[]): MarkdownList[] {
  const read: Line[] = lines.flatMap((line) => {
    const match = LIST_LINE.exec(line)
    if (!match) return []
    return [{ indent: indentOf(match[1] ?? ''), ordered: match[2] !== undefined, number: Number(match[2] ?? 1), text: match[3] ?? '' }]
  })
  return within(read, 0, read.length)
}

/** The lists the lines from `from` to `to` make, at the indent of the first of them. */
function within(lines: readonly Line[], from: number, to: number): MarkdownList[] {
  const lists: MarkdownList[] = []
  const indent = lines[from]?.indent ?? 0
  let at = from
  while (at < to) {
    const line = lines[at] as Line
    // What is indented further than this item belongs to it.
    let end = at + 1
    while (end < to && (lines[end]?.indent ?? 0) > Math.max(indent, line.indent)) end++
    const item = { text: line.text, lists: end > at + 1 ? within(lines, at + 1, end) : [] }
    const last = lists.at(-1)
    if (last && last.ordered === line.ordered) last.items.push(item)
    else lists.push({ ordered: line.ordered, start: line.number, items: [item] })
    at = end
  }
  return lists
}
