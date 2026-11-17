import type { Event, ShownView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followView } from './view.ts'

const view = (id: string): ShownView => ({ id, title: id, spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } } })

function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  let answer: (shown: ShownView | undefined) => void = () => undefined
  const ran: string[] = []
  const session: Session = {
    run: (name) => {
      ran.push(name)
      if (name === 'view.read') return new Promise<never>((resolve) => (answer = (shown) => resolve((shown ? { view: shown } : {}) as never)))
      return Promise.resolve({} as never)
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
  return { session, emit, ran, answer: (shown: ShownView | undefined) => answer(shown) }
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('followView', () => {
  it('starts with what the core is showing', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.answer(view('a'))
    await settled()
    expect(state.current()?.id).toBe('a')
  })

  it('follows what is shown and cleared', () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.emit({ type: 'event', name: 'view.shown', view: view('b') })
    expect(state.current()?.id).toBe('b')
    core.emit({ type: 'event', name: 'view.cleared' })
    expect(state.current()).toBeUndefined()
  })

  it('keeps an event that overtook the read', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.emit({ type: 'event', name: 'view.shown', view: view('new') })
    core.answer(view('old'))
    await settled()
    expect(state.current()?.id).toBe('new')
  })

  it('asks the core to clear the screen', async () => {
    const core = fakeSession()
    await followView(core.session).clear()
    expect(core.ran).toContain('view.clear')
  })
})
