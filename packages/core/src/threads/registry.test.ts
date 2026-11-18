import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createThreadRegistry } from './registry.ts'

describe('the index the orchestrator reads', () => {
  const setup = () => {
    let ids = 0
    const now = () => new Date('2026-11-18T09:00:00Z')
    return createThreadRegistry({ records: memoryRecords({ now }), now, newId: () => `thread-${++ids}` })
  }

  it('gives each thread its summary under its line, cut to a few lines', () => {
    const registry = setup()
    const trip = registry.open({ title: 'Lisbon trip', kind: 'topic' })
    registry.open({ title: 'Weather', kind: 'aside' })
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
