import { glob, readdir } from 'node:fs/promises'
import { join, sep } from 'node:path'

/**
 * What a use reaches inside a folder, looked for on the disk (docs/SPEC.md, section 12.2): the paths a wildcard
 * matches, and a file never reached by the ending of its name in a folder a use goes through. Both are bounded, so a
 * check never stalls on a large tree.
 */

/** Folders read at once while walking a tree: one after the other, 20,000 entries take seconds on Windows. */
const AT_ONCE = 64

/**
 * The paths a wildcard matches from a folder, as the shell matches them: a name starting with a dot only when the
 * pattern's part does, whatever its capitals on Windows and macOS. `more` when there are more than `limit`.
 */
export async function matches(folder: string, pattern: string, limit: number): Promise<{ found: string[]; more: boolean }> {
  const found: string[] = []
  // A backslash separates folders on Windows, where no shell escapes with it.
  for await (const match of glob(sep === '\\' ? pattern.replaceAll('\\', '/') : pattern, { cwd: folder })) {
    if (found.length === limit) return { found, more: true }
    found.push(join(folder, match))
  }
  return { found, more: false }
}

/**
 * The first file or folder inside a folder whose name ends as one of `endings` does (in lower case), links not
 * followed, with the ending. `unwalked` once `budget` entries were looked at with more to look at: the budget is
 * shared by the walks of one use.
 */
export async function endingInside(
  folder: string,
  endings: readonly string[],
  budget: { left: number }
): Promise<{ path: string; ending: string } | 'unwalked' | undefined> {
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
        }
    }
    level = next
  }
  return undefined
}
