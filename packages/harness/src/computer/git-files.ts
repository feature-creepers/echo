import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { real, within } from './paths.ts'
import { gitSettings } from './system/everywhere.ts'
import { system, type Where } from './system/index.ts'

/**
 * Whether git reads a file for its settings, its hooks or a repository (docs/SPEC.md, section 12.2): a program named
 * there runs on a git command that only reads, such as `git status`. `path` is real and absolute.
 *
 * Such a file is in a `.git` folder or is a `.git` file, is named `.gitconfig`, is in git's settings folder, or is
 * where git would find a repository of its own: a file named `HEAD`, or one below a folder that holds one.
 */
export async function gitReads(path: string, where: Where): Promise<boolean> {
  const same = (one: string, other: string) => (system.caseless ? one.toLowerCase() === other.toLowerCase() : one === other)
  const parts = path.split(/[\\/]/)
  const name = parts.at(-1) ?? ''
  if (parts.some((part) => same(part, '.git')) || same(name, '.gitconfig') || same(name, 'HEAD')) return true
  // Git reads `$XDG_CONFIG_HOME/git` when it is set and `~/.config/git` otherwise: both are held.
  const settings = await Promise.all([...gitSettings(where, join), ...gitSettings({ ...where, env: {} }, join)].map(real))
  if (settings.some((place) => within(path, place))) return true
  for (let folder = dirname(path); ; folder = dirname(folder)) {
    if (await isFile(join(folder, 'HEAD'))) return true
    if (dirname(folder) === folder) return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
