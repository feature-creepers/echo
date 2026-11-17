import type { AssistantState, CommandInput, CommandName, Event, MemoryView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followMemory } from './memory.ts'

const view = (revision: number, text = 'The user likes tea.'): MemoryView => ({
  revision,
  groups: [{ kind: 'preference', facts: [{ id: 'f1', text, kind: 'preference', origin: 'told', since: '2026-11-17', at: '2026-11-17', sources: [] }] }],
  sleep: { when: 'quiet', quietMinutes: 10, time: '03:00' }
})

function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  let answer: (memory: MemoryView, state: AssistantState) => void = () => undefined
  const ran: Array<{ name: CommandName; input: unknown }> = []
  const session: Session = {
    run: <Name extends CommandName>(name: Name, input: CommandInput<Name>) => {
      ran.push({ name, input })
      if (name === 'memory.read') return new Promise<never>((resolve) => (answer = (memory, state) => resolve({ memory, state } as never)))
      if (name === 'memory.sleep-now') return Promise.resolve({} as never)
      return Promise.resolve({ memory: view(9, 'Changed.') } as never)
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => undefined
  }
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  return { session, emit, ran, answer: (memory: MemoryView, state: AssistantState) => answer(memory, state) }
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('followMemory', () => {
  it('starts with what the core knows and whether it is asleep', async () => {
    const core = fakeSession()
    const memory = followMemory(core.session)
    expect(memory.current()).toBeUndefined()
    expect(memory.asleep.current()).toBe(false)

    core.answer(view(1), { asleep: true, since: '2026-11-17T10:00:00Z' })
    await settled()
    expect(memory.current()?.revision).toBe(1)
    expect(memory.asleep.current()).toBe(true)
  })

  it('keeps the later revision, whichever arrives first', async () => {
    const core = fakeSession()
    const memory = followMemory(core.session)
    core.emit({ type: 'event', name: 'memory.changed', memory: view(3, 'Newer.') })
    core.answer(view(2, 'Older.'), { asleep: false })
    await settled()
    expect(memory.current()?.groups[0]?.facts[0]?.text).toBe('Newer.')
  })

  it('follows the assistant falling asleep, its progress, and waking', async () => {
    const core = fakeSession()
    const memory = followMemory(core.session)
    const told: boolean[] = []
    memory.asleep.subscribe(() => told.push(memory.asleep.current()))

    core.emit({ type: 'event', name: 'assistant.state', state: { asleep: true, work: { done: 2, total: 5 } } })
    expect(memory.assistant.current().work).toEqual({ done: 2, total: 5 })
    // A state announced while the read was on its way is newer than the read.
    core.answer(view(1), { asleep: false })
    await settled()
    expect(memory.asleep.current()).toBe(true)
    core.emit({ type: 'event', name: 'assistant.state', state: { asleep: true, work: { done: 5, total: 5 } } })
    core.emit({ type: 'event', name: 'assistant.state', state: { asleep: false } })
    expect(told).toEqual([true, false])
  })

  it('edits, forgets, sets the sleep and asks for it, taking in what the core answers', async () => {
    const core = fakeSession()
    const memory = followMemory(core.session)
    await memory.edit('f1', 'Changed.', 'other')
    expect(memory.current()?.revision).toBe(9)
    await memory.forget('f1')
    await memory.setSleep({ when: 'time', time: '02:30' })
    await memory.sleepNow()
    expect(core.ran.slice(1)).toEqual([
      { name: 'memory.edit', input: { fact: 'f1', text: 'Changed.', kind: 'other' } },
      { name: 'memory.forget', input: { fact: 'f1' } },
      { name: 'memory.sleep-settings.set', input: { when: 'time', time: '02:30' } },
      { name: 'memory.sleep-now', input: {} }
    ])
  })

  it('hears nothing more once unfollowed', () => {
    const core = fakeSession()
    const memory = followMemory(core.session)
    memory.unfollow()
    core.emit({ type: 'event', name: 'memory.changed', memory: view(4) })
    expect(memory.current()).toBeUndefined()
  })
})
