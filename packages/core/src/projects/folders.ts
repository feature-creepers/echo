/**
 * A project's folder and the paths in it, written as the system writes them: with backslashes on Windows, slashes
 * elsewhere. The core reaches no file system of its own, so it reads paths by their words (the harness resolves
 * them for real).
 */

/** A file in a folder, written with the folder's own separator. */
export function inFolder(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  return `${trimmed(folder)}${separator}${name}`
}

/** A folder's own name: the last part of its path. */
export function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
}

/**
 * The parts of a path below a folder, when it is in it: `src/a.ts` in `/p` is `['src', 'a.ts']`, the folder itself
 * is `[]`. Nothing when it is not in it. Windows paths are compared whatever their capitals, as Windows does.
 */
export function partsFrom(folder: string, path: string): string[] | undefined {
  const windows = /^[A-Za-z]:|^\\\\/.test(folder)
  const same = (one: string, other: string) => (windows ? one.toLowerCase() === other.toLowerCase() : one === other)
  const base = trimmed(folder)
  if (same(path, base)) return []
  const head = path.slice(0, base.length)
  const separator = path.charAt(base.length)
  if (!same(head, base) || (separator !== '/' && separator !== '\\')) return undefined
  return path
    .slice(base.length + 1)
    .split(/[\\/]/)
    .filter(Boolean)
}

/** A path as written from a folder it is in, with the folder's separator: `src/a.ts`, `.` for the folder. Nothing when it is not in it. */
export function fromFolder(folder: string, path: string): string | undefined {
  const parts = partsFrom(folder, path)
  if (parts === undefined) return undefined
  return parts.length === 0 ? '.' : parts.join(folder.includes('\\') && !folder.includes('/') ? '\\' : '/')
}

const trimmed = (folder: string) => (/^[\\/]+$/.test(folder) ? folder : folder.replace(/[\\/]+$/, ''))
