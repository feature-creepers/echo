import type { NewFile, Workspace, WorkspaceItem } from '../ports/workspace.ts'

/** A folder of the assistant kept in memory, for tests: its files by path, and what is elsewhere on the computer. */
export interface MemoryWorkspace extends Workspace {
  /** The files of the folder, by path, as they are now. */
  files: Map<string, Uint8Array>
  /** Files elsewhere on the computer, by where they are. */
  elsewhere: Map<string, Uint8Array>
}

const MODIFIED = '2026-11-17T08:00:00.000Z'

export function memoryWorkspace(location = '/home/ada/workspace'): MemoryWorkspace {
  const files = new Map<string, Uint8Array>()
  const elsewhere = new Map<string, Uint8Array>()
  const at = (path: string) => (path === '' ? location : `${location}/${path}`)
  const nameOf = (path: string) => path.split('/').at(-1) ?? path
  const folders = () => {
    const found = new Set([''])
    for (const path of files.keys()) {
      const parts = path.split('/')
      for (let depth = 1; depth < parts.length; depth++) found.add(parts.slice(0, depth).join('/'))
    }
    return found
  }
  const childrenOf = (folder: string) =>
    [...files.keys(), ...folders()].filter(
      (path) => path !== '' && (folder === '' ? !path.includes('/') : path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/'))
    )
  const item = (path: string): WorkspaceItem | undefined => {
    const bytes = files.get(path)
    if (bytes) return { path, name: nameOf(path), kind: 'file', size: bytes.length, modified: MODIFIED, location: at(path) }
    if (folders().has(path))
      return { path, name: path === '' ? 'workspace' : nameOf(path), kind: 'folder', size: childrenOf(path).length, modified: MODIFIED, location: at(path) }
    return undefined
  }
  const pathOf = (place: string) => (place === location ? '' : place.startsWith(`${location}/`) ? place.slice(location.length + 1) : undefined)

  const workspace: MemoryWorkspace = {
    location,
    files,
    elsewhere,
    pathOf,
    list: async (path) => (folders().has(path) ? childrenOf(path).flatMap((child) => item(child) ?? []) : undefined),
    stat: async (path) => item(path),
    async about(place) {
      const path = pathOf(place)
      if (path !== undefined) return item(path)
      const bytes = elsewhere.get(place)
      return bytes && { path: place, name: nameOf(place), kind: 'file', size: bytes.length, modified: MODIFIED, location: place }
    },
    async read(where, offset, length) {
      const found = 'path' in where ? item(where.path) : await workspace.about(where.location)
      const bytes = 'path' in where ? files.get(where.path) : elsewhere.get(where.location)
      return found && bytes ? { bytes: bytes.slice(offset, offset + length), item: found } : undefined
    },
    async create(folder, name) {
      let kept = name
      const dot = name.lastIndexOf('.')
      for (let attempt = 2; files.has(folder === '' ? kept : `${folder}/${kept}`); attempt++)
        kept = dot > 0 ? `${name.slice(0, dot)} (${attempt})${name.slice(dot)}` : `${name} (${attempt})`
      const path = folder === '' ? kept : `${folder}/${kept}`
      let written = new Uint8Array()
      files.set(path, written)
      const created: NewFile = {
        path,
        name: kept,
        async write(bytes) {
          const joined = new Uint8Array(written.length + bytes.length)
          joined.set(written)
          joined.set(bytes, written.length)
          written = joined
          files.set(path, written)
        },
        async close() {
          return item(path) as WorkspaceItem
        },
        async abort() {
          files.delete(path)
        }
      }
      return created
    },
    async remove(path) {
      files.delete(path)
    }
  }
  return workspace
}
