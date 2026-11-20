import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { system } from './system/index.ts'

/**
 * Paths as the system reaches them. A path a model writes may be relative, start with `~`, pass through `..`
 * or a link to somewhere else; it is checked only once it is the real place it leads to. Its `..` are kept until
 * then: macOS and Linux go up from where a link leads, which only the disk tells.
 */

/** Windows and macOS do not tell a name from the same name in other capitals, by default. */
const CASELESS = system.caseless

/** A path from the home folder (`~`, `~/Documents`) as an absolute one; any other path as it is. */
export function expandHome(path: string, home = homedir()): string {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return `${home}${sep}${path.slice(2)}`
  return path
}

/** A path as a session wrote it, from its working folder when relative, from the home folder with `~`, its `..` kept. */
export function asWritten(path: string, base: string): string {
  const expanded = expandHome(path.trim())
  return isAbsolute(expanded) ? expanded : `${base}${sep}${expanded}`
}

/** A path as a session means it, as the system names it: from its working folder when relative, from the home folder with `~`. */
export const absolute = (path: string, base: string): string => resolve(asWritten(path, base))

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
  if (other) written = `${join(dirname(home), other[1] as string)}${other[2] ?? ''}`
  return asWritten(system.shellPath(written), folder)
}

/**
 * Where a path really leads, links followed. A path that does not exist yet (a file about to be written) is
 * the real place of the nearest folder above it that does, followed by the rest.
 *
 * macOS and Linux follow a path part by part: `link/..` is the folder above where the link leads. Windows takes `..`
 * away as words before it follows a junction.
 */
export async function real(path: string): Promise<string> {
  if (system.upFromLinks && path.split(sep).includes('..')) return partByPart(path)
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

/** A path followed from the root, each link before a `..` after it; from the first part missing, the rest as words. */
async function partByPart(path: string): Promise<string> {
  const parts = (isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`).split(sep)
  let reached: string = sep
  for (const [at, part] of parts.entries()) {
    if (part === '' || part === '.') continue
    if (part === '..') reached = dirname(reached)
    else {
      try {
        reached = await realpath(join(reached, part))
      } catch {
        return join(reached, ...parts.slice(at))
      }
    }
  }
  return reached
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
