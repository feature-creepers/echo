import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Blobs } from '@repo/core'

const HASH = /^[0-9a-f]{64}$/

/** Files' contents on disk, one file per hash in `folder`, written whole or not at all. */
export function createBlobs(folder: string): Blobs {
  mkdirSync(folder, { recursive: true })
  return {
    put(bytes) {
      const hash = createHash('sha256').update(bytes).digest('hex')
      const file = join(folder, hash)
      if (!existsSync(file)) {
        const part = `${file}.part`
        writeFileSync(part, bytes)
        renameSync(part, file)
      }
      return hash
    },
    get(hash) {
      if (!HASH.test(hash)) return undefined
      const file = join(folder, hash)
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined
    },
    remove(hash) {
      if (HASH.test(hash)) rmSync(join(folder, hash), { force: true })
    }
  }
}
