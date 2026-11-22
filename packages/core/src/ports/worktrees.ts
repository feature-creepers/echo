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
}
