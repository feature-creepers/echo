import type { Place, Thread } from '@repo/protocol'

/** A folder the person may open a project in, and whether a project's thread already works there. */
export interface ProjectFolder {
  path: string
  /** A thread works there already: what is asked goes to it when it is free. */
  known: boolean
}

/** How many folders are offered at once: those worked in most recently. */
export const FOLDERS_OFFERED = 6

/**
 * The folders a project can be opened in without looking for them (docs/SPEC.md, section 7.11): those projects'
 * threads work in, the most recent first, then the folders the person lets the assistant change. Each once, as
 * Windows reads paths, whatever their capitals and a separator at the end.
 */
export function projectFolders(threads: readonly Thread[], places: readonly Place[]): ProjectFolder[] {
  const seen = new Set<string>()
  const offered: ProjectFolder[] = []
  const offer = (path: string, known: boolean) => {
    const key = keyOf(path)
    if (seen.has(key)) return
    seen.add(key)
    offered.push({ path, known })
  }
  for (const thread of threads) if (thread.kind === 'topic' && thread.folder !== undefined) offer(thread.folder, true)
  for (const place of places) if (place.kind === 'folder' && place.write) offer(place.path, false)
  return offered.slice(0, FOLDERS_OFFERED)
}

/** A path as compared: without a separator at the end, and in small letters for a Windows one. */
function keyOf(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, '') : path
  return /^[A-Za-z]:|^\\\\/.test(trimmed) ? trimmed.toLowerCase().replaceAll('/', '\\') : trimmed
}
