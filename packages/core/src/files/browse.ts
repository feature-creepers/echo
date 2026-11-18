import { type CommandError, encodeBase64, type WorkspaceEntry } from '@repo/protocol'
import type { Workspace, WorkspaceItem } from '../ports/workspace.ts'
import type { UserSettings } from '../settings/settings.ts'

/**
 * The assistant's folder as the person browses it (docs/SPEC.md, section 9.7): what is in each folder, and the
 * content of a file, read a piece at a time. A file elsewhere on the computer can be read too when the assistant
 * may read it there: the person previews what it wrote wherever they let it write.
 */
export interface Browsing {
  list(path: string): Promise<Outcome<{ folder: WorkspaceEntry; entries: WorkspaceEntry[] }>>
  read(path: string, offset: number, length: number): Promise<Outcome<{ data: string; size: number; entry: WorkspaceEntry }>>
}

type Outcome<Output> = { ok: true; output: Output } | { ok: false; error: CommandError }

/** What a system writes into folders by itself, and nobody wants to see. */
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

/** A path of the folder as it is meant, its parts joined by "/", or nothing when it would leave the folder. */
export function folderPath(path: string): string | undefined {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) return undefined
  return parts.join('/')
}

/** Whether a path is absolute on some system: "/home/…", "C:\…", "\\server\…". */
export const isAbsolute = (path: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)

/** Whether a place is a granted place, or inside it, by its words. The harness checks the real places, links followed. */
function inside(path: string, place: string): boolean {
  const trim = (value: string) => value.replace(/[\\/]+$/, '')
  const [one, other] = [trim(path), trim(place)]
  return one === other || one.startsWith(`${other}/`) || one.startsWith(`${other}\\`)
}

/** Folders first, then by name, as a person sorts them: "file 2" before "file 10". */
export function sorted(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort((one, other) =>
    one.kind !== other.kind ? (one.kind === 'folder' ? -1 : 1) : one.name.localeCompare(other.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

const missing = (what: string): { ok: false; error: CommandError } => ({ ok: false, error: { code: 'invalid-input', message: `There is no ${what}.` } })

export function createBrowsing({ workspace, settings }: { workspace: Workspace | undefined; settings: UserSettings }): Browsing {
  /** Whether the assistant may read a place outside its folder, as the person granted. */
  const readable = (location: string) => {
    const { places, computer } = settings.read().access
    return computer !== 'off' || places.some((place) => inside(location, place.path))
  }

  return {
    async list(asked) {
      const path = folderPath(asked)
      if (!workspace) return missing('folder of the assistant on this computer')
      if (path === undefined) return missing(`folder "${asked}" in the assistant's folder`)
      const [folder, items] = await Promise.all([workspace.stat(path), workspace.list(path)])
      if (folder?.kind !== 'folder' || !items) return missing(`folder "${asked}" in the assistant's folder`)
      return { ok: true, output: { folder, entries: sorted(items.filter((item) => !SYSTEM_FILES.has(item.name.toLowerCase()))) } }
    },

    async read(asked, offset, length) {
      if (!workspace) return missing('folder of the assistant on this computer')
      let where: { path: string } | { location: string } | undefined
      if (isAbsolute(asked)) {
        const path = workspace.pathOf(asked)
        where = path !== undefined ? { path } : readable(asked) ? { location: asked } : undefined
      } else {
        const path = folderPath(asked)
        where = path === undefined ? undefined : { path }
      }
      const read = where && (await workspace.read(where, offset, length))
      if (read?.item.kind !== 'file') return missing(`file "${asked}" the assistant may read`)
      return { ok: true, output: { data: encodeBase64(read.bytes), size: read.item.size, entry: read.item } }
    }
  }
}
