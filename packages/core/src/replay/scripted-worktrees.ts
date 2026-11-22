import type { Worktrees } from '../ports/worktrees.ts'
import { folderName, inFolder, partsFrom } from '../projects/folders.ts'

/** Copies of repositories kept in memory, for tests: made, removed and made again as a test says. */
export interface ScriptedWorktrees extends Worktrees {
  /** The folders there now: the copies, and those no thread names. */
  there(): string[]
  /** Take a copy's folder away behind the core's back, as the person may: its branch stays. */
  takeAway(folder: string): void
  /** Delete a copy's branch, as the person may. */
  deleteBranch(branch: string): void
  /** Have a copy hold something that removing it would lose, or nothing any more. */
  hold(folder: string, holds: string | undefined): void
  /** Have the branch a copy started from hold all it committed. */
  merge(folder: string): void
  /** Have a program work in a copy, or no longer: it cannot be removed meanwhile. */
  use(folder: string, used: boolean): void
  /** Leave a folder there that no thread names. */
  leave(folder: string): void
  /** Have the next copy fail to be made, with this reason. */
  failNext(reason: string): void
  /** Hold the next copy until the function given back is called: the time a checkout takes. */
  holdNext(): () => void
}

/** The commit every scripted repository is on. */
export const SCRIPTED_COMMIT = 'c0ffee1234567890c0ffee1234567890c0ffee12'
/** The room every scripted copy takes, in bytes. */
export const SCRIPTED_SIZE = 2_000_000

/** Copies kept under `kept`, for the repositories that start at the folders given, each on `main`. */
export function scriptedWorktrees(repositories: readonly string[], kept = '/data/worktrees'): ScriptedWorktrees {
  const roots = new Set<string>()
  const branches = new Set<string>()
  const holding = new Map<string, string>()
  const merged = new Set<string>()
  const used = new Set<string>()
  let failing: string | undefined
  let held: Promise<void> | undefined

  const topOf = (folder: string) => [...repositories, ...roots].find((top) => partsFrom(top, folder) !== undefined)
  /** Where a copy starts, from a folder inside it: copies are two folders deep. */
  const rootOf = (folder: string) => {
    const [repository, name] = partsFrom(kept, folder) ?? []
    return repository && name ? inFolder(inFolder(kept, repository), name) : undefined
  }
  const standing = (root: string) => (holding.has(root) ? { holds: holding.get(root) as string } : {})
  const checkOut = async (signal: Parameters<Worktrees['make']>[1]) => {
    const waiting = held
    held = undefined
    await waiting
    if (signal?.aborted) throw new Error('It was stopped.')
  }

  return {
    topOf: async (folder) => topOf(folder),

    async make({ folder, title }, signal) {
      const top = repositories.find((one) => partsFrom(one, folder) !== undefined)
      if (top === undefined) return undefined
      const reason = failing
      failing = undefined
      await checkOut(signal)
      if (reason !== undefined) throw new Error(reason)
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      let branch = `echo/${slug}`
      for (let count = 2; branches.has(branch); count++) branch = `echo/${slug}-${count}`
      branches.add(branch)
      const root = inFolder(inFolder(kept, folderName(top)), branch.replace('/', '-'))
      roots.add(root)
      const inside = partsFrom(top, folder) ?? []
      return { folder: inside.reduce(inFolder, root), branch, start: { commit: SCRIPTED_COMMIT, branch: 'main' } }
    },

    async again(_folder, copy, signal, making) {
      const root = rootOf(copy.folder)
      if (root === undefined) throw new Error(`${copy.folder} is not where copies are kept.`)
      if (roots.has(root)) return false
      if (!branches.has(copy.branch)) throw new Error(`Its branch, ${copy.branch}, was deleted.`)
      making?.()
      await checkOut(signal)
      roots.add(root)
      return true
    },

    async state(copy) {
      const root = rootOf(copy.folder)
      return root !== undefined && roots.has(root) ? { there: true, merged: merged.has(root), ...standing(root) } : { there: false }
    },

    size: async (folder) => (roots.has(rootOf(folder) ?? folder) ? SCRIPTED_SIZE : undefined),

    async remove(folder, anyway) {
      const root = rootOf(folder) ?? folder
      if (!roots.has(root)) return { removed: true }
      const holds = holding.get(root)
      if (!anyway && holds !== undefined) return { removed: false, holds }
      if (used.has(root)) throw new Error('A program still works in it. Close it, or stop the thread, and try again.')
      roots.delete(root)
      holding.delete(root)
      merged.delete(root)
      return { removed: true }
    },

    orphans: async (named) =>
      [...roots].filter((root) => !named.some((folder) => partsFrom(root, folder) !== undefined)).map((root) => ({ folder: root, ...standing(root) })),

    there: () => [...roots],
    takeAway: (folder) => void roots.delete(rootOf(folder) ?? folder),
    deleteBranch: (branch) => void branches.delete(branch),
    hold: (folder, holds) => void (holds === undefined ? holding.delete(rootOf(folder) ?? folder) : holding.set(rootOf(folder) ?? folder, holds)),
    merge: (folder) => void merged.add(rootOf(folder) ?? folder),
    use: (folder, working) => void (working ? used.add(rootOf(folder) ?? folder) : used.delete(rootOf(folder) ?? folder)),
    leave: (folder) => void roots.add(folder),
    failNext: (reason) => {
      failing = reason
    },
    holdNext() {
      let release: () => void = () => undefined
      held = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    }
  }
}
