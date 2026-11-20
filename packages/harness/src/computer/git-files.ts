import { open, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { expandHome, real, within } from './paths.ts'
import { gitSettings } from './system/everywhere.ts'
import { system, type Where } from './system/index.ts'

/**
 * Whether git reads a file for its settings, its hooks or a repository (docs/SPEC.md, section 12.2): a program named
 * there runs on a git command that only reads, such as `git status`. `path` is real and absolute.
 *
 * Such a file is in a `.git` folder or is a `.git` file, is named `.gitconfig`, is in git's settings folder, is where
 * git would find a repository of its own (a file named `HEAD`, or one below a folder that holds one), or is in the
 * folder a repository around it runs its hooks from.
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
    // A repository around it, its own or one it is nested in, may run hooks from a folder that holds it.
    if ((await exists(join(folder, '.git'))) && (await hooksFolders(folder, where)).some((hooks) => within(path, hooks))) return true
    if (dirname(folder) === folder) return false
  }
}

/** How much of a `.git` file or a `commondir` file is read: a line naming a folder. */
const POINTER_BYTES = 4096
/** How much of a settings file is read: a repository's own are a few lines. */
const SETTINGS_BYTES = 256 * 1024

/**
 * The folders the hooks of the repository whose work tree is `tree` run from, as its own settings name them
 * (`core.hooksPath`, husky's `.husky/_`), real: read from its `config` and its `config.worktree`, wherever a `.git`
 * file points, without running git and without following an include. A relative one is read from the work tree,
 * where git runs its hooks.
 */
async function hooksFolders(tree: string, where: Where): Promise<string[]> {
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await bounded(join(tree, '.git'), POINTER_BYTES))?.[1]
  const gitFolder = pointer === undefined ? join(tree, '.git') : resolve(tree, pointer)
  // A linked work tree keeps its settings with the repository it shares.
  const common = (await bounded(join(gitFolder, 'commondir'), POINTER_BYTES)).trim()
  const files = [join(common === '' ? gitFolder : resolve(gitFolder, common), 'config'), join(gitFolder, 'config.worktree')]
  const values = (await Promise.all(files.map((file) => bounded(file, SETTINGS_BYTES)))).flatMap(hooksPaths)
  return Promise.all(values.map((value) => real(resolve(tree, expandHome(value, where.home)))))
}

/**
 * Every value a git settings file gives `core.hooksPath`, as git reads it: a section and a name whatever their
 * capitals, a key on the line of its section, a value quoted or not, escapes, comments, and a line continued with a
 * backslash.
 */
function hooksPaths(text: string): string[] {
  const found: string[] = []
  let section = ''
  for (const line of text.replace(/\\\r?\n/g, '').split(/\r?\n/)) {
    let rest = line.trim()
    const header = /^\[\s*([^\]\s"]+)\s*("(?:[^"\\]|\\.)*"\s*)?\]/.exec(rest)
    if (header) {
      // `[core "name"]` is a subsection, not git's own core settings.
      section = header[2] === undefined ? (header[1] ?? '').toLowerCase() : ''
      rest = rest.slice(header[0].length).trim()
    }
    const entry = /^([A-Za-z][\w-]*)\s*=(.*)$/.exec(rest)
    if (section === 'core' && entry?.[1]?.toLowerCase() === 'hookspath') found.push(settingValue(entry[2] ?? ''))
  }
  return found
}

/** A settings value as git reads it: quotes taken off, escapes read, a comment outside quotes left out. */
function settingValue(written: string): string {
  let value = ''
  let quoted = false
  for (let at = 0; at < written.length; at++) {
    const character = written[at] as string
    if (character === '\\') {
      const next = written[++at] ?? ''
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next
    } else if (character === '"') quoted = !quoted
    else if (!quoted && (character === '#' || character === ';')) break
    else value += character
  }
  return value.trim()
}

/** The start of a file, at most `bytes` of it; nothing when it is no ordinary file, which could hold the read. */
async function bounded(path: string, bytes: number): Promise<string> {
  try {
    if (!(await stat(path)).isFile()) return ''
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
      return buffer.toString('utf8', 0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
