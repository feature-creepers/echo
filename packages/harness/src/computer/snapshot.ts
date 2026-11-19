import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { FolderSnapshot, FoundChange } from '@repo/core'

/**
 * What a command changed in the folder it ran in (docs/SPEC.md, section 12.2), found by looking before it runs and
 * again once it ended, since nobody can tell which files a command will touch. In a git work tree, git says which
 * files differ, and what a file clean before held is git's own copy, so only the files already changed are read
 * first. Elsewhere, the folder's files are listed with their sizes and times, and the small ones are held, so what a
 * file held before can be shown; a larger one is named as changed.
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
export const FILES_LIMIT = 20_000
/** The largest file held before a command, outside git, so what it held can be shown. */
export const HELD_LIMIT = 1024 * 1024
/** The most held across folders, outside git: the files seen last are kept first. */
export const HELD_TOTAL = 64 * 1024 * 1024
/** The largest file read once a command ended, as the core keeps versions. */
export const AFTER_LIMIT = 20 * 1024 * 1024
/** The most files said to be changed by one command: past it, a build or an install, the rest is left out. */
export const CHANGES_LIMIT = 200
/** The most files already changed in a work tree that are read before a command. */
const DIRTY_LIMIT = 500

/** Run git in a folder and give back what it printed, as bytes. Rejects when it fails or is not there. */
export type Git = (folder: string, args: readonly string[]) => Promise<Uint8Array>

const runGit: Git = (folder, args) =>
  new Promise((resolve, reject) => {
    execFile('git', ['-C', folder, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 20_000 }, (error, out) =>
      error ? reject(error) : resolve(new Uint8Array(out))
    )
  })

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

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

export interface Snapshots {
  snapshot(folder: string): Promise<FolderSnapshot | undefined>
}

/** Snapshots of folders, holding small files across them so a folder looked at again reads only what changed. */
export function createSnapshots(git: Git = runGit): Snapshots {
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
      before.set(path, read === 'too-large' ? 'unknown' : read)
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

  /** The files of a folder outside git, with their sizes and times, those of folders skipped left out. */
  const list = async (folder: string): Promise<Map<string, { size: number; modified: number }>> => {
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
          if (!SKIPPED.has(entry.name) && (await stat(join(path, '.git')).catch(() => undefined)) === undefined) waiting.push(path)
        } else if (entry.isFile()) {
          const found = await stat(path).catch(() => undefined)
          if (found) files.set(path, { size: found.size, modified: found.mtimeMs })
        }
      }
    }
    return files
  }

  const outsideGit = async (folder: string): Promise<FolderSnapshot> => {
    const files = await list(folder)
    for (const [path, { size, modified }] of files) {
      const known = held.get(path)
      if (size > HELD_LIMIT || (known && known.size === size && known.modified === modified)) continue
      const bytes = await readFile(path).catch(() => undefined)
      if (bytes) hold(path, size, modified, new Uint8Array(bytes))
    }
    return {
      async changes() {
        const later = await list(folder)
        const found: FoundChange[] = []
        for (const path of new Set([...files.keys(), ...later.keys()])) {
          if (found.length >= CHANGES_LIMIT) break
          const was = files.get(path)
          const is = later.get(path)
          if (was && is && was.size === is.size && was.modified === is.modified) continue
          const known = held.get(path)
          const old: FoundChange['before'] = !was ? 'none' : known && known.size === was.size && known.modified === was.modified ? known.bytes : 'unknown'
          const current = is ? await now(path) : 'none'
          if (same(old, current)) continue
          found.push({ path, before: old, after: current })
          if (is && current instanceof Uint8Array && current.byteLength <= HELD_LIMIT) hold(path, is.size, is.modified, current)
        }
        return found
      }
    }
  }

  return {
    async snapshot(folder) {
      try {
        const top = text(await git(folder, ['rev-parse', '--show-toplevel']).catch(() => new Uint8Array())).trim()
        // Git names the top with "/" on every system.
        return top !== '' ? await inGit(top.split('/').join(sep)) : await outsideGit(folder)
      } catch {
        return undefined
      }
    }
  }
}
