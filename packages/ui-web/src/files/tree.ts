import type { WorkspaceEntry } from '@repo/protocol'

/** What is known of a folder: being read, read, or not readable. */
export type Listing = { is: 'reading' } | { is: 'failed'; problem: string } | { is: 'listed'; folder: WorkspaceEntry; entries: WorkspaceEntry[] }

/** A row of the folder's tree: something in it, how deep, and, for a folder, whether it is open. */
export interface Row {
  entry: WorkspaceEntry
  depth: number
  open: boolean
  /** An open folder whose contents are still being read. */
  reading: boolean
}

/** The rows shown, top to bottom: each folder's contents under it while it is open, as in a file manager's list. */
export function visibleRows(listings: ReadonlyMap<string, Listing>, open: ReadonlySet<string>, path = '', depth = 0): Row[] {
  const listing = listings.get(path)
  if (listing?.is !== 'listed') return []
  return listing.entries.flatMap((entry) => {
    const opened = entry.kind === 'folder' && open.has(entry.path)
    const row: Row = { entry, depth, open: opened, reading: opened && listings.get(entry.path)?.is === 'reading' }
    return opened ? [row, ...visibleRows(listings, open, entry.path, depth + 1)] : [row]
  })
}

/** The folder a path is in: "" for what is at the top. */
export function parentOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

/** Where the keys move the selection in the tree, as a file manager's list moves it. */
export type TreeMove =
  | { to: string | undefined }
  /** Open or close a folder, keeping it selected. */
  | { toggle: string }
  /** Open the selected file with its app. */
  | { open: string }

/**
 * What a key does in the tree: up and down move, right opens a folder or goes into it, left closes it or goes up to
 * the folder above, Home and End go to the ends, Enter opens, and a letter goes to the next name starting with it.
 * Nothing for any other key.
 */
export function moveFor(key: string, rows: readonly Row[], selected: string | undefined): TreeMove | undefined {
  const at = rows.findIndex((row) => row.entry.path === selected)
  const row = rows[at]
  const pathAt = (index: number) => rows[Math.max(0, Math.min(rows.length - 1, index))]?.entry.path
  switch (key) {
    case 'ArrowDown':
      return { to: at < 0 ? pathAt(0) : pathAt(at + 1) }
    case 'ArrowUp':
      return { to: at < 0 ? pathAt(rows.length - 1) : pathAt(at - 1) }
    case 'Home':
      return { to: pathAt(0) }
    case 'End':
      return { to: pathAt(rows.length - 1) }
    case 'ArrowRight':
      if (row?.entry.kind !== 'folder') return undefined
      return row.open ? (rows[at + 1]?.depth === row.depth + 1 ? { to: pathAt(at + 1) } : undefined) : { toggle: row.entry.path }
    case 'ArrowLeft':
      if (!row) return undefined
      if (row.entry.kind === 'folder' && row.open) return { toggle: row.entry.path }
      return row.depth > 0 ? { to: parentOf(row.entry.path) } : undefined
    case 'Enter':
      if (!row) return undefined
      return row.entry.kind === 'folder' ? { toggle: row.entry.path } : { open: row.entry.path }
    default: {
      if (key.length !== 1 || key === ' ') return undefined
      const letter = key.toLowerCase()
      const after = [...rows.slice(at + 1), ...rows.slice(0, at + 1)]
      const found = after.find((candidate) => candidate.entry.name.toLowerCase().startsWith(letter))
      return found ? { to: found.entry.path } : undefined
    }
  }
}
