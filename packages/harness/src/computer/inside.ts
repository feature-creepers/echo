import { glob, lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import type { Shell } from '@repo/core'

/**
 * What a use reaches inside a folder, looked for on the disk (docs/SPEC.md, section 12.2): the paths a wildcard
 * matches, and a file never reached by the ending of its name in a folder a use goes through. Both are bounded, so a
 * check never stalls on a large tree.
 */

/** Folders read at once while walking a tree: one after the other, 20,000 entries take seconds on Windows. */
const AT_ONCE = 64

/**
 * The paths a wildcard matches from a folder, as the shell matches them. The POSIX shell matches a name starting with
 * a dot only when the pattern's part does, whatever its capitals on Windows and macOS; PowerShell and cmd match any
 * name, whatever its capitals. `more` when there are more than `limit`.
 */
export async function matches(folder: string, pattern: string, limit: number, shell: Shell = 'posix'): Promise<{ found: string[]; more: boolean }> {
  if (shell !== 'posix') return anyNameMatches(folder, pattern, limit, shell)
  const found: string[] = []
  // A backslash separates folders on Windows, where no shell escapes with it.
  for await (const match of glob(sep === '\\' ? pattern.replaceAll('\\', '/') : pattern, { cwd: folder })) {
    if (found.length === limit) return { found, more: true }
    // An absolute alternative of a brace matches where it says, not in the folder.
    found.push(isAbsolute(match) ? match : join(folder, match))
  }
  return { found, more: false }
}

/**
 * PowerShell's and cmd's wildcards, matched part by part from the folder: `*`, `?` and, in PowerShell, `[a-z]` match
 * a name starting with a dot too. Node's glob never does, and has no way to.
 */
async function anyNameMatches(folder: string, pattern: string, limit: number, shell: Shell): Promise<{ found: string[]; more: boolean }> {
  let level = [folder]
  for (const part of pattern.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (!(shell === 'cmd' ? /[*?]/ : /[*?[]/).test(part)) {
      level = level.map((parent) => join(parent, part))
      continue
    }
    const name = new RegExp(`^${wildcard(part, shell)}$`, 'i')
    const listed = await Promise.all(level.map(async (parent) => ({ parent, names: await readdir(parent).catch(() => [] as string[]) })))
    level = listed.flatMap(({ parent, names }) => names.filter((one) => name.test(one)).map((one) => join(parent, one)))
    if (level.length > limit) return { found: level.slice(0, limit), more: true }
  }
  // A part without a wildcard names a path that must be there, as a match is.
  const there = await Promise.all(
    level.map((path) =>
      lstat(path).then(
        () => path,
        () => undefined
      )
    )
  )
  return { found: there.filter((path) => path !== undefined), more: false }
}

/** A wildcard as the source of a regular expression: `*` any characters, `?` one, `[…]` one of them in PowerShell. */
function wildcard(part: string, shell: Shell): string {
  let source = ''
  for (let at = 0; at < part.length; at++) {
    const character = part[at] as string
    const end = character === '[' && shell === 'powershell' ? part.indexOf(']', at + 2) : -1
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else if (end > 0) {
      source += `[${part.slice(at + 1, end).replace(/[\\^\]]/g, '\\$&')}]`
      at = end
    } else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return source
}

/**
 * The first file or folder inside a folder whose name ends as one of `endings` does (in lower case), links not
 * followed, with the ending. `unwalked` once `budget` entries were looked at with more to look at: the budget is
 * shared by the walks of one use. For a use that follows links (`links`), `unwalked` too when it met one: what is past
 * it was not looked through.
 */
export async function endingInside(
  folder: string,
  endings: readonly string[],
  budget: { left: number },
  links = false
): Promise<{ path: string; ending: string } | 'unwalked' | undefined> {
  let linked = false
  let level = [folder]
  while (level.length > 0) {
    const next: string[] = []
    for (let at = 0; at < level.length; at += AT_ONCE) {
      const listed = await Promise.all(
        level.slice(at, at + AT_ONCE).map(async (parent) => ({ parent, entries: await readdir(parent, { withFileTypes: true }).catch(() => []) }))
      )
      for (const { parent, entries } of listed)
        for (const entry of entries) {
          if (--budget.left < 0) return 'unwalked'
          const path = join(parent, entry.name)
          const ending = endings.find((one) => entry.name.toLowerCase().endsWith(one))
          if (ending !== undefined) return { path, ending }
          if (entry.isDirectory()) next.push(path)
          linked ||= entry.isSymbolicLink()
        }
    }
    level = next
  }
  return links && linked ? 'unwalked' : undefined
}
