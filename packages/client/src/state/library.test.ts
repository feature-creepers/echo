import type { Event, LibraryView, SavedWidget } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { collectionsOf, followLibrary, pinnedOf, savedAs } from './library.ts'

const widget = (id: string, more: Partial<SavedWidget> = {}): SavedWidget => ({
  id,
  title: id,
  pinned: false,
  since: '2026-11-17T08:00:00Z',
  at: '2026-11-17T08:00:00Z',
  spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } },
  ...more
})

function fakeSession(read: LibraryView) {
  const listeners = new Set<(event: Event) => void>()
  const ran: { name: string; input: unknown }[] = []
  const session: Session = {
    run: (name, input) => {
      ran.push({ name, input })
      if (name === 'library.read') return Promise.resolve({ library: read } as never)
      if (name === 'library.save') return Promise.resolve({ widget: widget('saved'), library: { revision: 9, widgets: [widget('saved')] } } as never)
      return Promise.resolve({ library: { revision: 10, widgets: [] } } as never)
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
  return { session, emit, ran }
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('followLibrary', () => {
  it('reads the library, then follows its changes, keeping the later revision', async () => {
    const core = fakeSession({ revision: 1, widgets: [widget('a')] })
    const state = followLibrary(core.session)
    core.emit({ type: 'event', name: 'library.changed', library: { revision: 2, widgets: [widget('a'), widget('b')] } })
    await settled()
    expect(state.current()?.widgets.map((one) => one.id)).toEqual(['a', 'b'])
  })

  it('saves a view and takes in the library the core answers with', async () => {
    const core = fakeSession({ revision: 1, widgets: [] })
    const state = followLibrary(core.session)
    await settled()
    expect((await state.save('view-1')).id).toBe('saved')
    expect(core.ran.at(-1)).toEqual({ name: 'library.save', input: { view: 'view-1' } })
    expect(state.current()?.revision).toBe(9)
    await state.arrange(['saved'])
    expect(core.ran.at(-1)).toEqual({ name: 'library.arrange', input: { pinned: ['saved'] } })
    await state.remove('saved')
    expect(state.current()?.widgets).toEqual([])
  })
})

describe('reading the library', () => {
  const library: LibraryView = {
    revision: 1,
    widgets: [
      widget('radio', { from: 'view-1', pinned: true, pinnedAt: '2026-11-17T09:00:00Z', collection: 'Music' }),
      widget('plan', { pinned: true, pinnedAt: '2026-11-17T08:30:00Z', collection: 'Work' }),
      widget('song', { collection: 'Music' })
    ]
  }

  it('finds the widget a view was saved as, or shows again', () => {
    expect(savedAs(library, { id: 'view-1' })?.id).toBe('radio')
    expect(savedAs(library, { id: 'view-9', widget: 'plan' })?.id).toBe('plan')
    expect(savedAs(library, { id: 'view-9' })).toBeUndefined()
  })

  it('lists pinned widgets in the order they were placed or pinned, and collections with their counts', () => {
    expect(pinnedOf(library).map((one) => one.id)).toEqual(['plan', 'radio'])
    // Once the user has dragged them, the places they were given come first.
    const dragged: LibraryView = { revision: 2, widgets: library.widgets.map((one) => (one.id === 'radio' ? { ...one, place: 0 } : one)) }
    expect(pinnedOf(dragged).map((one) => one.id)).toEqual(['radio', 'plan'])
    expect(collectionsOf(library)).toEqual([
      { name: 'Music', count: 2 },
      { name: 'Work', count: 1 }
    ])
  })
})
