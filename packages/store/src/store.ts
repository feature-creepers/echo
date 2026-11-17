import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Records, Search } from '@repo/core'
import { openDatabase } from './database.ts'
import { createRecords } from './records.ts'
import { createKeywordIndex } from './search/keyword.ts'

/** The name of the one file that holds a user's data, inside their data folder. */
export const STORE_FILE = 'store.sqlite'

export interface StoreOptions {
  /** The folder that holds the user's data. Created when missing. */
  folder: string
  now?: () => Date
}

export interface Store {
  records: Records
  /** Keyword search over the text of the records, kept in step with them. */
  search: Search
  /** Let go of the file. Nothing can be read or written afterwards. */
  close(): void
}

export function openStore({ folder, now }: StoreOptions): Store {
  mkdirSync(folder, { recursive: true })
  const database = openDatabase(join(folder, STORE_FILE))
  const search = createKeywordIndex(database)
  // Records written before the index existed, or by a version that did not keep it, are taken in now.
  search.catchUp()
  return { records: createRecords(database, now, search), search, close: () => database.close() }
}
