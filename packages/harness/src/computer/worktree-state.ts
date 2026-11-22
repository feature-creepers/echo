import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { git, text } from './git.ts'
import { kindAt } from './paths.ts'

/**
 * How a copy of a repository stands before it is removed (docs/SPEC.md, section 7.11): how much room it takes, and
 * what removing it would lose. What was committed is never lost, since its branch stays; what was not is.
 */

/** The most files counted for a copy's size: past it, the size is not said rather than said wrong. */
const COUNTED_LIMIT = 300_000

/** What is under way in a work tree, by the file git keeps while it is. */
const UNDER_WAY: readonly [string, string][] = [
  ['rebase-merge', 'a rebase under way'],
  ['rebase-apply', 'a rebase under way'],
  ['MERGE_HEAD', 'a merge under way'],
  ['BISECT_LOG', 'a bisect under way']
]

/**
 * The room a folder takes, in bytes: its files, links not followed. A file that other folders hold too (a hard link,
 * as pnpm makes from its store) takes no room of its own. Nothing when it holds more files than are counted.
 */
export async function sizeOf(folder: string): Promise<number | undefined> {
  let size = 0
  let counted = 0
  const waiting = [folder]
  while (waiting.length > 0) {
    const current = waiting.pop() as string
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      if (++counted > COUNTED_LIMIT) return undefined
      const path = join(current, entry.name)
      if (entry.isDirectory()) waiting.push(path)
      else if (entry.isFile()) {
        const found = await lstat(path).catch(() => undefined)
        if (found && found.nlink <= 1) size += found.size
      }
    }
  }
  return size
}

/** How many files `git status --porcelain=v1 -z` names: a rename or a copy is one, though it names two paths. */
function changedIn(printed: string): number {
  const fields = printed.split('\0')
  let count = 0
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index] ?? ''
    if (field.length < 4) continue
    count++
    if (field[0] === 'R' || field[0] === 'C') index++
  }
  return count
}

/**
 * What removing a work tree would lose, in words for the person; nothing when all it holds is committed on a branch.
 * Files not tracked are asked for whatever the person's settings say (`status.showUntrackedFiles=no`): git would
 * otherwise say nothing of files it was told to hide. Files git ignores are not counted: a build, an install.
 */
export async function holdsOf(root: string): Promise<string | undefined> {
  const status = await git(root, ['-c', 'status.showUntrackedFiles=all', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).then(text, () => undefined)
  if (status === undefined) return 'files that could not be checked: it is no longer a git worktree'
  const held: string[] = []
  const changed = changedIn(status)
  if (changed > 0) held.push(`${changed} ${changed === 1 ? 'file' : 'files'} changed and not committed`)
  const paths = await git(root, ['rev-parse', ...UNDER_WAY.flatMap(([name]) => ['--git-path', name])]).then(text, () => '')
  const lines = paths.split('\n')
  for (const [index, [, words]] of UNDER_WAY.entries()) {
    const path = lines[index]?.trim()
    if (path && !held.includes(words) && (await kindAt(resolve(root, path))) !== undefined) held.push(words)
  }
  // On no branch, commits that no branch holds would go with it.
  const detached = await git(root, ['symbolic-ref', '-q', 'HEAD']).then(
    () => false,
    () => true
  )
  if (detached && text(await git(root, ['rev-list', '--max-count=1', 'HEAD', '--not', '--branches', '--remotes']).catch(() => new Uint8Array())).trim() !== '')
    held.push('commits that no branch holds')
  return held.length > 0 ? held.join(', ') : undefined
}
