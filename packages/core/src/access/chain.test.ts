import { describe, expect, it } from 'vitest'
import type { StoredRecord } from '../ports/records.ts'
import { memoryRecords } from '../records/memory.ts'
import { ACCESS_OUTCOME, ACCESS_USE, createActivity, KEPT_MS } from './activity.ts'
import { ACCESS_SEAL, canonical, checkChain, GENESIS, sealOf } from './chain.ts'
import { sha256 } from './sha256.ts'

describe('sha256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
    ['a'.repeat(1000), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'],
    ['Héllo, 世界 🎙', '94b82914619bd2a9d0fdd6f29b8d23e21a44ee949c1aef083f2ac8a4dc7ae35d']
  ])('hashes %j', (text, hash) => {
    expect(sha256(text)).toBe(hash)
  })
})

describe('canonical', () => {
  it.each([
    [{ b: 1, a: [1, { d: null, c: 'x' }] }, '{"a":[1,{"c":"x","d":null}],"b":1}'],
    [{ a: undefined, b: 2 }, '{"b":2}'],
    ['text', '"text"'],
    [null, 'null']
  ])('writes %j the same way every time', (value, text) => {
    expect(canonical(value)).toBe(text)
  })
})

const DAY = 24 * 60 * 60 * 1000

/** An activity with a few uses, and its records as written. */
function logged(count = 3) {
  let clock = Date.parse('2026-11-18T10:00:00Z')
  const now = () => new Date(clock)
  const records = memoryRecords({ now })
  // With no computer, no version of a file is ever kept.
  const activity = createActivity({
    records,
    versions: { put: () => '', get: () => undefined },
    computer: undefined,
    now,
    newId: (() => {
      let id = 0
      return () => `u${++id}`
    })()
  })
  for (let index = 0; index < count; index++) {
    activity.record({ tool: 'Bash', action: 'run', command: `echo ${index}`, paths: [], decision: 'ran', reason: 'level' })
    clock += 1000
  }
  return {
    activity,
    records,
    all: () => records.read([ACCESS_USE, ACCESS_OUTCOME, ACCESS_SEAL]),
    later: (ms: number) => {
      clock += ms
    },
    now
  }
}

const check = (records: StoredRecord[], now: Date) => checkChain(records, now.getTime() - KEPT_MS)

describe('the activity chain', () => {
  it('seals every record and finds the chain intact', async () => {
    const { activity, all } = logged()
    await activity.outcome('u1', { ok: true })
    const result = activity.check()
    expect(result).toMatchObject({ state: 'intact', sealed: 4, unsealed: 0 })
    expect(result.head).toBe((all().at(-1)?.payload as { hash?: string } | undefined)?.hash)
    expect(all().filter((record) => record.type === ACCESS_SEAL)[0]?.payload).toMatchObject({ previous: GENESIS })
  })

  it('finds nothing to check in an empty log', () => {
    expect(logged(0).activity.check()).toMatchObject({ state: 'empty', sealed: 0, head: null })
  })

  it.each<[string, (records: StoredRecord[]) => StoredRecord[], string]>([
    [
      'a command changed',
      (records) => records.map((record, index) => (index === 2 ? { ...record, payload: { ...(record.payload as object), command: 'echo hidden' } } : record)),
      'changed'
    ],
    ['a record taken out with its seal', (records) => records.filter((_, index) => index !== 2 && index !== 3), 'missing'],
    ['a record taken out, its seal left', (records) => records.filter((_, index) => index !== 2), 'missing'],
    ['two uses swapped', (records) => [records[2], records[3], records[0], records[1], records[4], records[5]] as StoredRecord[], 'missing'],
    ['a record emptied before its time', (records) => records.map((record, index) => (index <= 1 ? { ...record, payload: null } : record)), 'erased'],
    ['a record added without a seal', (records) => [...records.slice(0, 4), { ...(records[0] as StoredRecord), id: 'x' }, ...records.slice(4)], 'unsealed'],
    [
      'a seal rewritten for a changed record',
      (records) =>
        records.map((record, index) =>
          index === 3
            ? {
                ...record,
                payload: sealOf((records[1]?.payload as { hash?: string } | undefined)?.hash ?? GENESIS, { type: ACCESS_USE, payload: { forged: true } })
              }
            : record
        ),
      'changed'
    ]
  ])('shows %s', (_, tamper, reason) => {
    const { all, now } = logged()
    const result = check(tamper(all()), now())
    expect(result.state).toBe('broken')
    expect(result.problem?.reason).toBe(reason)
  })

  it('counts records from before the chain apart, and checks from the first seal on', () => {
    const { records, all, now } = logged(2)
    const earlier: StoredRecord = { id: 'old', origin: 'memory', sequence: 0, at: '2026-11-01T00:00:00.000Z', type: ACCESS_USE, payload: { id: 'u0' } }
    expect(check([earlier, ...all()], now())).toMatchObject({ state: 'intact', sealed: 2, unsealed: 1 })
    expect(records).toBeDefined()
  })

  it('goes on from its last seal when the core starts again', () => {
    const { records, now } = logged(2)
    const again = createActivity({ records, versions: { put: () => 'h', get: () => undefined }, computer: undefined, now, newId: () => 'u9' })
    again.record({ tool: 'Bash', action: 'run', command: 'ls', paths: [], decision: 'ran', reason: 'level' })
    expect(again.check()).toMatchObject({ state: 'intact', sealed: 3 })
  })

  it('stays intact once the 30 days erase the oldest records with their seals', () => {
    const { activity, later } = logged(2)
    later(31 * DAY)
    activity.record({ tool: 'Bash', action: 'run', command: 'ls', paths: [], decision: 'ran', reason: 'level' })
    activity.expire()
    expect(activity.check()).toMatchObject({ state: 'intact', sealed: 1 })
  })

  it('exports every record kept, with its seal and the check', () => {
    const { activity } = logged(2)
    const exported = activity.export()
    expect(exported.name).toBe('activity-2026-11-18.json')
    const document = JSON.parse(exported.text) as { check: { state: string; head: string }; records: { type: string }[] }
    expect(document.check.state).toBe('intact')
    expect(document.records.map((record) => record.type)).toEqual([ACCESS_USE, ACCESS_SEAL, ACCESS_USE, ACCESS_SEAL])
    expect(document.check.head).toBe(activity.check().head)
  })
})
