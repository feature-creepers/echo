import { type FSWatcher, type Stats, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { within } from './paths.ts'

/**
 * The places a command may change, watched while it runs (docs/SPEC.md, section 12.2): a program works out paths its
 * line does not name, a script's output or a tool's settings, and nobody can tell them before it runs. The system
 * says which paths changed; what was at each when it first said so is noted at once, so that a file there before the
 * command can be told later from one it made and took away again.
 *
 * When changes come faster than the system can tell them, it says only that something changed (Windows' buffer of
 * changes overflows on a burst of writes): the place is then looked through once the command ended, for the files
 * written since it started. A file deleted meanwhile is not found that way.
 */

/** The most paths noted while one command runs: past them, a build's or an install's, the rest are not. */
export const NOTED_LIMIT = 1000
/** The most folders watched one by one, where the system watches no tree at once (Linux): past them, the rest are not. */
export const FOLDERS_LIMIT = 2000
/** The most files noted in a folder made while the command runs, before it could be watched. */
const MADE_LIMIT = 200
/** The most entries looked through in a place the system lost count of. */
const LOOKED_LIMIT = 20_000
/** The slack on when a file was written, which some file systems keep to two seconds. */
const WRITTEN_SLACK_MS = 2000

/** A path the system said changed, and what was there when it first said so: nothing, when it was already gone. */
export interface Noted {
  path: string
  first: Stats | undefined
}

export interface Watching {
  /** Stop watching, and give the paths noted, each once, in the order they were first told. */
  stop(): Promise<Noted[]>
}

export interface WatchOptions {
  /** Whether the system watches a folder with all its subfolders at once; else each folder is watched on its own. */
  trees: boolean
  /** Whether a folder is passed over with all it holds: what programs install and build, apps' own data. */
  passed(folder: string, name: string): boolean
  /** Whether a path that changed is left out: a place never reached, or one looked at another way. */
  ignored(path: string): boolean
}

/** Whether a path inside a place lies under a folder passed over, between the place and it. */
function passedOnTheWay(place: string, path: string, passed: WatchOptions['passed']): boolean {
  const parts = relative(place, path).split(sep)
  let folder = place
  for (const name of parts.slice(0, -1)) {
    if (passed(folder, name)) return true
    folder = join(folder, name)
  }
  return false
}

/**
 * Watch places, each a folder with what it holds or a file alone, until stopped. A place inside another one watched
 * is not watched again. What cannot be watched (gone, not readable) is passed over.
 */
export async function watchPlaces(places: readonly string[], options: WatchOptions): Promise<Watching> {
  const started = Date.now()
  const watchers: FSWatcher[] = []
  const noted = new Map<string, Promise<Stats | undefined>>()
  /** The folders whose changes the system lost count of, and whether their subfolders were watched with them. */
  const lost = new Map<string, boolean>()
  let stopped = false
  let folders = 0

  const note = (path: string) => {
    if (stopped || noted.has(path) || noted.size >= NOTED_LIMIT || options.ignored(path)) return
    noted.set(
      path,
      stat(path).catch(() => undefined)
    )
  }

  const start = (
    folder: string,
    recursive: boolean,
    told: (name: string) => void,
    losing: () => void = () => {
      lost.set(folder, recursive || lost.get(folder) === true)
    }
  ) => {
    try {
      const watcher = watch(folder, { persistent: false, recursive }, (_event, name) => {
        // No name: the system lost count of what changed there.
        if (name) told(name.toString())
        else if (!stopped) losing()
      })
      // A folder removed or no longer readable ends its watch.
      watcher.on('error', () => watcher.close())
      watchers.push(watcher)
    } catch {
      // A folder that cannot be watched is passed over: what changes there is not found.
    }
  }

  /** The files a folder holds, noted: it was made while the command ran, and filled before it could be watched. */
  const noteMade = async (folder: string, budget = { left: MADE_LIMIT }) => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (budget.left <= 0) return
      const path = join(folder, entry.name)
      if (entry.isFile()) {
        budget.left--
        note(path)
      } else if (entry.isDirectory() && !options.passed(folder, entry.name)) await noteMade(path, budget)
    }
  }

  /** A folder and its subfolders, each watched on its own, those made while the command runs as they come. */
  const walk = async (folder: string) => {
    if (stopped || folders >= FOLDERS_LIMIT) return
    folders++
    start(folder, false, (name) => {
      const path = join(folder, name)
      note(path)
      if (options.passed(folder, name)) return
      void stat(path)
        .then(async (found) => {
          if (!found?.isDirectory() || stopped) return
          await noteMade(path)
          await walk(path)
        })
        .catch(() => undefined)
    })
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !options.passed(folder, entry.name)) await walk(join(folder, entry.name))
    }
  }

  const outermost = places.filter((place, index) => !places.some((other, at) => at !== index && other !== place && within(place, other)))
  for (const place of [...new Set(outermost)]) {
    const found = await stat(place).catch(() => undefined)
    if (found?.isFile()) {
      // A file granted alone: its folder is watched for it, and only it.
      const folder = dirname(place)
      start(
        folder,
        false,
        (name) => {
          if (join(folder, name) === place) note(place)
        },
        () => note(place)
      )
    } else if (found?.isDirectory()) {
      if (options.trees) {
        start(place, true, (name) => {
          const path = join(place, name)
          if (!passedOnTheWay(place, path, options.passed)) note(path)
        })
      } else await walk(place)
    }
  }

  /** The files of a folder written since the watching started, noted, its subfolders' too when `deep`. */
  const lookThrough = async (folder: string, deep: boolean, budget = { left: LOOKED_LIMIT }) => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (budget.left-- <= 0 || noted.size >= NOTED_LIMIT) return
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        if (deep && !options.passed(folder, entry.name)) await lookThrough(path, deep, budget)
      } else if (entry.isFile()) {
        const found = await stat(path).catch(() => undefined)
        if (found && Math.max(found.mtimeMs, found.ctimeMs) >= started - WRITTEN_SLACK_MS) note(path)
      }
    }
  }

  return {
    async stop() {
      if (!stopped) {
        for (const watcher of watchers) watcher.close()
        for (const [folder, deep] of lost) await lookThrough(folder, deep)
      }
      stopped = true
      const told: Noted[] = []
      for (const [path, first] of noted) told.push({ path, first: await first })
      return told
    }
  }
}
