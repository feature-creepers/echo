import type { AccessUse, FileChange, FileDiff, Hunk } from '@repo/protocol'

/** A path as the person reads it: within the first of the folders that holds it, by its place there; else whole. */
export function relativePath(path: string, folders: readonly (string | undefined)[]): string {
  // Windows names the same place whatever the capitals, and with either slash.
  const windows = /^[a-z]:[\\/]/i.test(path)
  const same = (value: string) => (windows ? value.replaceAll('\\', '/').toLowerCase() : value)
  for (const folder of folders) {
    if (!folder) continue
    const base = folder.replace(/[\\/]+$/, '')
    if (base === '') continue
    if (same(path) === same(base)) return '.'
    const rest = path.slice(base.length)
    if (same(path.slice(0, base.length)) === same(base) && (rest.startsWith('/') || rest.startsWith('\\'))) return rest.slice(1)
  }
  return path
}

/** A path split where it is cut: the folder, which gives way first, and the name, kept in sight. */
export function splitPath(path: string): { folder: string; name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at < 0 ? { folder: '', name: path } : { folder: path.slice(0, at + 1), name: path.slice(at + 1) }
}

/** The last part of a path: a folder's name. */
export const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** One line of a hunk as it is drawn: what it is, its text, and its number in each version it is in. */
export interface DrawnLine {
  kind: 'context' | 'added' | 'removed'
  text: string
  before?: number
  after?: number
  /** The line has no line break after it: the last of its version. */
  unended?: boolean
  /** The words changed in it, against the line it replaced or was replaced by: where each starts and ends. */
  marks?: readonly (readonly [start: number, end: number])[]
}

/** The lines of a hunk, numbered in each version from where the hunk starts. */
export function drawnLines(hunk: Hunk): DrawnLine[] {
  const drawn: DrawnLine[] = []
  let before = hunk.before.start
  let after = hunk.after.start
  for (const line of hunk.lines) {
    if (line === '\\') {
      const last = drawn.at(-1)
      if (last) last.unended = true
      continue
    }
    const sign = line[0]
    const text = line.slice(1)
    if (sign === '+') drawn.push({ kind: 'added', text, after: after++ })
    else if (sign === '-') drawn.push({ kind: 'removed', text, before: before++ })
    else drawn.push({ kind: 'context', text, before: before++, after: after++ })
  }
  return drawn
}

/** How many unchanged lines lie before each hunk, and after the last one. */
export function unchangedAround(file: Pick<FileDiff, 'hunks' | 'lines'>): { before: number[]; after: number } {
  let end = 0
  const before = file.hunks.map((hunk) => {
    // A hunk that only adds starts after the line before it: its start is where its first line would be.
    const gap = Math.max(0, hunk.before.start - 1 - end)
    end = hunk.before.start - 1 + hunk.before.count
    return gap
  })
  return { before, after: file.hunks.length === 0 ? 0 : Math.max(0, file.lines.before - end) }
}

/** The widest line number of a file's diff, in digits, so its numbers line up. */
export function numberWidth(file: Pick<FileDiff, 'lines'>): number {
  return String(Math.max(file.lines.before, file.lines.after, 1)).length
}

const count = new Intl.NumberFormat('en-GB')

/** A number of lines, as it is read: "1 line", "2,400 lines". */
export const linesInWords = (number: number) => `${count.format(number)} ${number === 1 ? 'line' : 'lines'}`

/** What a change did in all, as one line: "3 files changed", and the lines added and removed. */
export function changedInWords(files: readonly FileChange[]): { files: string; added: number; removed: number } {
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  if (files.length === 1) {
    const only = files[0]
    const verb = only?.status === 'created' ? 'created' : only?.status === 'deleted' ? 'deleted' : 'changed'
    return { files: `1 file ${verb}`, added, removed }
  }
  return { files: `${count.format(files.length)} files changed`, added, removed }
}

/** Added and removed lines, as the diff header shows them. A minus sign, not a hyphen. */
export const plus = (number: number) => `+${count.format(number)}`
export const minus = (number: number) => `−${count.format(number)}`

/** The word for what a change did to a file, when it did more than change it. */
export const STATUS_WORDS: Record<FileChange['status'], string | undefined> = { created: 'New file', deleted: 'Deleted', changed: undefined }

/** The lines a use added and removed in all its files; nothing for a use that changed none, or before they were counted. */
export function totalOf(use: AccessUse): Pick<FileChange, 'added' | 'removed' | 'binary' | 'large'> | undefined {
  const changes = use.changes ?? []
  const [only] = changes
  if (!only) return undefined
  if (changes.length === 1 && (only.binary || only.large)) return only
  return { added: changes.reduce((sum, one) => sum + one.added, 0), removed: changes.reduce((sum, one) => sum + one.removed, 0) }
}
