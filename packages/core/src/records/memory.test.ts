import { describe, expect, it } from 'vitest'
import { memoryRecords } from './memory.ts'

describe('records kept in memory', () => {
  it('number what one core writes, starting at 1, and date it', () => {
    const records = memoryRecords({ origin: 'here', now: () => new Date('2026-11-17T08:00:00Z') })

    const written = records.append([
      { type: 'a', payload: 1 },
      { type: 'b', payload: 2 }
    ])

    expect(written).toEqual([
      { id: 'here-1', origin: 'here', sequence: 1, at: '2026-11-17T08:00:00.000Z', type: 'a', payload: 1 },
      { id: 'here-2', origin: 'here', sequence: 2, at: '2026-11-17T08:00:00.000Z', type: 'b', payload: 2 }
    ])
    expect(records.append([{ type: 'a', payload: 3 }])[0]?.sequence).toBe(3)
  })

  it('read back the types asked for, in the order written', () => {
    const records = memoryRecords()
    records.append([
      { type: 'a', payload: 1 },
      { type: 'b', payload: 2 },
      { type: 'a', payload: 3 }
    ])

    expect(records.read(['a']).map((record) => record.payload)).toEqual([1, 3])
    expect(records.read(['a', 'b']).map((record) => record.payload)).toEqual([1, 2, 3])
    expect(records.read([])).toEqual([])
  })

  it('never hand back the object that was written', () => {
    const records = memoryRecords()
    const payload = { names: ['Ada'] }
    records.append([{ type: 'a', payload }])
    payload.names.push('changed afterwards')

    expect(records.read(['a'])[0]?.payload).toEqual({ names: ['Ada'] })
  })
})
