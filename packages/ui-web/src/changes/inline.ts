/**
 * The words changed within a line: a line removed and the line added in its place are compared word by word, so
 * the person sees what changed in it, as a review of code shows it. Done where the diff is drawn: the core gives
 * lines, and which of their words to mark is a matter of showing them.
 *
 * Bounded whatever the lines: the words both lines start and end with are set aside first, as most edits change a
 * few words of a line; the rest is compared word by word only while it is small, and within a budget each file
 * shares, and otherwise marked whole between what they share at the start and at the end.
 */

import type { DrawnLine } from './words.ts'

/** Where a mark starts and ends in a line, in characters, the end left out. */
export type Mark = readonly [start: number, end: number]

/** The cells a comparison of two lines' middles may fill, past which their middle is marked whole. */
export const PAIR_CELLS = 40_000

/** The cells all the lines of one file may fill together, so a file of long rewritten lines stays quick to draw. */
export const FILE_CELLS = 2_000_000

/**
 * The share of the shorter line's visible characters the two lines must share for their words to be marked: below
 * it the line was rewritten, and marks all over it would say less than its tint already does.
 */
const KEPT_LEAST = 0.5

interface Token {
  text: string
  start: number
  space: boolean
}

/** A line as words, spaces and single marks of punctuation, each with where it starts. */
function tokens(line: string): Token[] {
  const found: Token[] = []
  for (const match of line.matchAll(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu)) {
    found.push({ text: match[0], start: match.index, space: /^\s/.test(match[0]) })
  }
  return found
}

/** What comparing two lines found: the marks in each, and the cells it filled. */
export interface LineMarks {
  before: Mark[]
  after: Mark[]
  cells: number
}

/** Which tokens of each line the other shares, in order: their longest common run of tokens, found within `cells`. */
function shared(before: Token[], after: Token[], cells: number): { before: boolean[]; after: boolean[]; cells: number } {
  const keptBefore = before.map(() => false)
  const keptAfter = after.map(() => false)
  let start = 0
  while (start < before.length && start < after.length && before[start]?.text === after[start]?.text) {
    keptBefore[start] = true
    keptAfter[start] = true
    start++
  }
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1]?.text === after[endAfter - 1]?.text) {
    keptBefore[--endBefore] = true
    keptAfter[--endAfter] = true
  }
  const rows = endBefore - start
  const columns = endAfter - start
  const needed = rows * columns
  if (needed === 0) return { before: keptBefore, after: keptAfter, cells: 0 }
  if (needed > cells) return { before: keptBefore, after: keptAfter, cells: 0 }

  // The longest common run of the middles, by dynamic programming over a table of lengths from the end.
  const width = columns + 1
  const table = new Uint16Array((rows + 1) * width)
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row * width + column] =
        before[start + row]?.text === after[start + column]?.text
          ? (table[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(table[(row + 1) * width + column] ?? 0, table[row * width + column + 1] ?? 0)
    }
  }
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (before[start + row]?.text === after[start + column]?.text) {
      keptBefore[start + row] = true
      keptAfter[start + column] = true
      row++
      column++
    } else if ((table[(row + 1) * width + column] ?? 0) >= (table[row * width + column + 1] ?? 0)) row++
    else column++
  }
  return { before: keptBefore, after: keptAfter, cells: needed }
}

/** The marks of a line from which of its tokens are kept: runs of changed tokens, joined across a space between two. */
function marksOf(line: Token[], kept: boolean[]): Mark[] {
  const marks: [number, number][] = []
  line.forEach((token, index) => {
    if (kept[index]) return
    const end = token.start + token.text.length
    const last = marks.at(-1)
    const between = line[index - 1]
    // Two changed words with one unchanged space between them read as one change.
    const joins = last && (last[1] === token.start || (between?.space && kept[index - 1] && last[1] === between.start && !token.space))
    if (last && joins) last[1] = end
    else marks.push([token.start, end])
  })
  // A mark starts and ends on a word, and a space alone is not marked: a change of spacing shows in the line's tint.
  return marks.flatMap(([start, end]): Mark[] => {
    const inside = line.filter((token) => !token.space && token.start >= start && token.start < end)
    const first = inside[0]
    const last = inside.at(-1)
    return first && last ? [[first.start, last.start + last.text.length]] : []
  })
}

const visible = (line: Token[], kept?: boolean[]) =>
  line.reduce((sum, token, index) => (token.space || (kept && !kept[index]) ? sum : sum + token.text.length), 0)

/**
 * The words changed between a line removed and the line added in its place, within the cells given. Nothing to mark
 * when the lines are the same, or so different that the whole line changed.
 */
export function lineMarks(before: string, after: string, cells = PAIR_CELLS): LineMarks {
  const none = (used: number): LineMarks => ({ before: [], after: [], cells: used })
  if (before === after) return none(0)
  const old = tokens(before)
  const next = tokens(after)
  const kept = shared(old, next, Math.min(cells, PAIR_CELLS))
  const shorter = Math.min(visible(old), visible(next))
  if (shorter === 0 || visible(old, kept.before) / shorter < KEPT_LEAST) return none(kept.cells)
  return { before: marksOf(old, kept.before), after: marksOf(next, kept.after), cells: kept.cells }
}

/**
 * The lines of a hunk with the words changed in each line marked. In each change, a run of lines removed then a run
 * added, the first line removed is compared with the first added, the second with the second, and so on; a line with
 * no counterpart, or rewritten whole, has no marks. `budget` is the cells left for the file, and is spent.
 */
export function markChanges(lines: DrawnLine[], budget: { cells: number }): DrawnLine[] {
  const marked = lines.map((line) => ({ ...line }))
  let at = 0
  while (at < marked.length) {
    if (marked[at]?.kind !== 'removed') {
      at++
      continue
    }
    const removedFrom = at
    while (marked[at]?.kind === 'removed') at++
    const addedFrom = at
    while (marked[at]?.kind === 'added') at++
    const pairs = Math.min(addedFrom - removedFrom, at - addedFrom)
    for (let pair = 0; pair < pairs; pair++) {
      const removed = marked[removedFrom + pair] as DrawnLine
      const added = marked[addedFrom + pair] as DrawnLine
      const found = lineMarks(removed.text, added.text, budget.cells)
      budget.cells = Math.max(0, budget.cells - found.cells)
      if (found.before.length > 0) removed.marks = found.before
      if (found.after.length > 0) added.marks = found.after
    }
  }
  return marked
}
