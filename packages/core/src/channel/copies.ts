import type { Thread } from '@repo/protocol'
import type { Signal } from '../ports/harness.ts'
import type { Worktrees } from '../ports/worktrees.ts'
import { partsFrom } from '../projects/folders.ts'
import type { ThreadRegistry } from '../threads/registry.ts'

/** The name the making of a copy is kept under, among the steps of the request it was made for. */
export const COPY_STEP = 'copy_prepare'

export interface CopiesOptions {
  registry: ThreadRegistry
  /** Where copies are made. Left out, there is none: every thread works in its project's own folder. */
  worktrees: Worktrees | undefined
}

/**
 * The copies of a repository that threads work in (docs/SPEC.md, section 7.11). A project's thread gets one when it
 * opens in a work tree where another thread is at work, or when the person asked for one; it keeps it from then on,
 * and it is made again from its branch when it was removed. A sub-thread works where its thread does.
 */
export interface Copies {
  /** A project's thread was just opened, and whether a copy was asked for it: settled when its first request starts. */
  opened(thread: string, asked: boolean): void
  /** Where a thread works: its copy when it has one, its thread's for a sub-thread, else its project's folder. */
  placeOf(thread: Thread): string | undefined
  /** The copy a thread works in, its own or its thread's, and the project's folder it is a copy of. */
  copyOf(thread: string): { folder: string; project: string } | undefined
  /**
   * Before a thread starts on a request: its copy is made when it is to have one, or made again when it is gone.
   * `making` is called when that takes a checkout. Gives what the thread is told with its request, if anything: that
   * its copy was checked out again, or why it has none and works in the project's folder.
   */
  prepare(thread: string, signal: Signal, making: () => void): Promise<string | undefined>
}

/** Why a copy could not be had, as a sentence: the first line of what was said. */
const reasonOf = (error: unknown) => {
  const said = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim() ?? ''
  return /[.!?]$/.test(said) ? said : `${said}.`
}

export function createCopies({ registry, worktrees }: CopiesOptions): Copies {
  /** Threads just opened in a project's folder: whether a copy was asked for, and where the others were at work then. */
  const pending = new Map<string, { asked: boolean; others: string[] }>()

  /** The thread whose copy a thread works in: itself, or for a sub-thread left in its thread's folder, that thread. */
  const holderOf = (thread: Thread): Thread | undefined => {
    if (thread.copy) return thread
    const owner = thread.kind === 'subthread' && thread.parent !== undefined ? registry.get(thread.parent) : undefined
    return owner?.copy !== undefined && owner.folder === thread.folder ? owner : undefined
  }

  const placeOf = (thread: Thread) => holderOf(thread)?.copy?.folder ?? thread.folder

  /** Whether one of some folders is in a work tree. */
  const anyIn = async (top: string, folders: readonly string[], trees: Worktrees) => {
    for (const folder of folders) {
      const other = await trees.topOf(folder).catch(() => undefined)
      if (other !== undefined && partsFrom(top, other)?.length === 0) return true
    }
    return false
  }

  return {
    opened(id, asked) {
      const thread = registry.get(id)
      if (thread?.kind !== 'topic' || thread.folder === undefined) return
      const others = registry
        .read()
        .threads.filter((other) => other.id !== id && other.state === 'working')
        .flatMap((other) => placeOf(other) ?? [])
      pending.set(id, { asked, others })
    },

    placeOf,

    copyOf(id) {
      const thread = registry.get(id)
      const holder = thread && holderOf(thread)
      return holder?.copy && holder.folder !== undefined ? { folder: holder.copy.folder, project: holder.folder } : undefined
    },

    async prepare(id, signal, making) {
      const thread = registry.get(id)
      const wish = pending.get(id)
      pending.delete(id)
      if (!worktrees || thread?.kind !== 'topic' || thread.folder === undefined) return undefined
      const { folder, copy } = thread

      if (copy) {
        try {
          const again = await worktrees.again(folder, copy, signal, making)
          return again
            ? `(Your copy of the project was removed since you last worked in it, and was just checked out again from your branch, ${copy.branch}: what you committed is there; what git ignores, such as installed dependencies, is not.)`
            : undefined
        } catch (error) {
          if (signal.aborted) return undefined
          registry.copy(id, undefined)
          return `(Your copy of the project could not be had again: ${reasonOf(error)} From now on you work in the project's own folder, ${folder}; what you committed in the copy is on the branch ${copy.branch}. Tell the person in a sentence.)`
        }
      }

      if (!wish) return undefined
      const top = await worktrees.topOf(folder).catch(() => undefined)
      if (top === undefined)
        return wish.asked
          ? `(No copy of the project could be made for you: ${folder} is not in a git repository with a commit. You work in the folder itself. Tell the person in a sentence.)`
          : undefined
      if (!wish.asked && !(await anyIn(top, wish.others, worktrees))) return undefined
      making()
      try {
        const made = await worktrees.make({ folder, title: thread.title }, signal)
        if (made) registry.copy(id, made)
        return undefined
      } catch (error) {
        if (signal.aborted) return undefined
        return `(No copy of the project could be made for you: ${reasonOf(error)} You work in the project's own folder, ${folder}, where another thread may be at work: call threads_beside before you change anything. Tell the person in a sentence.)`
      }
    }
  }
}
