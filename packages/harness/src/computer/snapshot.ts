import { readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Changeable, FolderSnapshot, FoundChange, NamedPlace } from '@repo/core'
import { git, text } from './git.ts'
import { within } from './paths.ts'
import { system } from './system/index.ts'
import { type Noted, watchPlaces } from './watching.ts'

/**
 * What a command changed in the folder it ran in (docs/SPEC.md, section 12.2), found by looking before it runs and
 * again once it ended, since nobody can tell which files a command will touch. In a git work tree, git says which
 * files differ, and what a file clean before held is git's own copy, so only the files already changed are read
 * first. Elsewhere, the folder's files are listed with their sizes and times, and the small ones are held, so what a
 * file held before can be shown; a larger one is named as changed.
 *
 * The places a command names outside its folder are looked at the same way, so a copy to another folder or a file
 * written elsewhere is found too: a file alone, a folder from its work tree's top or by its own files.
 *
 * The places it may change are watched while it runs, for the files a program works out once it runs: what such a
 * file held before is not known, since nobody looked at it first, unless the command made it.
 */

/** Folders never looked into outside git: what a program installs or builds, and other tools' own. */
const SKIPPED = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'target',
  'coverage'
])
/** The most files listed in a folder that is not a git work tree: past it, the rest is not looked at. */
const FILES_LIMIT = 20_000
/** The largest file held before a command, outside git, so what it held can be shown. */
export const HELD_LIMIT = 1024 * 1024
/** The most held across folders, outside git: the files seen last are kept first. */
const HELD_TOTAL = 64 * 1024 * 1024
/** The largest file read once a command ended, as the core keeps versions. */
const AFTER_LIMIT = 20 * 1024 * 1024
/** The most files said to be changed by one command: past it, a build or an install, the rest is left out. */
export const CHANGES_LIMIT = 200
/** The most files already changed in a work tree that are read before a command. */
const DIRTY_LIMIT = 500
/** The most places a command names outside its folder that are looked at too: past them, the rest are not. */
const NAMED_LIMIT = 16
/** How long a command's places are watched at most, when its end is never told. */
const WATCHED_MS = 60 * 60 * 1000
/** The slack on when a file was written, which some file systems keep to two seconds. */
const WRITTEN_SLACK_MS = 2000
/** The slack on when a file was made, the clock and the file system's times read apart. */
const MADE_SLACK_MS = 10
/**
 * The most paths given to git at once: few calls, since starting git is slow on Windows, and well within a command
 * line's length there (32,767 characters) for paths from a work tree's top.
 */
const GIT_BATCH = 150

/**
 * The paths `git status --porcelain=v1 -z` names, from the work tree's top, "/" between their parts: both of a
 * rename or a copy.
 */
export function porcelainPaths(printed: string): string[] {
  const fields = printed.split('\0')
  const paths: string[] = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index] ?? ''
    if (field.length < 4) continue
    paths.push(field.slice(3))
    // A rename or a copy names where it came from in the next field.
    if (field[0] === 'R' || field[0] === 'C') {
      const origin = fields[index + 1]
      if (origin) paths.push(origin)
      index++
    }
  }
  return paths
}

/** Whether two sides are the same content. */
function same(one: FoundChange['before'], other: FoundChange['after']): boolean {
  if (typeof one === 'string' || typeof other === 'string') return one === 'none' && other === 'none'
  if (one.byteLength !== other.byteLength) return false
  for (let index = 0; index < one.byteLength; index++) if (one[index] !== other[index]) return false
  return true
}

/** A file as it is now: its bytes, none, or too large to keep. */
async function now(path: string): Promise<FoundChange['after']> {
  try {
    const found = await stat(path)
    if (!found.isFile()) return 'none'
    if (found.size > AFTER_LIMIT) return 'too-large'
    return new Uint8Array(await readFile(path))
  } catch {
    return 'none'
  }
}

/** A path from a work tree's top, "/" between its parts, as this system names it. */
const placeIn = (top: string, path: string) => join(top, ...path.split('/'))

interface Snapshots {
  snapshot(folder: string, named?: readonly NamedPlace[], changeable?: Changeable): Promise<FolderSnapshot | undefined>
}

interface SnapshotOptions {
  /** Whether a path is in a place never reached: what changes there is not looked at. */
  never?: ((path: string) => boolean) | undefined
  /** The person's own folder, watched when the whole computer may be changed. */
  home?: string | undefined
  /** The folders of the home folder where apps keep their own data, passed over there. */
  appData?: readonly string[] | undefined
  /** Whether the system watches a folder with all its subfolders at once. Left out, as this system does. */
  trees?: boolean | undefined
  /**
   * Where a fence is made for each watch, when the system starts watching late and tells changes late. Left out, the
   * temporary folder where this system does (macOS), and none elsewhere.
   */
  fence?: string | undefined
}

/** A place looked at, and what it covers: a place inside it, looked at already, is not looked at again. */
interface Part {
  covers?: string
  snapshot: FolderSnapshot
}

/** Whether two paths are the same place. */
const samePlace = (one: string, other: string) => within(one, other) && within(other, one)

/** A path from a work tree's top, "/" between its parts, as git names it. */
const fromTop = (top: string, path: string) => relative(top, path).split(sep).join('/')

/** Snapshots of folders, holding small files across them so a folder looked at again reads only what changed. */
export function createSnapshots({
  never = () => false,
  home,
  appData = [],
  trees = system.watchesTrees,
  fence = system.watchesLate ? tmpdir() : undefined
}: SnapshotOptions = {}): Snapshots {
  // What is held of a file outside git, by where it is: its size and time when it was read, and its bytes.
  const held = new Map<string, { size: number; modified: number; bytes: Uint8Array }>()
  let heldBytes = 0

  const hold = (path: string, size: number, modified: number, bytes: Uint8Array) => {
    const known = held.get(path)
    if (known) {
      heldBytes -= known.bytes.byteLength
      held.delete(path)
    }
    held.set(path, { size, modified, bytes })
    heldBytes += bytes.byteLength
    // The files seen longest ago give way first.
    for (const [oldest, one] of held) {
      if (heldBytes <= HELD_TOTAL) break
      held.delete(oldest)
      heldBytes -= one.bytes.byteLength
    }
  }

  const inGit = async (top: string): Promise<FolderSnapshot> => {
    const headOf = async () => text(await git(top, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => new Uint8Array())).trim()
    const dirtyOf = async () => porcelainPaths(text(await git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])))
    const head = await headOf()
    // Git keeps no copy of a file changed and not committed: its content is read now.
    const before = new Map<string, FoundChange['before']>()
    for (const path of (await dirtyOf()).slice(0, DIRTY_LIMIT)) {
      const read = await now(placeIn(top, path))
      before.set(path, read)
    }
    return {
      async changes() {
        const candidates = new Set([...before.keys(), ...(await dirtyOf())])
        const after = await headOf()
        if (head !== '' && after !== '' && after !== head) {
          for (const path of text(await git(top, ['diff', '--name-only', '-z', head, after]).catch(() => new Uint8Array())).split('\0')) {
            if (path !== '') candidates.add(path)
          }
        }
        const found: FoundChange[] = []
        for (const path of candidates) {
          if (found.length >= CHANGES_LIMIT) break
          // A file clean before held what the commit before holds, as git writes it out (its line endings).
          const old =
            before.get(path) ?? (head === '' ? 'none' : await git(top, ['cat-file', '--filters', `${head}:${path}`]).catch((): FoundChange['before'] => 'none'))
          const current = await now(placeIn(top, path))
          if (!same(old, current)) found.push({ path: placeIn(top, path), before: old, after: current })
        }
        return found
      }
    }
  }

  /**
   * The files of a folder outside git, with their sizes and times, those of folders skipped left out; only those
   * directly in it unless `deep`.
   */
  const list = async (folder: string, deep = true): Promise<Map<string, { size: number; modified: number }>> => {
    const files = new Map<string, { size: number; modified: number }>()
    const waiting = [folder]
    while (waiting.length > 0 && files.size < FILES_LIMIT) {
      const current = waiting.shift() as string
      const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (files.size >= FILES_LIMIT) break
        const path = join(current, entry.name)
        if (entry.isDirectory()) {
          // Another work tree inside is git's to tell about, when a command runs there.
          if (deep && !SKIPPED.has(entry.name) && (await stat(join(path, '.git')).catch(() => undefined)) === undefined) waiting.push(path)
        } else if (entry.isFile()) {
          const found = await stat(path).catch(() => undefined)
          if (found) files.set(path, { size: found.size, modified: found.mtimeMs })
        }
      }
    }
    return files
  }

  const outsideGit = async (folder: string, deep = true): Promise<FolderSnapshot> => {
    const files = await list(folder, deep)
    for (const [path, { size, modified }] of files) {
      const known = held.get(path)
      if (size > HELD_LIMIT || (known && known.size === size && known.modified === modified)) continue
      const bytes = await readFile(path).catch(() => undefined)
      if (bytes) hold(path, size, modified, new Uint8Array(bytes))
    }
    return {
      async changes() {
        const later = await list(folder, deep)
        const found: FoundChange[] = []
        for (const path of new Set([...files.keys(), ...later.keys()])) {
          if (found.length >= CHANGES_LIMIT) break
          const was = files.get(path)
          const is = later.get(path)
          if (was && is && was.size === is.size && was.modified === is.modified) continue
          const known = held.get(path)
          const old: FoundChange['before'] = !was
            ? 'none'
            : known && known.size === was.size && known.modified === was.modified
              ? known.bytes
              : was.size > HELD_LIMIT
                ? 'too-large'
                : 'unknown'
          const current = is ? await now(path) : 'none'
          if (same(old, current)) continue
          found.push({ path, before: old, after: current })
          if (is && current instanceof Uint8Array && current.byteLength <= HELD_LIMIT) hold(path, is.size, is.modified, current)
        }
        return found
      }
    }
  }

  /**
   * A file, or a path where nothing is yet, looked at alone: what it held, and once the command ended, what it holds,
   * or all that a folder made there holds.
   */
  const alone = async (path: string): Promise<FolderSnapshot> => {
    const was = await stat(path).catch(() => undefined)
    const before: FoundChange['before'] = !was
      ? 'none'
      : was.size > HELD_LIMIT
        ? 'too-large'
        : await readFile(path).then(
            (bytes) => new Uint8Array(bytes),
            (): FoundChange['before'] => 'unknown'
          )
    return {
      async changes() {
        const is = await stat(path).catch(() => undefined)
        if (!was && is?.isDirectory()) {
          const found: FoundChange[] = []
          for (const file of (await list(path)).keys()) {
            if (found.length >= CHANGES_LIMIT) break
            found.push({ path: file, before: 'none', after: await now(file) })
          }
          return found
        }
        if (was && is?.isFile() && was.size === is.size && was.mtimeMs === is.mtimeMs) return []
        const current = await now(path)
        return same(before, current) ? [] : [{ path, before, after: current }]
      }
    }
  }

  /** A folder, from its work tree's top when it is in one; else by its files, and its subfolders' only when `deep`. */
  const folderPart = async (folder: string, deep: boolean): Promise<Part> => {
    // The top is found from the folder as it was named, not as git names it: git resolves links, so on macOS a folder
    // under /var would have its top under /private/var, and every path made relative to it would be wrong.
    const up = await git(folder, ['rev-parse', '--show-cdup']).then(text, () => undefined)
    if (up !== undefined) {
      const top = resolve(folder, up.trim())
      return { covers: top, snapshot: await inGit(top) }
    }
    return deep ? { covers: folder, snapshot: await outsideGit(folder) } : { snapshot: await outsideGit(folder, false) }
  }

  /** A place a command names: a folder as a folder is looked at, anything else alone. */
  const namedPart = async ({ path, below }: NamedPlace): Promise<Part> =>
    (await stat(path).catch(() => undefined))?.isDirectory() ? folderPart(path, below) : { covers: path, snapshot: await alone(path) }

  /**
   * Where the work tree a folder is in starts: the nearest folder up from it that holds `.git`, a folder or a file.
   * Nothing outside one. Found by looking, not by starting git, since a command may touch hundreds of folders.
   */
  const topOf = async (folder: string, tops: Map<string, string>): Promise<string> => {
    const walked: string[] = []
    let current = folder
    let top: string | undefined
    while (top === undefined) {
      const known = tops.get(current)
      if (known !== undefined) top = known
      else if ((await stat(join(current, '.git')).catch(() => undefined)) !== undefined) top = current
      else {
        walked.push(current)
        const parent = dirname(current)
        if (parent === current) top = ''
        current = parent
      }
    }
    for (const one of walked) tops.set(one, top)
    tops.set(current, top)
    return top
  }

  /**
   * The files of git work trees among paths: those git ignores, a build's and a tool's, as the folder a command runs
   * in leaves them out; and those it tracks, which were there before the command.
   */
  const knownToGit = async (paths: readonly string[], tops: Map<string, string>) => {
    const ignored = new Set<string>()
    const tracked = new Set<string>()
    const byTop = new Map<string, string[]>()
    for (const path of paths) {
      const top = await topOf(dirname(path), tops)
      if (top !== '') byTop.set(top, [...(byTop.get(top) ?? []), path])
    }
    for (const [top, inside] of byTop) {
      for (let at = 0; at < inside.length; at += GIT_BATCH) {
        const named = new Map(inside.slice(at, at + GIT_BATCH).map((path) => [fromTop(top, path), path]))
        // One question for both: git names those it tracks (`H`, deleted ones too) and those it does not but would
        // see (`?`); one it names neither way, it ignores. Names are taken as written, never as patterns.
        const answer = await git(top, [
          '--literal-pathspecs',
          'ls-files',
          '-z',
          '-t',
          '--cached',
          '--others',
          '--exclude-standard',
          '--',
          ...named.keys()
        ]).catch(() => undefined)
        // Git could not say: none of them is left out for it.
        if (answer === undefined) continue
        const said = text(answer)
        const seen = new Set<string>()
        for (const entry of said.split('\0')) {
          const path = named.get(entry.slice(2))
          if (path === undefined) continue
          seen.add(path)
          if (entry[0] !== '?') tracked.add(path)
        }
        for (const path of named.values()) if (!seen.has(path)) ignored.add(path)
      }
    }
    return { ignored, tracked }
  }

  /**
   * What the paths the system told of while a command ran became: the files it changed, made and deleted. Those
   * written while it ran, or gone, are asked of git a batch at a time, until enough are found.
   */
  const judge = async (noted: readonly Noted[], started: number): Promise<FoundChange[]> => {
    const seen: { path: string; first: Noted['first']; is: Noted['first'] }[] = []
    for (const { path, first } of noted) {
      if (first?.isDirectory()) continue
      const is = await stat(path).catch(() => undefined)
      if (is?.isDirectory()) continue
      // Told of, but not written while the command ran: read, or only its times or rights changed.
      if (is && (!is.isFile() || Math.max(is.mtimeMs, is.ctimeMs) < started - WRITTEN_SLACK_MS)) continue
      seen.push({ path, first, is })
    }
    const tops = new Map<string, string>()
    const found: FoundChange[] = []
    for (let at = 0; at < seen.length && found.length < CHANGES_LIMIT; at += GIT_BATCH) {
      const batch = seen.slice(at, at + GIT_BATCH)
      const { ignored, tracked } = await knownToGit(
        batch.map((one) => one.path),
        tops
      )
      // A file was there before when it was first seen made before the command, held from a look before, or tracked.
      const before = (one: (typeof seen)[number]) =>
        (one.first?.isFile() === true && (one.first.birthtimeMs === 0 || one.first.birthtimeMs < started - MADE_SLACK_MS)) ||
        held.has(one.path) ||
        tracked.has(one.path)
      for (const one of batch) {
        if (found.length >= CHANGES_LIMIT) break
        if (ignored.has(one.path)) continue
        if (!one.is) {
          // Gone: a file there before was deleted; one the command made and took away again was never there.
          if (before(one)) found.push({ path: one.path, before: 'unknown', after: 'none' })
          continue
        }
        const made = one.is.birthtimeMs > 0 && one.is.birthtimeMs >= started - MADE_SLACK_MS && !before(one)
        found.push({ path: one.path, before: made ? 'none' : 'unknown', after: await now(one.path) })
      }
    }
    return found
  }

  /**
   * The places a command may change, watched while it runs: those granted, and the home folder when the whole
   * computer may be changed, past what programs install and build and, there, the folders apps keep their data in.
   * What the other parts look at, and the places never reached, are left to them or out.
   */
  const watchedPart = async (changeable: Changeable, parts: readonly Part[]): Promise<Part & { release(): void }> => {
    const started = Date.now()
    const places = [...changeable.places, ...(changeable.everywhere && home !== undefined ? [home] : [])]
    const watching = await watchPlaces(places, {
      trees,
      fence,
      passed: (folder, name) =>
        SKIPPED.has(name) ||
        (home !== undefined && samePlace(folder, home) && (name.startsWith('.') || appData.some((one) => samePlace(join(folder, name), one)))),
      ignored: (path) => never(path) || parts.some((part) => part.covers !== undefined && within(path, part.covers))
    })
    // A command whose end is never told is watched no longer than this.
    const timer = setTimeout(() => void watching.stop(), WATCHED_MS)
    timer.unref?.()
    const release = () => {
      clearTimeout(timer)
      void watching.stop()
    }
    return {
      release,
      snapshot: {
        release,
        async changes() {
          await watching.settle()
          clearTimeout(timer)
          return judge(await watching.stop(), started)
        }
      }
    }
  }

  return {
    async snapshot(folder, named = [], changeable) {
      try {
        const parts: Part[] = [await folderPart(folder, true)]
        for (const place of named.slice(0, NAMED_LIMIT)) {
          if (parts.some((part) => part.covers !== undefined && within(place.path, part.covers))) continue
          const part = await namedPart(place).catch(() => undefined)
          if (part) parts.push(part)
        }
        const watching = changeable !== undefined && (changeable.places.length > 0 || changeable.everywhere)
        const watched = watching ? await watchedPart(changeable, parts).catch(() => undefined) : undefined
        if (watched) parts.push(watched)
        const [only] = parts
        if (only && parts.length === 1) return only.snapshot
        return {
          ...(watched ? { release: watched.release } : {}),
          async changes() {
            // A file two places hold, a work tree inside a folder gone through, is said once.
            const seen = new Set<string>()
            const found: FoundChange[] = []
            for (const part of parts) {
              for (const change of await part.snapshot.changes().catch((): FoundChange[] => [])) {
                if (found.length >= CHANGES_LIMIT) return found
                const key = system.caseless ? change.path.toLowerCase() : change.path
                if (seen.has(key)) continue
                seen.add(key)
                found.push(change)
              }
            }
            return found
          }
        }
      } catch {
        return undefined
      }
    }
  }
}
