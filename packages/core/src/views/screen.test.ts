import { EXAMPLE_VIEW } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { ASIDE_STAYS_MS, createScreen, type Showing } from './screen.ts'

function setup(records = memoryRecords()) {
  let ids = 0
  const screen = createScreen({ records, newId: () => `view-${++ids}` })
  const events: Event[] = []
  screen.onEvent((event) => events.push(event))
  return { screen, events, records }
}

const onStage = (thread = 'a'): Showing => ({ thread, turn: 't1', slot: 'stage', focused: true })
const shown = (title: string) => ({ title, view: EXAMPLE_VIEW })

describe('an aside card leaving by itself', () => {
  const aside = { thread: 'b', turn: 't2', slot: 'margin', focused: false } as const
  const timed = () => {
    const timers = manualTimers()
    let ids = 0
    return { timers, screen: createScreen({ records: memoryRecords(), newId: () => `view-${++ids}`, timers }) }
  }

  it('leaves a while after it was shown, and the stage stays', () => {
    const { timers, screen } = timed()
    screen.show(shown('Lyon'), onStage())
    screen.show(shown('Time in Montreal'), aside)
    timers.advance(ASIDE_STAYS_MS - 1)
    expect(screen.margin().map((view) => view.title)).toEqual(['Time in Montreal'])
    timers.advance(1)
    expect(screen.margin()).toEqual([])
    expect(screen.current()?.title).toBe('Lyon')
  })

  it('stays its full time again when brought back', () => {
    const { timers, screen } = timed()
    screen.show(shown('Time in Montreal'), aside)
    timers.advance(ASIDE_STAYS_MS - 10)
    screen.recall('b')
    timers.advance(ASIDE_STAYS_MS - 10)
    expect(screen.margin()).toHaveLength(1)
    timers.advance(10)
    expect(screen.margin()).toEqual([])
  })
})

describe('the screen', () => {
  it('shows a valid view on the stage, tied to its thread and turn', () => {
    const { screen, events } = setup()
    expect(screen.show(shown('Lyon this week'), onStage())).toEqual({ ok: true, text: 'Shown.' })
    expect(screen.current()).toMatchObject({ id: 'view-1', title: 'Lyon this week', thread: 'a', turn: 't1', slot: 'stage' })
    expect(events).toEqual([{ type: 'event', name: 'view.shown', view: screen.current() }])
  })

  it('shows nothing for an invalid view, and lists what to correct', () => {
    const { screen, events } = setup()
    const result = screen.show({ title: 'Broken', view: { root: 'a', elements: { a: { type: 'Nope' } } } }, onStage())
    expect(result.ok).toBe(false)
    expect(result.text).toContain('there is no block named "Nope"')
    expect(screen.current()).toBeUndefined()
    expect(events).toEqual([])
  })

  it('asks for a title', () => {
    expect(setup().screen.show({ view: EXAMPLE_VIEW }, onStage()).ok).toBe(false)
  })

  it('puts an aside in the margin, and keeps the stage', () => {
    const { screen } = setup()
    screen.show(shown('Topic'), onStage('a'))
    screen.show(shown('Time in Montreal'), { thread: 'b', turn: 't2', slot: 'margin', focused: false })
    expect(screen.current()?.title).toBe('Topic')
    expect(screen.margin().map((view) => view.title)).toEqual(['Time in Montreal'])
  })

  it('keeps the view of a topic in the background, and shows it when the topic comes back', () => {
    const { screen, events } = setup()
    screen.show(shown('Recipe'), onStage('recipe'))
    const kept = screen.show(shown('Form'), { thread: 'form', turn: 't2', slot: 'stage', focused: false })
    expect(kept.ok).toBe(true)
    expect(screen.current()?.title).toBe('Recipe')

    screen.focus('form')
    expect(screen.current()?.title).toBe('Form')
    screen.focus('recipe')
    expect(screen.current()?.title).toBe('Recipe')
    screen.focus('nothing-shown')
    expect(screen.current()).toBeUndefined()
    expect(events.map((event) => event.name)).toEqual(['view.shown', 'view.shown', 'view.shown', 'view.cleared'])
  })

  it('clears the stage, or one card, and announces it once', () => {
    const { screen, events } = setup()
    screen.show(shown('A'), onStage())
    screen.show(shown('B'), { thread: 'b', turn: 't2', slot: 'margin', focused: false })
    screen.clear('view-2')
    screen.clear()
    screen.clear()
    expect(screen.current()).toBeUndefined()
    expect(screen.margin()).toEqual([])
    expect(events.map((event) => event.name)).toEqual(['view.shown', 'view.shown', 'view.cleared', 'view.cleared'])
  })

  it('keeps every view still open in the stream, newest first, asides among them', () => {
    const { screen } = setup()
    screen.show(shown('Weather'), onStage('a'))
    screen.show(shown('Cities'), onStage('b'))
    screen.show(shown('Montreal'), { thread: 'c', turn: 't3', slot: 'margin', focused: false })
    screen.show(shown('Rates'), onStage('b'))
    expect(screen.current()?.title).toBe('Rates')
    expect(screen.stream().map((view) => view.title)).toEqual(['Rates', 'Montreal', 'Cities', 'Weather'])
  })

  it('closes any view of the stream, not only the one on the stage', () => {
    const { screen, events } = setup()
    screen.show(shown('Weather'), onStage('a'))
    screen.show(shown('Cities'), onStage('b'))
    screen.clear('view-1')
    expect(screen.current()?.title).toBe('Cities')
    expect(screen.stream().map((view) => view.title)).toEqual(['Cities'])
    expect(events.at(-1)).toEqual({ type: 'event', name: 'view.cleared', view: 'view-1' })
  })

  it('keeps the stream when the focus moves to a topic with nothing to show, and puts a topic brought back on top', () => {
    const { screen } = setup()
    screen.show(shown('Weather'), onStage('a'))
    screen.show(shown('Cities'), onStage('b'))
    screen.focus('elsewhere')
    expect(screen.current()).toBeUndefined()
    expect(screen.stream().map((view) => view.title)).toEqual(['Cities', 'Weather'])
    screen.focus('a')
    expect(screen.stream().map((view) => view.title)).toEqual(['Weather', 'Cities'])
  })

  it('is as it was after a restart', () => {
    const records = memoryRecords()
    const before = setup(records).screen
    before.show(shown('Closed'), onStage('c'))
    before.show(shown('Kept'), onStage())
    before.show(shown('Card'), { thread: 'b', turn: 't2', slot: 'margin', focused: false })
    before.clear('view-1')
    const after = setup(records).screen
    expect(after.current()?.title).toBe('Kept')
    expect(after.margin().map((view) => view.title)).toEqual(['Card'])
    expect(after.stream().map((view) => view.title)).toEqual(['Card', 'Kept'])
  })
})
