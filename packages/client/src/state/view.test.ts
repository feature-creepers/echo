import type { Event, ShownView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followView } from './view.ts'

const view = (id: string, aside = false, thread?: string): ShownView => ({
  id,
  title: id,
  ...(aside ? { aside } : {}),
  ...(thread === undefined ? {} : { thread }),
  spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } }
})

function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  let answer: (shown: ShownView | undefined, stream?: ShownView[]) => void = () => undefined
  const ran: string[] = []
  const session: Session = {
    run: (name) => {
      ran.push(name)
      if (name === 'view.read')
        return new Promise<never>(
          (resolve) => (answer = (shown, stream = shown ? [shown] : []) => resolve((shown ? { view: shown, stream } : { stream }) as never))
        )
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
  return { session, emit, ran, answer: (shown: ShownView | undefined, stream?: ShownView[]) => answer(shown, stream) }
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

  it('keeps the stream read when a view arrives while the read is on its way, with the new view on top', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    // A reminder rings as the app opens: its card arrives before the screen the core had is read back.
    core.emit({ type: 'event', name: 'view.shown', view: view('reminder') })
    core.answer(view('b'), [view('b'), view('a')])
    await settled()
    expect(state.current().stream.map((shown) => shown.id)).toEqual(['reminder', 'b', 'a'])
    expect(state.current().stage?.id).toBe('reminder')
    expect(state.current().arrived).toEqual(['reminder'])
  })

  it('puts aside cards on top of the stream, and keeps the topic on the stage', () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.emit({ type: 'event', name: 'view.shown', view: view('topic') })
    for (const id of ['m1', 'm2', 'm3', 'm4']) core.emit({ type: 'event', name: 'view.shown', view: view(id, true, id) })
    expect(state.current().stage?.id).toBe('topic')
    expect(state.current().stream.map((card) => card.id)).toEqual(['m4', 'm3', 'm2', 'm1', 'topic'])
    core.emit({ type: 'event', name: 'view.cleared', view: 'm3' })
    expect(state.current().stream.map((card) => card.id)).toEqual(['m4', 'm2', 'm1', 'topic'])
    expect(state.current().stage?.id).toBe('topic')
  })

  it('marks the views that arrived while connected, never the one read on connecting', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.answer(view('read'))
    await settled()
    expect(state.current().arrived).toEqual([])
    core.emit({ type: 'event', name: 'view.shown', view: view('new') })
    core.emit({ type: 'event', name: 'view.shown', view: view('aside', true) })
    expect(state.current().arrived).toEqual(['new', 'aside'])
  })

  it('opens on the stream the core keeps, then puts each new view on top', async () => {
    const core = fakeSession()
    const state = followView(core.session)
    core.answer(view('b'), [view('b'), view('a')])
    await settled()
    core.emit({ type: 'event', name: 'view.shown', view: view('aside', true) })
    core.emit({ type: 'event', name: 'view.shown', view: view('c') })
    expect(state.current().stream.map((one) => one.id)).toEqual(['c', 'aside', 'b', 'a'])
  })

  it('takes a closed view out of the stream, and keeps the stream when only the stage empties', () => {
    const core = fakeSession()
    const state = followView(core.session)
    for (const id of ['a', 'b', 'c']) core.emit({ type: 'event', name: 'view.shown', view: view(id) })
    core.emit({ type: 'event', name: 'view.cleared', view: 'b' })
    expect(state.current().stream.map((one) => one.id)).toEqual(['c', 'a'])
    core.emit({ type: 'event', name: 'view.cleared' })
    expect(state.current().stage).toBeUndefined()
    expect(state.current().stream.map((one) => one.id)).toEqual(['c', 'a'])
  })

  it('asks the core to clear the screen', async () => {
    const core = fakeSession()
    await followView(core.session).clear()
    expect(core.ran).toContain('view.clear')
  })
})
