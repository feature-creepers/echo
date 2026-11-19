import { createHash } from 'node:crypto'
import { watch } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { Computer, ProtectedPath } from '@repo/core'
import { absolute, kindAt, real } from './paths.ts'
import { createSnapshots } from './snapshot.ts'
import { everywhere, system, type Where } from './system/index.ts'

export interface ComputerOptions {
  /** The assistant's own folder. Made when missing. */
  workspace: string
  /** The core's data folder, never reached by a session but for the assistant's folder inside it. Its `trash` holds what is moved there. */
  data?: string | undefined
  /** Where the person's things are. Left out, this computer's. */
  where?: Where | undefined
}

/** The places never reached on this computer: those every system has, this system's own, and the core's data. */
export function protectedPaths({ where, data, workspace }: { where: Where; data?: string | undefined; workspace: string }): ProtectedPath[] {
  return [
    ...everywhere(where),
    ...system.protectedPaths(where),
    ...(data === undefined ? [] : [{ label: 'The app’s own data', path: data, except: [workspace] }])
  ]
}

/** The day, as the trash's folders are named: 2026-11-18. */
const day = (at: Date) => at.toISOString().slice(0, 10)

/**
 * This computer, as the core keeps what the user grants on it: the assistant's own folder, made when missing,
 * what is at a path, the places never reached, and files read, put back and moved to the core's trash for undo.
 */
export async function createComputer({ workspace, data, where = { home: homedir(), env: process.env } }: ComputerOptions): Promise<Computer> {
  await mkdir(workspace, { recursive: true })
  const trash = join(data ?? dirname(workspace), 'trash')
  const snapshots = createSnapshots()
  return {
    workspace,
    async locate(path) {
      const found = await real(absolute(path, workspace))
      const kind = await kindAt(found)
      return kind === undefined ? undefined : { path: found, kind }
    },
    protected: protectedPaths({ where, data, workspace }),
    async read(path, limit) {
      try {
        const found = await stat(path)
        if (!found.isFile()) return undefined
        if (found.size > limit) return 'too-large'
        return new Uint8Array(await readFile(path))
      } catch {
        return undefined
      }
    },
    async write(path, bytes) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    },
    async fingerprint(path) {
      try {
        return createHash('sha256')
          .update(await readFile(path))
          .digest('hex')
      } catch {
        return undefined
      }
    },
    async trash(path) {
      const folder = join(trash, day(new Date()))
      await mkdir(folder, { recursive: true })
      // A file of the same name already moved there today keeps its place: this one is numbered.
      const extension = extname(path)
      const name = basename(path, extension)
      let target = join(folder, `${name}${extension}`)
      for (let count = 2; (await kindAt(target)) !== undefined; count++) target = join(folder, `${name} ${count}${extension}`)
      try {
        await rename(path, target)
      } catch (error) {
        // On another drive than the data folder, a file is copied there and then removed.
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await copyFile(path, target)
        await rm(path)
      }
      return target
    },
    watch(folder, changed) {
      // The folder alone, not its subfolders: what the person watches is where their files land.
      const watcher = watch(folder, { persistent: false }, (_event, name) => {
        if (name) changed([join(folder, name.toString())])
      })
      // A folder removed or no longer readable ends its watch; the job is watched again when the jobs change.
      watcher.on('error', () => watcher.close())
      return () => watcher.close()
    },
    async fileAt(path) {
      try {
        const found = await stat(path)
        return found.isFile() ? { size: found.size } : undefined
      } catch {
        return undefined
      }
    },
    snapshot: (folder) => snapshots.snapshot(folder),
    async list(folder) {
      try {
        return (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
      } catch {
        return undefined
      }
    }
  }
}
