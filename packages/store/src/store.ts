import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Blobs, Records } from '@repo/core'
import { createBlobs } from './blobs.ts'
import { openDatabase } from './database.ts'
import { createRecords } from './records.ts'

/** The name of the one file that holds a user's data, inside their data folder. */
export const STORE_FILE = 'store.sqlite'

export interface StoreOptions {
  /** The folder that holds the user's data. Created when missing. */
  folder: string
  now?: () => Date
}

export interface Store {
  records: Records
  /** Files' contents, in the `files` folder beside the database. */
  blobs: Blobs
  /** Let go of the file. Nothing can be read or written afterwards. */
  close(): void
}

export function openStore({ folder, now }: StoreOptions): Store {
  mkdirSync(folder, { recursive: true })
  const database = openDatabase(join(folder, STORE_FILE))
  return { records: createRecords(database, now), blobs: createBlobs(join(folder, 'files')), close: () => database.close() }
}
