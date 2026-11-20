import type { FileHandle } from 'node:fs/promises'
import { mkdir, open, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { NewFile, Workspace, WorkspaceItem } from '@repo/core'
import { real, within } from './paths.ts'
import { system } from './system/index.ts'

/** How many names like a taken one are tried before giving up: "plan (2).pdf" up to "plan (999).pdf". */
const NAMES_TRIED = 999

/**
 * The assistant's own folder on this computer, made when missing: what the person browses and hands files into. A
 * path of the folder never leads outside it, a link inside it included.
 */
export async function createWorkspace(folder: string): Promise<Workspace> {
  await mkdir(folder, { recursive: true })
  const location = await realpath(folder)

  /** Where a path of the folder is on the computer, when it is really inside the folder, links followed. */
  const placeOf = async (path: string): Promise<string | undefined> => {
    const parts = path.split('/').filter((part) => part !== '' && part !== '.')
    if (parts.includes('..')) return undefined
    const place = join(location, ...parts)
    return within(await real(place), location) ? place : undefined
  }

  const pathOf = (place: string): string | undefined => {
    const absolute = resolve(place)
    const between = system.caseless ? relative(location.toLowerCase(), absolute.toLowerCase()) : relative(location, absolute)
    if (between.startsWith('..') || isAbsolute(between)) return undefined
    // The path keeps the capitals it has on disk: the comparison above only ignored them.
    return between === ''
      ? ''
      : absolute
          .slice(absolute.length - between.length)
          .split(sep)
          .join('/')
  }

  const itemAt = async (place: string, path: string): Promise<WorkspaceItem | undefined> => {
    try {
      const found = await stat(place)
      const folder = found.isDirectory()
      const size = folder ? (await readdir(place).catch(() => [])).length : found.size
      return {
        path,
        name: path === '' ? basename(location) : basename(place),
        kind: folder ? 'folder' : 'file',
        size,
        modified: found.mtime.toISOString(),
        location: place
      }
    } catch {
      return undefined
    }
  }

  const freeFile = async (folder: string, name: string): Promise<{ handle: FileHandle; name: string }> => {
    const extension = extname(name)
    const base = name.slice(0, name.length - extension.length)
    for (let attempt = 1; attempt <= NAMES_TRIED; attempt++) {
      const candidate = attempt === 1 ? name : `${base} (${attempt})${extension}`
      try {
        // Created only if nothing is there: a file already kept is never written over.
        return { handle: await open(join(folder, candidate), 'wx'), name: candidate }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error(`Every name like "${name}" is taken.`)
  }

  return {
    location,
    pathOf,

    async list(path) {
      const place = await placeOf(path)
      if (place === undefined) return undefined
      try {
        const names = await readdir(place)
        const items = await Promise.all(names.map((name) => itemAt(join(place, name), path === '' ? name : `${path}/${name}`)))
        return items.filter((item): item is WorkspaceItem => item !== undefined)
      } catch {
        return undefined
      }
    },

    async stat(path) {
      const place = await placeOf(path)
      return place === undefined ? undefined : itemAt(place, path.split('/').filter(Boolean).join('/'))
    },

    async about(place) {
      const absolute = resolve(place)
      return itemAt(absolute, pathOf(absolute) ?? absolute)
    },

    async read(where, offset, length) {
      const place = 'path' in where ? await placeOf(where.path) : resolve(where.location)
      if (place === undefined) return undefined
      const item = await itemAt(place, 'path' in where ? where.path : (pathOf(place) ?? place))
      if (item?.kind !== 'file') return undefined
      const handle = await open(place, 'r')
      try {
        const buffer = new Uint8Array(Math.max(0, Math.min(length, item.size - offset)))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
        return { bytes: buffer.subarray(0, bytesRead), item }
      } finally {
        await handle.close()
      }
    },

    async create(folder, name) {
      const place = await placeOf(folder)
      if (place === undefined) throw new Error(`"${folder}" is not a folder of the assistant's folder.`)
      await mkdir(place, { recursive: true })
      const { handle, name: kept } = await freeFile(place, name)
      const path = folder === '' ? kept : `${folder}/${kept}`
      const file = join(place, kept)
      let open = true
      const shut = async () => {
        if (!open) return
        open = false
        await handle.close()
      }
      const created: NewFile = {
        path,
        name: kept,
        async write(bytes) {
          await handle.write(bytes)
        },
        async close() {
          await shut()
          const item = await itemAt(file, path)
          if (!item) throw new Error(`"${path}" could not be kept.`)
          return item
        },
        async abort() {
          await shut()
          await rm(file, { force: true })
        }
      }
      return created
    },

    async remove(path) {
      const place = await placeOf(path)
      if (place !== undefined && place !== location) await rm(place, { force: true })
    }
  }
}
