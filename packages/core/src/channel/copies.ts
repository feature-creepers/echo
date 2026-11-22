import { IDLE_ARCHIVES_MS, type KeptCopy, type Thread } from '@repo/protocol'
import type { Signal } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import type { Worktrees } from '../ports/worktrees.ts'
import { partsFrom } from '../projects/folders.ts'
import type { ThreadRegistry } from '../threads/registry.ts'

/** The name the making of a copy is kept under, among the steps of the request it was made for. */
export const COPY_STEP = 'copy_prepare'

export interface CopiesOptions {
  registry: ThreadRegistry
  /** Where copies are made. Left out, there is none: every thread works in its project's own folder. */
  worktrees: Worktrees | undefined
  log: Log
  now: () => Date
  /**
   * End the sessions that work in a thread's copy, its own and its sub-threads', so that its folder can be removed.
   * False, and nothing is ended, while one of them is at work.
   */
  release(thread: string): boolean
}

/**
 * The copies of a repository that threads work in (docs/SPEC.md, section 7.11). A project's thread gets one when it
 * opens in a work tree where another thread is at work, or when the person asked for one; it keeps it from then on,
 * and it is made again from its branch when it was removed. A sub-thread works where its thread does. A copy is
 * removed by itself only when nothing in it would be lost, and its branch never is.
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
  /**
   * A thread has nothing left to answer, or was put away: its copy is removed when nothing in it would be lost, once
   * its work was merged, or once the thread is put away or was left alone for a week.
   */
  settle(thread: string): Promise<void>
  /** The copies kept: each thread's that is there, the thread used last first, then the folders no thread names. */
  kept(): Promise<KeptCopy[]>
  /**
   * Remove a copy as the person asked, by its folder as `kept` gave it. One that holds something that would be lost
   * is kept unless `anyway`, and what it holds is said; `problem` says why it could not be removed.
   */
  remove(folder: string, anyway: boolean): Promise<{ removed: boolean; holds?: string; problem?: string }>
}

/** Why something could not be done with a copy, as a sentence: the first line of what was said. */
const reasonOf = (error: unknown) => {
  const said = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim() ?? ''
  return /[.!?]$/.test(said) ? said : `${said}.`
}

export function createCopies({ registry, worktrees, log, now, release }: CopiesOptions): Copies {
  /** Threads just opened in a project's folder: whether a copy was asked for, and where the others were at work then. */
  const pending = new Map<string, { asked: boolean; others: string[] }>()
  /** What is under way for each thread's copy: it is made, made again or removed one thing at a time. */
  const lines = new Map<string, Promise<unknown>>()
  const inTurn = <Result>(thread: string, work: () => Promise<Result>): Promise<Result> => {
    const done = (lines.get(thread) ?? Promise.resolve()).then(work)
    lines.set(
      thread,
      done.catch(() => undefined)
    )
    return done
  }

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

  /** The threads that have a copy, the one used last first. */
  const copied = () => registry.read().threads.flatMap((thread) => (thread.copy && thread.folder !== undefined ? [{ ...thread, copy: thread.copy }] : []))

  const prepare = async (id: string, signal: Signal, making: () => void, trees: Worktrees): Promise<string | undefined> => {
    const thread = registry.get(id)
    const wish = pending.get(id)
    pending.delete(id)
    if (thread?.kind !== 'topic' || thread.folder === undefined) return undefined
    const { folder, copy } = thread

    if (copy) {
      try {
        const again = await trees.again(folder, copy, signal, making)
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
    const top = await trees.topOf(folder).catch(() => undefined)
    if (top === undefined)
      return wish.asked
        ? `(No copy of the project could be made for you: ${folder} is not in a git repository with a commit. You work in the folder itself. Tell the person in a sentence.)`
        : undefined
    if (!wish.asked && !(await anyIn(top, wish.others, trees))) return undefined
    making()
    try {
      const made = await trees.make({ folder, title: thread.title }, signal)
      if (made) registry.copy(id, made)
      return undefined
    } catch (error) {
      if (signal.aborted) return undefined
      return `(No copy of the project could be made for you: ${reasonOf(error)} You work in the project's own folder, ${folder}, where another thread may be at work: call threads_beside before you change anything. Tell the person in a sentence.)`
    }
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
      // A thread that works on no project has nothing to wait for.
      if (!worktrees || registry.get(id)?.folder === undefined) return undefined
      return inTurn(id, () => prepare(id, signal, making, worktrees))
    },

    async settle(id) {
      if (!worktrees || !registry.get(id)?.copy) return
      await inTurn(id, async () => {
        const thread = registry.get(id)
        if (!thread?.copy) return
        const left = thread.archived === true || now().getTime() - new Date(thread.at).getTime() > IDLE_ARCHIVES_MS
        const state = await worktrees.state(thread.copy).catch(() => undefined)
        if (!state?.there || state.holds !== undefined || !(state.merged || left)) return
        // Its thread may have started on a request since: a copy in use is never removed.
        if (!release(id)) return
        await worktrees
          .remove(thread.copy.folder, false)
          .catch((error: unknown) => log.error(`The copy ${thread.copy?.folder} could not be removed: ${reasonOf(error)}`))
      })
    },

    async kept() {
      if (!worktrees) return []
      const threads = copied()
      const found: KeptCopy[] = []
      for (const thread of threads) {
        const state = await worktrees.state(thread.copy).catch(() => undefined)
        if (!state?.there) continue
        found.push({
          folder: thread.copy.folder,
          thread: { id: thread.id, title: thread.title, project: thread.folder as string, branch: thread.copy.branch },
          ...(state.holds === undefined ? {} : { holds: state.holds })
        })
      }
      for (const { folder, holds } of await worktrees.orphans(threads.map((thread) => thread.copy.folder)).catch(() => []))
        found.push({ folder, ...(holds === undefined ? {} : { holds }) })
      // The room each takes is counted last, file by file: only here, where the person looks at them.
      return Promise.all(
        found.map(async (copy) => {
          const size = await worktrees.size(copy.folder).catch(() => undefined)
          return size === undefined ? copy : { ...copy, size }
        })
      )
    },

    async remove(folder, anyway) {
      if (!worktrees) return { removed: false, problem: 'No copies are kept here.' }
      const threads = copied()
      const thread = threads.find((one) => one.copy.folder === folder)
      const removal = async () => {
        if (thread && !release(thread.id)) return { removed: false, problem: `“${thread.title}” is at work in it. Stop it first.` }
        return worktrees.remove(folder, anyway).catch((error: unknown) => ({ removed: false, problem: reasonOf(error) }))
      }
      if (thread) return inTurn(thread.id, removal)
      // Only what was listed is removed: a folder no thread names, never a folder inside a thread's copy.
      const orphans = await worktrees.orphans(threads.map((one) => one.copy.folder)).catch(() => [])
      return orphans.some((one) => one.folder === folder) ? removal() : { removed: false, problem: 'There is no such copy.' }
    }
  }
}
