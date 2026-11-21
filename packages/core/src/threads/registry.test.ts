import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createThreadRegistry, THREAD } from './registry.ts'

describe('the index the orchestrator reads', () => {
  const setup = () => {
    let ids = 0
    const now = () => new Date('2026-11-18T09:00:00Z')
    return createThreadRegistry({ records: memoryRecords({ now }), now, newId: () => `thread-${++ids}` })
  }

  it('gives each thread its summary under its line, cut to a few lines', () => {
    const registry = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    registry.open({ title: 'Weather', kind: 'topic', beside: trip.id })
    const long = `Planning the trip. ${'More detail. '.repeat(40)}`
    const index = registry.index(undefined, (thread) => (thread === trip.id ? long : undefined))
    const lines = index.split('\n')
    expect(lines.find((one) => one.includes('"Weather"'))).toBeDefined()
    const about = lines.find((one) => one.startsWith('  about: '))
    expect(about?.startsWith('  about: Planning the trip. More detail.')).toBe(true)
    expect(about?.endsWith('…')).toBe(true)
    expect(about?.length).toBeLessThanOrEqual('  about: '.length + 240)
    expect(lines.filter((one) => one.startsWith('  about: '))).toHaveLength(1)
  })
})

describe('a side question', () => {
  const setup = (records = memoryRecords()) => {
    let ids = 0
    const now = () => new Date('2026-11-18T09:00:00Z')
    return { records, registry: createThreadRegistry({ records, now, newId: () => `thread-${++ids}` }) }
  }

  it('is a topic opened beside the one on the stage, which keeps the focus', () => {
    const { registry } = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    registry.focus(trip.id)
    const side = registry.open({ title: 'Time in Montreal', kind: 'topic', beside: trip.id })
    expect(side).toMatchObject({ kind: 'topic', beside: trip.id })
    expect(registry.focused()?.id).toBe(trip.id)
    // Followed up, it takes the focus as any topic does.
    registry.focus(side.id)
    expect(registry.focused()?.id).toBe(side.id)
  })

  it.each([
    ['a project, which is a topic of its own', { folder: '/home/ada/code' }],
    ['a topic that is not there', { beside: 'gone' }],
    ['a sub-thread', { kind: 'subthread' as const }]
  ])('is not kept beside %s', (_, more) => {
    const { registry } = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    const opened = registry.open({ title: 'Side', kind: 'topic', beside: trip.id, ...more })
    expect(opened.beside).toBeUndefined()
  })

  it('recorded as an aside of old is read as a topic beside the one it was asked beside', () => {
    const records = memoryRecords()
    records.append([
      { type: THREAD, payload: { id: 'trip', title: 'Lisbon trip', kind: 'topic', state: 'parked', at: '2026-11-18T08:00:00.000Z' } },
      { type: THREAD, payload: { id: 'side', title: 'Montreal', kind: 'aside', state: 'parked', parent: 'trip', at: '2026-11-18T08:01:00.000Z' } }
    ])
    const { registry } = setup(records)
    expect(registry.get('side')).toEqual({ id: 'side', title: 'Montreal', kind: 'topic', state: 'parked', beside: 'trip', at: '2026-11-18T08:01:00.000Z' })
  })
})

describe('a thread put away', () => {
  it('stays put away when the core starts again, comes back when restored, and by itself once it works again', () => {
    const records = memoryRecords()
    let ids = 0
    const now = () => new Date('2026-11-21T09:00:00Z')
    const registry = createThreadRegistry({ records, now, newId: () => `thread-${++ids}` })
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    registry.setState(trip.id, 'parked')
    registry.archive(trip.id, true)
    expect(createThreadRegistry({ records, now, newId: () => 'x' }).get(trip.id)?.archived).toBe(true)
    expect(registry.index()).toContain('archived by the person')

    registry.archive(trip.id, false)
    expect(registry.get(trip.id)?.archived).toBeUndefined()
    registry.archive(trip.id, true)
    registry.setState(trip.id, 'working')
    expect(registry.get(trip.id)?.archived).toBeUndefined()
  })
})
