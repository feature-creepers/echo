import type { Event, ShownView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followView } from './view.ts'

const view = (id: string, slot: 'stage' | 'margin' = 'stage'): ShownView => ({
  id,
  title: id,
  slot,
  spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } }
})

function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  let answer: (shown: ShownView | undefined) => void = () => undefined
  const ran: string[] = []
  const session: Session = {
    run: (name) => {
      ran.push(name)
      if (name === 'view.read')
        return new Promise<never>((resolve) => (answer = (shown) => resolve((shown ? { view: shown, margin: [] } : { margin: [] }) as never)))
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
    expect(state.current().stage?.id).toBe('a')
  })

  it('follows what is shown and cleared', () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.emit({ type: 'event', name: 'view.shown', view: view('b') })
    expect(state.current().stage?.id).toBe('b')
    core.emit({ type: 'event', name: 'view.cleared' })
    expect(state.current().stage).toBeUndefined()
  })

  it('keeps an event that overtook the read', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.emit({ type: 'event', name: 'view.shown', view: view('new') })
    core.answer(view('old'))
    await settled()
    expect(state.current().stage?.id).toBe('new')
  })

  it('keeps aside cards in the margin, apart from the stage', () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.emit({ type: 'event', name: 'view.shown', view: view('topic') })
    for (const id of ['m1', 'm2', 'm3', 'm4']) core.emit({ type: 'event', name: 'view.shown', view: view(id, 'margin') })
    expect(state.current().stage?.id).toBe('topic')
    expect(state.current().margin.map((card) => card.id)).toEqual(['m2', 'm3', 'm4'])
    core.emit({ type: 'event', name: 'view.cleared', view: 'm3' })
    expect(state.current().margin.map((card) => card.id)).toEqual(['m2', 'm4'])
    expect(state.current().stage?.id).toBe('topic')
  })

  it('marks the views that arrived while connected, never the one read on connecting', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.answer(view('read'))
    await settled()
    expect(state.current().arrived).toEqual([])
    core.emit({ type: 'event', name: 'view.shown', view: view('new') })
    core.emit({ type: 'event', name: 'view.shown', view: view('aside', 'margin') })
    expect(state.current().arrived).toEqual(['new', 'aside'])
  })

  it('asks the core to clear the screen', async () => {
    const core = fakeSession()
    await followView(core.session).clear()
    expect(core.ran).toContain('view.clear')
  })
})
