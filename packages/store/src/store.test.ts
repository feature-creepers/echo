import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { STORE_FILE, StoreTooRecent, openStore, type Store } from './index.ts'

const folders: string[] = []
const open: Store[] = []

function folder(): string {
  const created = mkdtempSync(join(tmpdir(), 'store-test-'))
  folders.push(created)
  return created
}

function store(at: string, now?: () => Date): Store {
  const opened = openStore(now ? { folder: at, now } : { folder: at })
  open.push(opened)
  return opened
}

afterEach(() => {
  for (const opened of open.splice(0)) {
    try {
      opened.close()
    } catch {
      // Already closed by the test.
    }
  }
  for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true, maxRetries: 5 })
})

describe('the store', () => {
  it('creates the data folder when it is missing', () => {
    const missing = join(folder(), 'not', 'there', 'yet')
    expect(store(missing).records.read(['a'])).toEqual([])
  })

  it('numbers what this core writes from 1, and dates it', () => {
    const { records } = store(folder(), () => new Date('2026-11-17T08:00:00Z'))

    const written = records.append([
      { type: 'a', payload: { n: 1 } },
      { type: 'b', payload: ['two'] }
    ])

    expect(written.map((record) => record.sequence)).toEqual([1, 2])
    expect(written.map((record) => record.at)).toEqual(['2026-11-17T08:00:00.000Z', '2026-11-17T08:00:00.000Z'])
    expect(new Set(written.map((record) => record.origin)).size).toBe(1)
    expect(new Set(written.map((record) => record.id)).size).toBe(2)
    expect(records.append([{ type: 'a', payload: null }])[0]?.sequence).toBe(3)
  })

  it('reads back the types asked for, in the order written, as they were stored', () => {
    const { records } = store(folder())
    const written = records.append([
      { type: 'a', payload: { n: 1 } },
      { type: 'b', payload: 'two' },
      { type: 'a', payload: { n: 3, nested: { list: [1, 2] } } }
    ])

    expect(records.read(['a'])).toEqual([written[0], written[2]])
    expect(records.read(['b', 'a'])).toEqual(written)
    expect(records.read(['c'])).toEqual([])
    expect(records.read([])).toEqual([])
  })

  it('keeps everything, and the same core, when the file is opened again', () => {
    const at = folder()
    const before = store(at)
    const written = before.records.append([{ type: 'a', payload: { kept: true } }])
    before.close()

    const after = store(at)

    expect(after.records.read(['a'])).toEqual(written)
    const next = after.records.append([{ type: 'a', payload: 2 }])[0]
    expect(next).toMatchObject({ origin: written[0]?.origin, sequence: 2 })
  })

  it('writes all the records of an append, or none', () => {
    const { records } = store(folder())

    expect(() =>
      records.append([
        { type: 'a', payload: 1 },
        { type: 'a', payload: undefined }
      ])
    ).toThrow(/not JSON data/)

    expect(records.read(['a'])).toEqual([])
    expect(records.append([{ type: 'a', payload: 1 }])[0]?.sequence).toBe(1)
  })

  it('refuses a file written by a more recent version, and leaves it as it was', () => {
    const at = folder()
    store(at).close()
    const file = join(at, STORE_FILE)
    const tampered = new DatabaseSync(file)
    tampered.exec('pragma user_version = 999')
    tampered.close()

    expect(() => openStore({ folder: at })).toThrow(StoreTooRecent)

    const untouched = new DatabaseSync(file)
    expect(untouched.prepare('pragma user_version').get()).toEqual({ user_version: 999 })
    untouched.close()
  })
})
