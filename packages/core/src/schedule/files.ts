import { lastName } from '@repo/protocol'
import type { Timers } from '../ports/clock.ts'

/**
 * Jobs that ring when files arrive or change in a folder, rather than at a time (docs/SPEC.md, section 7.10): a
 * download finished, a scan, a report written by another program. The system reports a file being written many
 * times, and a browser writes a download under another name first, so what moved is looked at only once the folder
 * has been quiet a moment, and a file still being written, or one the system keeps for itself, is left out.
 */

/** How long a folder stays quiet before what moved in it is looked at: a file being written moves many times. */
export const SETTLE_MS = 3_000
/** The least time between two rings of one job: a burst of files is one ring, and what comes meanwhile waits for the next. */
export const FILES_GAP_MS = 60_000

/** Endings of files still being written: a browser's download under way, a copy, an editor's swap file. */
const PARTIAL_ENDINGS = ['.crdownload', '.part', '.partial', '.download', '.opdownload', '.tmp', '.temp', '.swp', '.lock']
/** Files a system writes in a folder for itself. */
const SYSTEM_NAMES = new Set(['.ds_store', 'desktop.ini', 'thumbs.db'])

/** Whether a file's name is one of a file still being written, or one the person never made: hidden, a lock, the system's own. */
export function isPartial(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('.') || lower.startsWith('~$') || SYSTEM_NAMES.has(lower) || PARTIAL_ENDINGS.some((ending) => lower.endsWith(ending))
}

const special = /[.+^${}()|[\]\\]/g

/** A pattern as a person writes it, "*.pdf" or "scan-??.jpg", as a regular expression for a whole name, case set aside. */
const patternOf = (glob: string) =>
  new RegExp(`^${[...glob].map((character) => (character === '*' ? '.*' : character === '?' ? '.' : character.replace(special, '\\$&'))).join('')}$`, 'i')

/** Whether a file's name matches a pattern, or one of several separated by commas. Every name matches no pattern. */
export function matchesPattern(name: string, pattern: string | undefined): boolean {
  const patterns = (pattern ?? '')
    .split(/[,;]/)
    .map((one) => one.trim())
    .filter(Boolean)
  return patterns.length === 0 || patterns.some((one) => patternOf(one).test(name))
}

/** A job that rings on files, as the watch needs it. */
export interface WatchedJob {
  job: string
  folder: string
  pattern?: string | undefined
}

/** What the computer gives to watch folders: the core's port, and the person's grant. */
export interface Watching {
  watch(folder: string, changed: (paths: readonly string[]) => void): () => void
  fileAt(path: string): Promise<{ size: number } | undefined>
  /** Whether the person still lets the assistant read the folder: one no longer granted rings no more. */
  reaches(folder: string): boolean
}

interface FileWatchOptions extends Watching {
  timers: Timers
  /** The time now, in milliseconds since 1970. */
  now: () => number
  /** Files arrived or changed for a job, and their writing is over: the job rings. */
  ring(job: string, paths: readonly string[]): void
  /** A folder could not be watched: it is tried again at the next change of the jobs. */
  problem(message: string): void
}

interface FileWatch {
  /** The jobs to watch for now: a watch starts for each new one, and stops for each gone, or whose folder or pattern changed. */
  follow(jobs: readonly WatchedJob[]): void
  close(): void
}

interface Watched {
  job: WatchedJob
  stop: () => void
  /** The paths that moved since the job last looked. */
  moved: Set<string>
  /** Stops the wait for the folder to be quiet. */
  cancel: () => void
  rang: number | undefined
}

export function createFileWatch(options: FileWatchOptions): FileWatch {
  const watched = new Map<string, Watched>()
  const same = (one: WatchedJob, other: WatchedJob) => one.folder === other.folder && one.pattern === other.pattern
  const current = (entry: Watched) => watched.get(entry.job.job) === entry

  const look = async (entry: Watched) => {
    const paths = [...entry.moved].sort()
    entry.moved.clear()
    if (!current(entry) || !options.reaches(entry.job.folder)) return
    // What left the folder, or became a folder, is not a file that arrived.
    const found = await Promise.all(paths.map(async (path) => ((await options.fileAt(path).catch(() => undefined)) ? path : undefined)))
    const files = found.filter((path): path is string => path !== undefined)
    if (!current(entry) || files.length === 0) return
    entry.rang = options.now()
    options.ring(entry.job.job, files)
  }

  /** Wait for the folder to be quiet, and for the gap since the job last rang. */
  const settle = (entry: Watched) => {
    entry.cancel()
    const gap = entry.rang === undefined ? 0 : entry.rang + FILES_GAP_MS - options.now()
    entry.cancel = options.timers.after(Math.max(SETTLE_MS, gap), () => void look(entry))
  }

  const stop = (entry: Watched) => {
    entry.stop()
    entry.cancel()
    watched.delete(entry.job.job)
  }

  return {
    follow(jobs) {
      const wanted = new Map(jobs.map((job) => [job.job, job]))
      for (const entry of [...watched.values()]) {
        const job = wanted.get(entry.job.job)
        if (!job || !same(job, entry.job)) stop(entry)
      }
      for (const job of jobs) {
        if (watched.has(job.job)) continue
        const entry: Watched = { job, stop: () => {}, moved: new Set(), cancel: () => {}, rang: undefined }
        try {
          entry.stop = options.watch(job.folder, (paths) => {
            for (const path of paths) {
              const name = lastName(path)
              if (!isPartial(name) && matchesPattern(name, job.pattern)) entry.moved.add(path)
            }
            if (entry.moved.size > 0 && current(entry)) settle(entry)
          })
        } catch (error) {
          options.problem(`The folder ${job.folder} could not be watched: ${error instanceof Error ? error.message : String(error)}`)
          continue
        }
        watched.set(job.job, entry)
      }
    },
    close() {
      for (const entry of [...watched.values()]) stop(entry)
    }
  }
}
