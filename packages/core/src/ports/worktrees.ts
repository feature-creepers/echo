import type { ThreadCopy } from '@repo/protocol'
import type { Signal } from './harness.ts'

/**
 * Copies of a repository for threads that work beside another (docs/SPEC.md, section 7.11): git worktrees, each on a
 * branch of its own, kept in the app's data. The adapter makes and removes them itself, with git: a session never
 * writes git's own files to do so.
 */
export interface Worktrees {
  /**
   * Where the work tree a folder is in starts, as the system names it, when its repository has a commit. Nothing
   * outside a repository, or in one with no commit: no copy is made there.
   */
  topOf(folder: string): Promise<string | undefined>
  /**
   * Make a copy for a thread that works in a folder: a branch named after `title`, started from the commit the
   * folder is on, checked out in a folder of the app's data. Changes not committed are not carried. Nothing when the
   * folder is in no repository with a commit. Rejects with the reason, in words for the thread, when it cannot be
   * made or was stopped: nothing is left of it then.
   */
  make(asked: { folder: string; title: string }, signal?: Signal): Promise<ThreadCopy | undefined>
  /**
   * Have a copy there again: nothing to do while it is, else it is checked out again from its branch, which stays
   * when a copy is removed. `folder` is the project's folder it is a copy of; `making` is called before a checkout.
   * Resolves with whether it was checked out again. Rejects with the reason when it cannot be, as when its branch
   * was deleted.
   */
  again(folder: string, copy: ThreadCopy, signal?: Signal, making?: () => void): Promise<boolean>
  /** How a copy stands: whether it is there, what removing it would lose, and whether its work was merged. */
  state(copy: ThreadCopy): Promise<CopyState>
  /**
   * The room a copy takes, or a folder no thread names, in bytes. Nothing when it holds more files than are counted.
   * It goes through every file: asked only when the person looks at the copies kept.
   */
  size(folder: string): Promise<number | undefined>
  /**
   * Remove a copy, or a folder no thread names, given a folder in it. Unless `anyway`, one that holds something that
   * would be lost is kept, and what it holds is said. Its branch is never deleted, and no link in it is followed.
   * Rejects with the reason when it cannot be removed, as while a program still works in it: nothing is changed then.
   */
  remove(folder: string, anyway: boolean): Promise<{ removed: true } | { removed: false; holds: string }>
  /**
   * The folders where copies are kept that no thread names, left by a making cut short or by a thread that is gone:
   * `named` are the folders the threads' copies are in. They are told, never removed by themselves.
   */
  orphans(named: readonly string[]): Promise<{ folder: string; holds?: string | undefined }[]>
}

/** How a thread's copy stands on the disk. */
export type CopyState =
  | { there: false }
  | {
      there: true
      /** What removing it would lose, in words for the person: "3 files changed and not committed". Left out when nothing would be. */
      holds?: string | undefined
      /** It committed something, and the branch it started from now holds all of it. */
      merged: boolean
    }
