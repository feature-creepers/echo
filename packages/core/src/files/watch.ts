import type { Timers } from '../ports/clock.ts'

/**
 * The folders the person browses in the assistant's folder, watched so the Files page notices what changes there
 * whoever changed it: a command, another app, the person (docs/SPEC.md, section 9.7). Only the folders listed last
 * are watched, each by itself and not inside its subfolders, so a folder holding thousands of folders, such as a
 * project's dependencies, costs no more than the few the page shows.
 */

/** How many folders are watched at most: the ones the person listed last. */
export const WATCHED_FOLDERS = 32
/** How long changes are gathered before they are told, in milliseconds: a command writes many files at once. */
export const GATHER_MS = 300
/** How many paths one telling names at most: the page reads its open folders again whichever paths it names. */
export const PATHS_TOLD = 100

interface FolderWatchOptions {
  /** Watch one folder of the computer, not its subfolders: the computer port's. Throws when it cannot. */
  watch(folder: string, changed: (paths: readonly string[]) => void): () => void
  /** The path in the assistant's folder of a place on the computer, when it is inside the folder. */
  pathOf(location: string): string | undefined
  /** Left out, each change is told at once. */
  timers?: Timers | undefined
  /** Something changed in the folders the person browses: its paths in the assistant's folder. */
  changed(paths: string[]): void
}

interface FolderWatch {
  /** A folder the person just listed, by where it is on the computer: watched from now, as one of the latest. */
  follow(location: string): void
  close(): void
}

export function createFolderWatch(options: FolderWatchOptions): FolderWatch {
  // In the order they were listed, the latest last: the first is the one given up when there are too many.
  const watched = new Map<string, () => void>()
  let gathered = new Set<string>()
  let cancel: (() => void) | undefined
  let closed = false

  const tell = () => {
    cancel = undefined
    const paths = [...gathered].slice(0, PATHS_TOLD)
    gathered = new Set()
    if (paths.length > 0) options.changed(paths)
  }

  const moved = (locations: readonly string[]) => {
    if (closed) return
    for (const location of locations) {
      const path = options.pathOf(location)
      if (path !== undefined) gathered.add(path)
    }
    if (gathered.size === 0) return
    if (!options.timers) return tell()
    cancel ??= options.timers.after(GATHER_MS, tell)
  }

  return {
    follow(location) {
      if (closed) return
      const stop = watched.get(location)
      watched.delete(location)
      if (stop) {
        watched.set(location, stop)
        return
      }
      try {
        watched.set(location, options.watch(location, moved))
      } catch {
        // A folder that cannot be watched is read again when the page comes back to the front.
        return
      }
      for (const [oldest, stopOldest] of watched) {
        if (watched.size <= WATCHED_FOLDERS) break
        watched.delete(oldest)
        stopOldest()
      }
    },
    close() {
      closed = true
      cancel?.()
      for (const stop of watched.values()) stop()
      watched.clear()
    }
  }
}
