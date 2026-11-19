import { EXAMPLE_VIEW } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { reminderCard } from '../schedule/words.ts'
import { ASIDE_STAYS_MS, createScreen, type Showing, VIEW_SHOWN } from './screen.ts'

function setup(records = memoryRecords()) {
  let ids = 0
  const screen = createScreen({ records, newId: () => `view-${++ids}` })
  const events: Event[] = []
  screen.onEvent((event) => events.push(event))
  return { screen, events, records }
}

const onStage = (thread = 'a'): Showing => ({ thread, turn: 't1', focused: true })
/** A side question's thread answering: the topic it was asked beside keeps the focus. */
const beside = (thread = 'b'): Showing => ({ thread, turn: 't2', focused: false, aside: true })
const shown = (title: string) => ({ title, view: EXAMPLE_VIEW })
const titles = (views: readonly { title: string }[]) => views.map((view) => view.title)

describe('an aside card leaving by itself', () => {
  const timed = (records = memoryRecords()) => {
    const timers = manualTimers()
    let ids = 0
    return { timers, records, screen: createScreen({ records, newId: () => `view-${++ids}`, timers }) }
  }

  it('leaves a while after it was shown, and the stage stays', () => {
    const { timers, screen } = timed()
    screen.show(shown('Lyon'), onStage())
    screen.show(shown('Time in Montreal'), beside())
    timers.advance(ASIDE_STAYS_MS - 1)
    expect(titles(screen.asides())).toEqual(['Time in Montreal'])
    timers.advance(1)
    expect(screen.asides()).toEqual([])
    expect(titles(screen.stream())).toEqual(['Lyon'])
    expect(screen.current()?.title).toBe('Lyon')
  })

  it('stays its full time again when brought back', () => {
    const { timers, screen } = timed()
    screen.show(shown('Time in Montreal'), beside())
    timers.advance(ASIDE_STAYS_MS - 10)
    screen.recall('b')
    timers.advance(ASIDE_STAYS_MS - 10)
    expect(screen.asides()).toHaveLength(1)
    timers.advance(10)
    expect(screen.asides()).toEqual([])
  })

  it('leaves when its time is up after a restart, every card of the stream', () => {
    const records = memoryRecords()
    const before = setup(records).screen
    for (const thread of ['b', 'c', 'd', 'e']) before.show(shown(`Side ${thread}`), beside(thread))
    const { timers, screen } = timed(records)
    expect(screen.asides()).toHaveLength(4)
    timers.advance(ASIDE_STAYS_MS)
    expect(screen.asides()).toEqual([])
  })
})

describe('the screen', () => {
  it('shows a valid view on the stage, tied to its thread and turn', () => {
    const { screen, events } = setup()
    expect(screen.show(shown('Lyon this week'), onStage())).toEqual({ ok: true, text: 'Shown.' })
    expect(screen.current()).toMatchObject({ id: 'view-1', title: 'Lyon this week', thread: 'a', turn: 't1' })
    expect(screen.current()?.aside).toBeUndefined()
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

  it('puts an aside card on top of the stream, and keeps the stage', () => {
    const { screen } = setup()
    screen.show(shown('Topic'), onStage('a'))
    screen.show(shown('Time in Montreal'), beside())
    expect(screen.current()?.title).toBe('Topic')
    expect(titles(screen.stream())).toEqual(['Time in Montreal', 'Topic'])
    expect(screen.asides()).toMatchObject([{ title: 'Time in Montreal', aside: true, thread: 'b' }])
  })

  it('keeps every aside card of the stream, one for each thread, however many', () => {
    const { screen } = setup()
    screen.show(shown('Topic'), onStage('a'))
    for (const thread of ['b', 'c', 'd', 'e']) screen.show(shown(`Side ${thread}`), beside(thread))
    screen.show(shown('Side b, again'), beside('b'))
    expect(titles(screen.asides())).toEqual(['Side b, again', 'Side e', 'Side d', 'Side c'])
  })

  it('keeps the view of a topic in the background, and shows it when the topic comes back', () => {
    const { screen, events } = setup()
    screen.show(shown('Recipe'), onStage('recipe'))
    const kept = screen.show(shown('Form'), { thread: 'form', turn: 't2', focused: false })
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

  it('empties the stage when the focus moves to a topic whose last view is an aside card, which stays where it is', () => {
    const { screen } = setup()
    screen.show(shown('Topic'), onStage('a'))
    screen.show(shown('Montreal'), beside())
    screen.focus('b')
    expect(screen.current()).toBeUndefined()
    expect(titles(screen.stream())).toEqual(['Montreal', 'Topic'])
    // Followed up, the side question's thread shows on the stage as any topic does.
    screen.show(shown('Montreal in detail'), onStage('b'))
    expect(screen.current()?.title).toBe('Montreal in detail')
    expect(titles(screen.stream())).toEqual(['Montreal in detail', 'Montreal', 'Topic'])
  })

  it('brings an aside card back on top once put away, and nothing for a view of the stage', () => {
    const { screen } = setup()
    screen.show(shown('Topic'), onStage('a'))
    screen.show(shown('Montreal'), beside())
    screen.clear('view-2')
    screen.show(shown('Rates'), onStage('a'))
    screen.recall('b')
    screen.recall('a')
    expect(titles(screen.stream())).toEqual(['Montreal', 'Rates', 'Topic'])
    expect(screen.current()?.title).toBe('Rates')
  })

  it('clears the stage, or one card, and announces it once', () => {
    const { screen, events } = setup()
    screen.show(shown('A'), onStage())
    screen.show(shown('B'), beside())
    screen.clear('view-2')
    screen.clear()
    screen.clear()
    expect(screen.current()).toBeUndefined()
    expect(screen.asides()).toEqual([])
    expect(events.map((event) => event.name)).toEqual(['view.shown', 'view.shown', 'view.cleared', 'view.cleared'])
  })

  it('keeps every view still open in the stream, newest first, asides among them', () => {
    const { screen } = setup()
    screen.show(shown('Weather'), onStage('a'))
    screen.show(shown('Cities'), onStage('b'))
    screen.show(shown('Montreal'), beside('c'))
    screen.show(shown('Rates'), onStage('b'))
    expect(screen.current()?.title).toBe('Rates')
    expect(titles(screen.stream())).toEqual(['Rates', 'Montreal', 'Cities', 'Weather'])
  })

  it('closes any view of the stream, not only the one on the stage', () => {
    const { screen, events } = setup()
    screen.show(shown('Weather'), onStage('a'))
    screen.show(shown('Cities'), onStage('b'))
    screen.clear('view-1')
    expect(screen.current()?.title).toBe('Cities')
    expect(titles(screen.stream())).toEqual(['Cities'])
    expect(events.at(-1)).toEqual({ type: 'event', name: 'view.cleared', view: 'view-1' })
  })

  it('keeps the stream when the focus moves to a topic with nothing to show, and puts a topic brought back on top', () => {
    const { screen } = setup()
    screen.show(shown('Weather'), onStage('a'))
    screen.show(shown('Cities'), onStage('b'))
    screen.focus('elsewhere')
    expect(screen.current()).toBeUndefined()
    expect(titles(screen.stream())).toEqual(['Cities', 'Weather'])
    screen.focus('a')
    expect(titles(screen.stream())).toEqual(['Weather', 'Cities'])
  })

  it('is as it was after a restart', () => {
    const records = memoryRecords()
    const before = setup(records).screen
    before.show(shown('Closed'), onStage('c'))
    before.show(shown('Kept'), onStage())
    before.show(shown('Card'), beside())
    before.clear('view-1')
    const after = setup(records).screen
    expect(after.current()?.title).toBe('Kept')
    expect(titles(after.asides())).toEqual(['Card'])
    expect(titles(after.stream())).toEqual(['Card', 'Kept'])
  })

  it('reads the cards once said to go in a margin as aside cards', () => {
    const records = memoryRecords()
    // Recorded as shown, so with what the catalogue fills in.
    const view = { title: 'Montreal', thread: 'b', spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } } }
    records.append([
      { type: VIEW_SHOWN, payload: { id: 'old-stage', ...view, title: 'Topic', thread: 'a', slot: 'stage' } },
      { type: VIEW_SHOWN, payload: { id: 'old-card', ...view, slot: 'margin' } }
    ])
    const { screen } = setup(records)
    expect(screen.current()?.title).toBe('Topic')
    expect(screen.current()).not.toHaveProperty('slot')
    expect(screen.asides()).toMatchObject([{ id: 'old-card', aside: true }])
    expect(screen.find('old-card')).toMatchObject({ aside: true })
    expect(screen.history('b')).toMatchObject([{ id: 'old-card', aside: true }])
  })
})

describe("a reminder's card", () => {
  it('names its reminder, so it can be snoozed from it, after a restart too', () => {
    const { screen, records } = setup()
    const card = reminderCard('Feed the cat', '14:15', 'job-1')
    screen.present(card, { thread: undefined, turn: 't1', focused: true })
    expect(screen.current()).toMatchObject({ title: 'Reminder', reminder: 'job-1' })
    expect(setup(records).screen.stream()[0]?.reminder).toBe('job-1')
  })
})
