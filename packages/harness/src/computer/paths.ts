import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { system } from './system/index.ts'

/**
 * Paths as the system reaches them. A path a model writes may be relative, start with `~`, pass through `..`
 * or a link to somewhere else; it is checked only once it is the real place it leads to.
 */

/** Windows and macOS do not tell a name from the same name in other capitals, by default. */
const CASELESS = system.caseless

/** A path from the home folder (`~`, `~/Documents`) as an absolute one; any other path as it is. */
export function expandHome(path: string, home = homedir()): string {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/** A path as a session means it: from its working folder when relative, from the home folder with `~`. */
export function absolute(path: string, base: string): string {
  const expanded = expandHome(path.trim())
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded)
}

/**
 * A path a command names, as the command analysis wrote it (`~`, `${HOME}/x`, `/c/Users/me`, `../a`), where it
 * is on this computer: its variables given their values here, Git Bash's way of writing a drive read on
 * Windows, and a relative path read from the folder the command runs in. A variable with no value is empty,
 * as the shell would make it.
 */
export function namedPath(path: string, folder: string, env: Readonly<Record<string, string | undefined>> = process.env, home = homedir()): string {
  const value = (name: string) => {
    if (name === 'PWD') return folder
    if (name === 'HOME' || name === 'USERPROFILE') return env[name] ?? home
    if (name === 'HOMEPATH') return env.HOMEPATH ?? home.replace(/^[A-Za-z]:/, '')
    const found = Object.entries(env).find(([key]) => (CASELESS ? key.toUpperCase() === name : key === name))
    return found?.[1] ?? ''
  }
  let written = path.replace(/\$\{([^}]+)\}/g, (_whole, name: string) => value(name))
  // Someone else's home folder: `~ada`.
  const other = /^~([\w.-]+)(.*)$/.exec(written)
  if (other) written = join(dirname(home), other[1] as string, other[2] ?? '')
  return absolute(system.shellPath(written), folder)
}

/**
 * Where a path really leads, links followed. A path that does not exist yet (a file about to be written) is
 * the real place of the nearest folder above it that does, followed by the rest.
 */
export async function real(path: string): Promise<string> {
  let existing = resolve(path)
  const rest: string[] = []
  for (;;) {
    try {
      return join(await realpath(existing), ...rest.reverse())
    } catch {
      const parent = dirname(existing)
      if (parent === existing) return resolve(path)
      rest.push(relative(parent, existing))
      existing = parent
    }
  }
}

/** Whether a path is a place, or inside it. Both are real and absolute. */
export function within(path: string, place: string): boolean {
  const [one, other] = CASELESS ? [path.toLowerCase(), place.toLowerCase()] : [path, place]
  const between = relative(other, one)
  return between === '' || (!between.startsWith('..') && !isAbsolute(between))
}

/** Whether something is at a path, and what. */
export async function kindAt(path: string): Promise<'folder' | 'file' | undefined> {
  try {
    const found = await stat(path)
    return found.isDirectory() ? 'folder' : 'file'
  } catch {
    return undefined
  }
}
