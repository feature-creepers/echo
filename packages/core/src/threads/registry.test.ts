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

describe("a project's thread in a copy of its repository", () => {
  const copy = { folder: '/data/worktrees/echo/echo-dark-mode', branch: 'echo/dark-mode', start: { commit: 'c0ffee', branch: 'main' } }

  it('keeps its copy when the core starts again, and works in the project once the copy is taken away', () => {
    const { records, now, registry } = setup()
    const thread = registry.open({ title: 'Dark mode', kind: 'topic', folder: '/home/ada/code/echo' })
    registry.copy(thread.id, copy)
    expect(createThreadRegistry({ records, now, newId: () => 'x' }).get(thread.id)).toMatchObject({ folder: '/home/ada/code/echo', copy })

    registry.copy(thread.id, undefined)
    expect(createThreadRegistry({ records, now, newId: () => 'x' }).get(thread.id)?.copy).toBeUndefined()
  })

  it('gives no copy to a thread that works on no project, nor to a sub-thread', () => {
    const { registry } = setup()
    const topic = registry.open({ title: 'Dinner', kind: 'topic' })
    const part = registry.open({ title: 'Part', kind: 'subthread', parent: topic.id, folder: '/home/ada/code/echo' })
    registry.copy(topic.id, copy)
    registry.copy(part.id, copy)
    expect([registry.get(topic.id)?.copy, registry.get(part.id)?.copy]).toEqual([undefined, undefined])
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
