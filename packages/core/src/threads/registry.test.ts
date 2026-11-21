import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createThreadRegistry, THREAD } from './registry.ts'

const setup = (records = memoryRecords()) => {
  let ids = 0
  const now = () => new Date('2026-11-18T09:00:00Z')
  return { records, now, registry: createThreadRegistry({ records, now, newId: () => `thread-${++ids}` }) }
}

describe("a thread's topic", () => {
  it('is the one it was opened in, and another once its answers are filed elsewhere', () => {
    const { records, now, registry } = setup()
    const weather = registry.open({ title: 'Weather this weekend', kind: 'topic', topic: 'camping' })
    expect(weather.topic).toBe('camping')
    registry.file(weather.id, 'trip')
    expect(registry.get(weather.id)?.topic).toBe('trip')
    expect(createThreadRegistry({ records, now, newId: () => 'x' }).get(weather.id)?.topic).toBe('trip')
  })

  it('is not kept by a sub-thread, which works for its thread', () => {
    const { registry } = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic', topic: 'trip' })
    const part = registry.open({ title: 'Flights', kind: 'subthread', parent: trip.id, topic: 'trip' })
    expect(part).toMatchObject({ parent: trip.id })
    expect(part.topic).toBeUndefined()
    registry.file(part.id, 'elsewhere')
    expect(registry.get(part.id)?.topic).toBeUndefined()
  })

  it('is missing from a side question recorded as an aside of old, read as a thread that answers the person', () => {
    const records = memoryRecords()
    records.append([
      { type: THREAD, payload: { id: 'trip', title: 'Lisbon trip', kind: 'topic', state: 'parked', at: '2026-11-18T08:00:00.000Z' } },
      { type: THREAD, payload: { id: 'side', title: 'Montreal', kind: 'aside', state: 'parked', parent: 'trip', at: '2026-11-18T08:01:00.000Z' } }
    ])
    expect(setup(records).registry.get('side')).toEqual({ id: 'side', title: 'Montreal', kind: 'topic', state: 'parked', at: '2026-11-18T08:01:00.000Z' })
  })
})

describe('the focus', () => {
  it('goes to the thread the person turned to, never to a sub-thread', () => {
    const { registry } = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    const part = registry.open({ title: 'Flights', kind: 'subthread', parent: trip.id })
    registry.focus(trip.id)
    registry.focus(part.id)
    expect(registry.focused()?.id).toBe(trip.id)
  })
})

describe('a thread put away', () => {
  it('stays put away when the core starts again, comes back when restored, and by itself once it works again', () => {
    const { records, now, registry } = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    registry.setState(trip.id, 'parked')
    registry.archive(trip.id, true)
    expect(createThreadRegistry({ records, now, newId: () => 'x' }).get(trip.id)?.archived).toBe(true)

    registry.archive(trip.id, false)
    expect(registry.get(trip.id)?.archived).toBeUndefined()
    registry.archive(trip.id, true)
    registry.setState(trip.id, 'working')
    expect(registry.get(trip.id)?.archived).toBeUndefined()
  })
})
