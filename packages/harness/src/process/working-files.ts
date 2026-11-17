import { randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface WorkingFiles {
  /** Write a file and give its path. `name` says what it is: `instructions.txt`. */
  write(name: string, content: string): Promise<string>
  /** A path for a file the CLI will write itself. */
  path(name: string): string
  /** Remove every file written or named. */
  remove(): Promise<void>
}

/**
 * The files one session or one call hands to its CLI, in the adapter's working folder.
 *
 * A CLI takes its instructions and the address of the tool server as files. Each session's files carry an
 * identifier of their own, so that sessions share the folder, and are removed together when it ends.
 */
export function createWorkingFiles(folder: string): WorkingFiles {
  const id = randomBytes(6).toString('hex')
  const paths = new Set<string>()
  const path = (name: string) => {
    const full = join(folder, `${id}.${name}`)
    paths.add(full)
    return full
  }
  return {
    path,
    async write(name, content) {
      await mkdir(folder, { recursive: true })
      const full = path(name)
      // One of these files carries the token of the tool server: only this user reads them.
      await writeFile(full, content, { encoding: 'utf8', mode: 0o600 })
      return full
    },
    async remove() {
      // Windows keeps a file busy for a moment after the program that read it stopped: removal is tried again.
      await Promise.all([...paths].map((full) => rm(full, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)))
      paths.clear()
    }
  }
}
