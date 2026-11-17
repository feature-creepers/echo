import { EXAMPLE_VIEW } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createScreen } from './screen.ts'

function setup(records = memoryRecords(), turn: string | undefined = 't1') {
  let ids = 0
  const screen = createScreen({ records, newId: () => `view-${++ids}`, turn: () => turn })
  const events: Event[] = []
  screen.onEvent((event) => events.push(event))
  return { screen, events, records }
}

describe('the screen', () => {
  it('shows a valid view to every client, tied to the turn under way', () => {
    const { screen, events } = setup()
    expect(screen.show({ title: 'Lyon this week', view: EXAMPLE_VIEW })).toEqual({ ok: true, text: 'Shown.' })
    expect(screen.current()).toMatchObject({ id: 'view-1', title: 'Lyon this week', turn: 't1', spec: { root: 'all' } })
    expect(events).toEqual([{ type: 'event', name: 'view.shown', view: screen.current() }])
  })

  it('shows nothing for an invalid view, and lists what to correct', () => {
    const { screen, events } = setup()
    const result = screen.show({ title: 'Broken', view: { root: 'a', elements: { a: { type: 'Nope' } } } })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('there is no block named "Nope"')
    expect(screen.current()).toBeUndefined()
    expect(events).toEqual([])
  })

  it('asks for a title', () => {
    expect(setup().screen.show({ view: EXAMPLE_VIEW }).ok).toBe(false)
  })

  it('clears, and announces it once', () => {
    const { screen, events } = setup()
    screen.show({ title: 'A', view: EXAMPLE_VIEW })
    screen.clear()
    screen.clear()
    expect(screen.current()).toBeUndefined()
    expect(events.map((event) => event.name)).toEqual(['view.shown', 'view.cleared'])
  })

  it('shows again after a restart what was on screen', () => {
    const records = memoryRecords()
    setup(records).screen.show({ title: 'Kept', view: EXAMPLE_VIEW })
    expect(setup(records).screen.current()?.title).toBe('Kept')

    setup(records).screen.clear()
    expect(setup(records).screen.current()).toBeUndefined()
  })
})
