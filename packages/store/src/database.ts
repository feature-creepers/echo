import { DatabaseSync } from 'node:sqlite'
import { records } from './migrations/0001-records.ts'

/**
 * The changes to the layout of the file, in the order they apply. One that was released is never edited:
 * a later one corrects it. The file remembers how many it has had.
 */
const MIGRATIONS: readonly string[] = [records]

/** The file was written by a later version of the product, which this one must not touch. */
export class StoreTooRecent extends Error {
  constructor(file: string) {
    super(`"${file}" was written by a more recent version of the app. Update the app to open it.`)
    this.name = 'StoreTooRecent'
  }
}

/** Open the file, creating it when missing, and bring its layout up to date. */
export function openDatabase(file: string): DatabaseSync {
  const database = new DatabaseSync(file)
  try {
    // Readers do not wait for the writer, and a process that is cut off never leaves the file half written.
    database.exec('pragma journal_mode = wal')
    database.exec('pragma foreign_keys = on')
    migrate(database, file)
  } catch (error) {
    database.close()
    throw error
  }
  return database
}

function migrate(database: DatabaseSync, file: string): void {
  const applied = Number(database.prepare('pragma user_version').get()?.user_version ?? 0)
  if (applied > MIGRATIONS.length) throw new StoreTooRecent(file)

  for (const [index, migration] of MIGRATIONS.entries()) {
    if (index < applied) continue
    transaction(database, () => {
      database.exec(migration)
      database.exec(`pragma user_version = ${index + 1}`)
    })
  }
}

/** Run `work` so that everything it writes is kept, or nothing is. */
export function transaction<Outcome>(database: DatabaseSync, work: () => Outcome): Outcome {
  database.exec('begin immediate')
  try {
    const outcome = work()
    database.exec('commit')
    return outcome
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}
