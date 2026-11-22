import { createHash } from 'node:crypto'
import { mkdir, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { Signal, Worktrees } from '@repo/core'
import { git, text } from './git.ts'
import { kindAt, within } from './paths.ts'

/**
 * Copies of a repository for threads that work beside another (docs/SPEC.md, section 7.11), as git worktrees kept in
 * one folder of the app's data: `<repository's name>/<start of the branch's name>-<16 hex>`. Each has a branch of its
 * own, made first, so that removing a copy never loses what was committed in it.
 */

/** How long a branch's name is after `echo/`, in characters, at most. */
const SLUG_LIMIT = 48
/** How much of a branch's name starts its copy's folder, in bytes: short, to leave room for long file paths on Windows. */
const PREFIX_BYTES = 23
/** How many names are tried for a branch or a folder that is taken. */
const TRIES = 50

/** A thread's title as the end of a branch's name: its letters and digits in small letters, "-" between its words. */
export function branchSlug(title: string): string {
  const words = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
  const cut = [...words]
    .slice(0, SLUG_LIMIT)
    .join('')
    .replace(/^-+|-+$/g, '')
  return cut === '' ? 'work' : cut
}

/** The start of a text that fits a number of bytes, whole characters only. */
function startOf(value: string, bytes: number): string {
  let kept = ''
  for (const character of value) {
    if (Buffer.byteLength(kept + character) > bytes) break
    kept += character
  }
  return kept
}

/** The work tree a folder is in, by where it starts as the folder was named, and the commit it is on. */
async function repository(folder: string): Promise<{ top: string; commit: string } | undefined> {
  const said = await git(folder, ['rev-parse', '--is-inside-work-tree', '--show-cdup']).then(text, () => undefined)
  const [inside, up = ''] = said?.split('\n') ?? []
  if (inside?.trim() !== 'true') return undefined
  const top = resolve(folder, up.trim())
  const commit = await git(top, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']).then(
    (printed) => text(printed).trim(),
    () => ''
  )
  return commit === '' ? undefined : { top, commit }
}

const hasBranch = (top: string, branch: string) =>
  git(top, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false
  )

/**
 * Take a copy's folder away, and what git records of it. The folder is removed by Node, which unlinks a link without
 * following it: Git for Windows before 2.54 follows a junction and deletes what it leads to, and a `node_modules` made
 * by pnpm is made of junctions. A copy stopped while it was made is still locked, hence the forced removal of its record.
 */
async function discard(top: string, root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await git(top, ['worktree', 'remove', '--force', '--force', '--', root]).catch(() => undefined)
  await git(top, ['worktree', 'prune']).catch(() => undefined)
}

/** The copies kept in `folder`, a folder of the app's data made when the first copy is. */
export function createWorktrees({ folder: kept }: { folder: string }): Worktrees {
  /** Where a copy starts, from a folder inside it: copies are two folders deep. */
  const rootOf = (folder: string): string | undefined => {
    const [repositoryName, name] = relative(kept, folder).split(sep)
    return within(folder, kept) && repositoryName && name ? join(kept, repositoryName, name) : undefined
  }

  /**
   * Check a branch out in a new folder. It has no time limit: a deadline would stop a large checkout half-way. A stop
   * ends it; on macOS and Linux only once the checkout git started has ended, which nothing is left of either way.
   */
  const checkOut = async (top: string, root: string, branch: string, signal: Signal | undefined) => {
    await mkdir(dirname(root), { recursive: true })
    try {
      await git(top, ['worktree', 'add', '--', root, branch], { timeout: null, signal })
      if (signal?.aborted) throw new Error('It was stopped.')
    } catch (error) {
      await discard(top, root)
      throw signal?.aborted ? new Error('It was stopped.') : error
    }
  }

  return {
    topOf: async (folder) => (await repository(folder))?.top,

    async make({ folder, title }, signal) {
      const found = await repository(folder)
      if (!found) return undefined
      const { top, commit } = found
      const startBranch = await git(top, ['symbolic-ref', '-q', '--short', 'HEAD']).then(
        (printed) => text(printed).trim(),
        () => ''
      )
      const common = resolve(top, text(await git(top, ['rev-parse', '--git-common-dir'])).trim())

      const slug = branchSlug(title)
      let branch: string | undefined
      for (let count = 1; branch === undefined; count++) {
        if (count > TRIES) throw new Error(`Every branch name like echo/${slug} is taken.`)
        const name = count === 1 ? `echo/${slug}` : `echo/${slug}-${count}`
        if (await hasBranch(top, name)) continue
        try {
          await git(top, ['branch', '--no-track', '--', name, commit])
          branch = name
        } catch (error) {
          // Another copy made at the same moment took the name: the next one is tried.
          if (!(await hasBranch(top, name))) throw error
        }
      }

      // The repository's git folder and the branch tell two copies apart, whatever their repositories are named.
      const hash = createHash('sha256').update(`${common}\0${branch}`).digest('hex').slice(0, 16)
      const base = join(kept, basename(top) || 'repository', `${startOf(branch.replaceAll('/', '-'), PREFIX_BYTES)}-${hash}`)
      let root = base
      for (let count = 2; (await kindAt(root)) !== undefined && count <= TRIES; count++) root = `${base}-${count}`

      try {
        await checkOut(top, root, branch, signal)
        const place = join(root, relative(top, folder))
        if ((await kindAt(place)) !== 'folder') {
          await discard(top, root)
          throw new Error(`${folder} is not in the commit the project is on: it was never committed.`)
        }
        return { folder: place, branch, start: { commit, ...(startBranch === '' ? {} : { branch: startBranch }) } }
      } catch (error) {
        // Nothing is left behind: the branch just made holds nothing of its own.
        await git(top, ['branch', '-D', '--', branch]).catch(() => undefined)
        throw error
      }
    },

    async again(folder, copy, signal, making) {
      const root = rootOf(copy.folder)
      if (root === undefined) throw new Error(`${copy.folder} is not where copies are kept.`)
      if ((await kindAt(join(root, '.git'))) !== undefined) {
        if ((await kindAt(copy.folder)) === 'folder') return false
        throw new Error(`${copy.folder} is no longer there on the branch ${copy.branch}.`)
      }
      const top = (await repository(folder))?.top
      if (top === undefined) throw new Error(`${folder} is no longer in a git repository.`)
      if (!(await hasBranch(top, copy.branch))) throw new Error(`Its branch, ${copy.branch}, was deleted.`)
      // An empty folder left there gives way; one that holds files is not a copy any more, and is left alone.
      if (
        (await kindAt(root)) !== undefined &&
        (await rmdir(root).then(
          () => false,
          () => true
        ))
      )
        throw new Error(`${root} holds files, and is no longer a copy of the project.`)
      // What git still records of a copy whose folder is gone is dropped first, or it would refuse to make it again.
      await git(top, ['worktree', 'prune'])
      making?.()
      await checkOut(top, root, copy.branch, signal)
      if ((await kindAt(copy.folder)) !== 'folder') throw new Error(`${copy.folder} is no longer there on the branch ${copy.branch}.`)
      return true
    }
  }
}
