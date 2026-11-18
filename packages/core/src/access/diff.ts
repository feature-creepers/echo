import type { Hunk } from '@repo/protocol'

/**
 * Two versions of a text compared line by line, as unified hunks with three unchanged lines around each change,
 * so the person can review what the assistant changed on the computer (docs/SPEC.md, section 12.2).
 *
 * Written here rather than taken from a library, for three reasons. The core takes no dependency beyond its
 * contracts. The work stays bounded whatever the files: each distinct line is numbered once so lines compare as
 * numbers, the common start and end are set aside first (most changes touch a few lines of a long file), and
 * Myers' algorithm, which finds the shortest diff, runs only while the versions differ by a few hundred lines.
 * Beyond that, lines found exactly once in each version anchor the comparison, as patience diff does, and what
 * lies between two anchors is compared again the same way, so a long file rewritten in many places still gives a
 * readable diff in bounded time; a stretch with no anchor that is still too different is shown removed, then
 * added, which is what it reads as anyway.
 *
 * Line endings are set aside for the comparison: a file turned from CRLF to LF is not a file whose every line
 * changed. That they changed is said apart.
 */

/** How much of a diff is shown. */
export interface DiffLimits {
  /** Unchanged lines shown around each change. */
  context: number
  /** The most lines one file's diff shows. */
  lines: number
  /** The most characters shown, all lines together: a budget several files can share. */
  characters: number
  /** The most characters of one line shown. */
  width: number
}

export const DIFF_LIMITS: DiffLimits = { context: 3, lines: 4000, characters: 400_000, width: 2000 }

/** The largest text compared. A larger one is said to be too large, as its lines could not be counted quickly. */
export const COMPARED_LIMIT = 5 * 1024 * 1024

export interface TextDiff {
  hunks: Hunk[]
  added: number
  removed: number
  /** How many lines each version has. */
  lines: { before: number; after: number }
  /** The characters the hunks show, to count against a budget shared with other files. */
  characters: number
  /** The hunks stop short of the end: the diff was longer than the limits. */
  cut: boolean
  /** Some lines were longer than the limit, and are shown in part. */
  clipped: boolean
  /** The versions end their lines differently, CRLF in one and LF in the other. */
  endings: boolean
}

/** How far into a file its bytes are looked at for a NUL, which only a file that is not text holds. */
const SNIFFED = 8 * 1024

/** A file's bytes as text, or nothing when it is not text: a NUL byte in its first 8 KB, or not UTF-8. */
export function textOf(bytes: Uint8Array): string | undefined {
  if (bytes.subarray(0, SNIFFED).includes(0)) return undefined
  try {
    // A byte-order mark is kept as part of the first line, so a change to it alone is seen.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** The lines a version changed: how many it added and removed, without the hunks. */
export function countChanges(before: string, after: string): { added: number; removed: number } {
  const compared = compare(before, after)
  let added = 0
  let removed = 0
  for (const run of compared.runs) {
    if (run.kind === ADDED) added += run.count
    else if (run.kind === REMOVED) removed += run.count
  }
  return { added, removed }
}

/** Two versions of a text, as the hunks a unified diff shows, within the limits given. */
export function diffText(before: string, after: string, limits: Partial<DiffLimits> = {}): TextDiff {
  const { context, lines: mostLines, characters: budget, width } = { ...DIFF_LIMITS, ...limits }
  const { runs, old, new: next } = compare(before, after)

  // Where each change is: from the start of each version, what it removes and what it adds.
  const changes: { x: number; y: number; removed: number; added: number }[] = []
  let x = 0
  let y = 0
  let added = 0
  let removed = 0
  for (const run of runs) {
    if (run.kind === SAME) {
      x += run.count
      y += run.count
      continue
    }
    const last = changes.at(-1)
    const change = last && last.x + last.removed === x && last.y + last.added === y ? last : { x, y, removed: 0, added: 0 }
    if (change !== last) changes.push(change)
    if (run.kind === REMOVED) {
      change.removed += run.count
      removed += run.count
      x += run.count
    } else {
      change.added += run.count
      added += run.count
      y += run.count
    }
  }

  // Changes closer than twice the context share one hunk, so no unchanged line is shown twice.
  const groups: (typeof changes)[] = []
  for (const change of changes) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (group && previous && change.x - (previous.x + previous.removed) <= 2 * context) group.push(change)
    else groups.push([change])
  }

  const hunks: Hunk[] = []
  let shownLines = 0
  let characters = 0
  let cut = false
  let clipped = false

  for (const group of groups) {
    const first = group[0]
    const last = group.at(-1)
    if (!first || !last) continue
    const startX = Math.max(0, first.x - context)
    const startY = first.y - (first.x - startX)
    const endX = Math.min(old.lines.length, last.x + last.removed + context)
    const lines: string[] = []
    let countBefore = 0
    let countAfter = 0

    /** Show one line, unless a limit is reached: then the diff is cut there. */
    const show = (sign: ' ' | '+' | '-', text: string, final: boolean): boolean => {
      const kept = text.length > width ? text.slice(0, width) : text
      if (shownLines >= mostLines || characters + kept.length + 1 > budget) {
        cut = true
        return false
      }
      if (kept !== text) clipped = true
      lines.push(`${sign}${kept}`)
      // A line with no line break after it is the last of its version: a unified diff marks it.
      if (final) lines.push('\\')
      shownLines++
      characters += kept.length + 1
      if (sign !== '+') countBefore++
      if (sign !== '-') countAfter++
      return true
    }
    const lastOf = (version: Version, index: number) => index === version.lines.length - 1 && !version.ends

    let i = startX
    let j = startY
    let going = true
    const unchanged = (until: number) => {
      while (going && i < until) {
        going = show(' ', old.lines[i] ?? '', lastOf(old, i))
        if (!going) return
        i++
        j++
      }
    }
    for (const change of group) {
      unchanged(change.x)
      for (let removing = 0; going && removing < change.removed; removing++) {
        going = show('-', old.lines[i] ?? '', lastOf(old, i))
        if (going) i++
      }
      for (let adding = 0; going && adding < change.added; adding++) {
        going = show('+', next.lines[j] ?? '', lastOf(next, j))
        if (going) j++
      }
      if (!going) break
    }
    unchanged(endX)
    if (lines.length > 0) {
      hunks.push({ before: { start: startX + 1, count: countBefore }, after: { start: startY + 1, count: countAfter }, lines })
    }
    if (!going) break
  }

  return {
    hunks,
    added,
    removed,
    lines: { before: old.lines.length, after: next.lines.length },
    characters,
    cut,
    clipped,
    endings: old.endings !== 'none' && next.endings !== 'none' && old.endings !== next.endings
  }
}

/** A version of a text as lines, without their line breaks. */
interface Version {
  lines: string[]
  /** The last line ends with a line break, as a text file's should. An empty text counts as ending well. */
  ends: boolean
  /** How its lines end: with LF, with CRLF, both, or with no break at all (one line, or none). */
  endings: 'none' | 'lf' | 'crlf' | 'mixed'
}

function linesOf(text: string): Version {
  if (text === '') return { lines: [], ends: true, endings: 'none' }
  const lines = text.split('\n')
  const ends = lines.at(-1) === ''
  if (ends) lines.pop()
  const broken = ends ? lines.length : lines.length - 1
  let crlf = 0
  for (let index = 0; index < broken; index++) {
    const line = lines[index] ?? ''
    if (line.endsWith('\r')) {
      lines[index] = line.slice(0, -1)
      crlf++
    }
  }
  const lf = broken - crlf
  return { lines, ends, endings: crlf > 0 && lf > 0 ? 'mixed' : crlf > 0 ? 'crlf' : lf > 0 ? 'lf' : 'none' }
}

const SAME = 0
const REMOVED = 1
const ADDED = 2
type Run = { kind: typeof SAME | typeof REMOVED | typeof ADDED; count: number }

/** The two versions, and the runs of lines kept, removed and added that turn one into the other. */
function compare(before: string, after: string): { runs: Run[]; old: Version; new: Version } {
  const old = linesOf(before)
  const next = linesOf(after)
  // Each distinct line is given a number, so lines compare as numbers. The last line of a version that does not
  // end with a line break is a line of its own: adding the break changes it, as a unified diff shows.
  const numbers = new Map<string, number>()
  const numbered = (version: Version) =>
    Int32Array.from(version.lines, (line, index) => {
      const key = index === version.lines.length - 1 && !version.ends ? `${line}\n` : line
      let number = numbers.get(key)
      if (number === undefined) {
        number = numbers.size
        numbers.set(key, number)
      }
      return number
    })
  const script = new Script()
  diffRange(numbered(old), 0, old.lines.length, numbered(next), 0, next.lines.length, script)
  return { runs: script.done(), old, new: next }
}

/**
 * The runs of a diff as it is found, in order. Within a change, every line removed is put before every line added,
 * as a unified diff shows a change, whatever order the search found them in.
 */
class Script {
  private readonly runs: Run[] = []
  private removed = 0
  private added = 0

  same(count: number): void {
    if (count === 0) return
    this.flush()
    const last = this.runs.at(-1)
    if (last?.kind === SAME) last.count += count
    else this.runs.push({ kind: SAME, count })
  }

  remove(count: number): void {
    this.removed += count
  }

  add(count: number): void {
    this.added += count
  }

  done(): Run[] {
    this.flush()
    return this.runs
  }

  private flush(): void {
    if (this.removed > 0) this.runs.push({ kind: REMOVED, count: this.removed })
    if (this.added > 0) this.runs.push({ kind: ADDED, count: this.added })
    this.removed = 0
    this.added = 0
  }
}

/** The most work Myers' search is given, counted as lines times edits: past it, anchors take over. */
const SEARCH_BUDGET = 10_000_000
/** The most edits it looks for, whatever the length: its memory grows with their square. */
const MOST_EDITS = 1000

/** Diff a stretch of each version: what they share at the start and the end first, then what lies between. */
function diffRange(a: Int32Array, x0: number, x1: number, b: Int32Array, y0: number, y1: number, script: Script): void {
  let start = 0
  while (x0 + start < x1 && y0 + start < y1 && a[x0 + start] === b[y0 + start]) start++
  let end = 0
  while (x1 - end > x0 + start && y1 - end > y0 + start && a[x1 - end - 1] === b[y1 - end - 1]) end++
  script.same(start)
  const [fromX, toX, fromY, toY] = [x0 + start, x1 - end, y0 + start, y1 - end]
  if (fromX === toX || fromY === toY) {
    script.remove(toX - fromX)
    script.add(toY - fromY)
  } else if (!shortest(a, fromX, toX, b, fromY, toY, script)) {
    anchored(a, fromX, toX, b, fromY, toY, script)
  }
  script.same(end)
}

/**
 * Myers' O(ND) search for the shortest diff of two stretches, forward, keeping each round's furthest points to walk
 * the path back. False, with nothing written, when the stretches differ by more edits than the budget allows.
 */
function shortest(a: Int32Array, x0: number, x1: number, b: Int32Array, y0: number, y1: number, script: Script): boolean {
  const n = x1 - x0
  const m = y1 - y0
  const most = Math.min(n + m, MOST_EDITS, Math.max(64, Math.floor(SEARCH_BUDGET / (n + m))))
  const offset = most + 1
  // The furthest x reached on each diagonal k = x - y, or -1 where none was reached yet.
  const furthest = new Int32Array(2 * most + 3).fill(-1)
  furthest[offset + 1] = 0
  const rounds: Int32Array[] = []

  /** The point a round reaches on a diagonal from the one before: down (a line added) or right (one removed). */
  const step = (reached: (k: number) => number, k: number): { x: number; down: boolean } | undefined => {
    const above = reached(k + 1)
    const left = reached(k - 1)
    const down = above >= 0 && above - k <= m
    const right = left >= 0 && left + 1 <= n
    if (down && (!right || above >= left + 1)) return { x: above, down: true }
    return right ? { x: left + 1, down: false } : undefined
  }

  for (let edits = 0; edits <= most; edits++) {
    // What the rounds before reached, for diagonals -edits-1 to edits+1, to walk back through.
    const before = furthest.slice(offset - edits - 1, offset + edits + 2)
    rounds.push(before)
    for (let k = -edits; k <= edits; k += 2) {
      const from = step((diagonal) => furthest[offset + diagonal] ?? -1, k)
      if (!from) {
        furthest[offset + k] = -1
        continue
      }
      let x = from.x
      let y = x - k
      while (x < n && y < m && a[x0 + x] === b[y0 + y]) {
        x++
        y++
      }
      furthest[offset + k] = x
      if (x === n && y === m) {
        walkBack(rounds, edits, n, m, step, script)
        return true
      }
    }
  }
  return false
}

/** The path found, from its end back to its start, written forward. */
function walkBack(
  rounds: readonly Int32Array[],
  edits: number,
  n: number,
  m: number,
  step: (reached: (k: number) => number, k: number) => { x: number; down: boolean } | undefined,
  script: Script
): void {
  const backwards: Run[] = []
  let x = n
  let y = m
  for (let round = edits; round > 0; round--) {
    const before = rounds[round]
    if (!before) break
    const k = x - y
    const from = step((diagonal) => before[diagonal + round + 1] ?? -1, k)
    if (!from) break
    // The edit lands at `from.x`; the lines shared after it, on the same diagonal, run to where the path was.
    backwards.push({ kind: SAME, count: x - from.x })
    backwards.push({ kind: from.down ? ADDED : REMOVED, count: 1 })
    // The point the edit started from, on the diagonal beside: above it for a line added, left of it for one removed.
    x = from.down ? from.x : from.x - 1
    y = x - (from.down ? k + 1 : k - 1)
  }
  backwards.push({ kind: SAME, count: x })
  for (let index = backwards.length - 1; index >= 0; index--) {
    const run = backwards[index]
    if (!run) continue
    if (run.kind === SAME) script.same(run.count)
    else if (run.kind === REMOVED) script.remove(run.count)
    else script.add(run.count)
  }
}

/**
 * Two stretches too different for the search, compared through their anchors: the lines found exactly once in
 * each, the longest series of them in the same order in both (by patience sorting). What lies between two anchors
 * is diffed again; with no anchor at all, the stretch is shown removed, then added.
 */
function anchored(a: Int32Array, x0: number, x1: number, b: Int32Array, y0: number, y1: number, script: Script): void {
  const inA = new Map<number, { count: number; at: number }>()
  for (let i = x0; i < x1; i++) {
    const line = a[i] ?? -1
    const known = inA.get(line)
    if (known) known.count++
    else inA.set(line, { count: 1, at: i })
  }
  const inB = new Map<number, number>()
  for (let j = y0; j < y1; j++) inB.set(b[j] ?? -1, (inB.get(b[j] ?? -1) ?? 0) + 1)
  const pairs: { i: number; j: number }[] = []
  for (let j = y0; j < y1; j++) {
    const line = b[j] ?? -1
    const once = inA.get(line)
    if (once?.count === 1 && inB.get(line) === 1) pairs.push({ i: once.at, j })
  }
  const anchors = increasing(pairs)
  if (anchors.length === 0) {
    script.remove(x1 - x0)
    script.add(y1 - y0)
    return
  }
  let x = x0
  let y = y0
  for (const { i, j } of anchors) {
    diffRange(a, x, i, b, y, j, script)
    script.same(1)
    x = i + 1
    y = j + 1
  }
  diffRange(a, x, x1, b, y, y1, script)
}

/** The longest series of pairs, ordered by `j` already, whose `i` also increases: patience sorting. */
function increasing(pairs: readonly { i: number; j: number }[]): { i: number; j: number }[] {
  const tops: number[] = []
  const under = new Int32Array(pairs.length).fill(-1)
  for (let index = 0; index < pairs.length; index++) {
    const value = pairs[index]?.i ?? 0
    let low = 0
    let high = tops.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((pairs[tops[middle] ?? 0]?.i ?? 0) < value) low = middle + 1
      else high = middle
    }
    if (low > 0) under[index] = tops[low - 1] ?? -1
    tops[low] = index
  }
  const series: { i: number; j: number }[] = []
  for (let index = tops.at(-1) ?? -1; index >= 0; index = under[index] ?? -1) {
    const pair = pairs[index]
    if (pair) series.push(pair)
  }
  return series.reverse()
}
