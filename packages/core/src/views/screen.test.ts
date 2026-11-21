import { EXAMPLE_VIEW, validateView } from '@repo/catalog'
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

const onStage = (thread = 'a', turn = 't1'): Showing => ({ thread, turn, focused: true })
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
    screen.show(shown('Rates'), onStage('a', 't3'))
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
    screen.show(shown('Rates'), onStage('b', 't3'))
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

describe('the cards of an answer', () => {
  /** A card shown: its title, the thread and turn that show it, and the name it is given, if any. */
  type Shown = [title: string, thread: string, turn: string, card?: string]
  const showAll = (screen: ReturnType<typeof setup>['screen'], cards: readonly Shown[]) =>
    cards.map(([title, thread, turn, card]) => screen.show({ title, ...(card === undefined ? {} : { card }), view: EXAMPLE_VIEW }, onStage(thread, turn)))

  it.each<[string, Shown[], string[], string[]]>([
    [
      'a new name goes beside the cards of the answer',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Chart', 'a', 't1', 'chart']
      ],
      ['Chart', 'Weather'],
      ['Chart', 'Weather']
    ],
    [
      'the same name replaces that card',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Chart', 'a', 't1', 'chart'],
        ['Weather, again', 'a', 't1', 'weather']
      ],
      ['Weather, again', 'Chart'],
      ['Weather, again', 'Chart']
    ],
    [
      'names that differ only in case are one',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Weather, again', 'a', 't1', ' Weather ']
      ],
      ['Weather, again'],
      ['Weather, again']
    ],
    [
      'without a name, each call replaces the one card',
      [
        ['Draft', 'a', 't1'],
        ['Final', 'a', 't1']
      ],
      ['Final'],
      ['Final']
    ],
    [
      'without a name, a card goes beside named ones',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Summary', 'a', 't1']
      ],
      ['Summary', 'Weather'],
      ['Summary', 'Weather']
    ],
    [
      'a new turn takes the place of every card on the stage, and the stream keeps them',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Chart', 'a', 't1', 'chart'],
        ['Rates', 'a', 't2', 'chart']
      ],
      ['Rates'],
      ['Rates', 'Chart', 'Weather']
    ],
    [
      "another topic's answer takes the stage",
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Cities', 'b', 't2', 'weather']
      ],
      ['Cities'],
      ['Cities', 'Weather']
    ]
  ])('%s', (_case, cards, stage, stream) => {
    const { screen } = setup()
    expect(showAll(screen, cards).every((result) => result.ok)).toBe(true)
    expect(titles(screen.cards(undefined))).toEqual(stage)
    expect(screen.current()?.title).toBe(stage[0])
    expect(titles(screen.stream())).toEqual(stream)
  })

  it('carries the name of each card, and names the one shown without a name', () => {
    const { screen } = setup()
    showAll(screen, [
      ['Weather', 'a', 't1', 'Weather'],
      ['Summary', 'a', 't1']
    ])
    expect(screen.cards('a').map((view) => view.card)).toEqual(['main', 'weather'])
  })

  it.each<[string, unknown, string | undefined]>([
    ['the main card of the row', 'two-thirds', 'two-thirds'],
    ['one that supports it', 'third', 'third'],
    ['a table across the row', 'full', 'full'],
    ['a card that says none, to share the row evenly', undefined, undefined]
  ])('carries the width of %s, after a restart too', (_case, width, carried) => {
    const records = memoryRecords()
    const { screen, events } = setup(records)
    expect(screen.show({ title: 'Weather', card: 'weather', ...(width === undefined ? {} : { width }), view: EXAMPLE_VIEW }, onStage()).ok).toBe(true)
    expect(events.map((event) => (event.name === 'view.shown' ? event.view.width : 'none'))).toEqual([carried])
    expect(setup(records).screen.current()?.width).toBe(carried)
  })

  it('refuses a width it does not know, naming those it does', () => {
    const { screen } = setup()
    expect(screen.show({ title: 'Weather', width: 'quarter', view: EXAMPLE_VIEW }, onStage())).toEqual({
      ok: false,
      text: "Give a title, in a few words, and a view; a card's name is a word or two, its width one of third, half, two-thirds, full."
    })
  })

  it("refuses a fifth card, naming the four, and still takes one of them shown again, or the core's own card", () => {
    const { screen, events } = setup()
    showAll(screen, [
      ['Weather', 'a', 't1', 'weather'],
      ['Chart', 'a', 't1', 'chart'],
      ['Map', 'a', 't1', 'map'],
      ['News', 'a', 't1', 'news']
    ])
    const refused = screen.show({ title: 'Rates', card: 'rates', view: EXAMPLE_VIEW }, onStage())
    expect(refused).toEqual({
      ok: false,
      text: 'Not shown: an answer shows 4 cards at most, and yours shows news, map, chart, weather. Show it under one of these names to replace that card, or remove one with ui_clear first.'
    })
    expect(events).toHaveLength(4)
    expect(screen.show({ title: 'Map, closer', card: 'map', view: EXAMPLE_VIEW }, onStage()).ok).toBe(true)
    const checked = validateView(EXAMPLE_VIEW)
    if (!checked.ok) throw new Error('The example view is valid.')
    expect(screen.present({ title: 'Waiting for you', spec: checked.spec }, onStage()).ok).toBe(true)
    expect(titles(screen.cards('a'))).toEqual(['Waiting for you', 'Map, closer', 'News', 'Chart', 'Weather'])
    // The next answer starts again.
    expect(screen.show({ title: 'Rates', card: 'rates', view: EXAMPLE_VIEW }, onStage('a', 't2')).ok).toBe(true)
    expect(titles(screen.cards('a'))).toEqual(['Rates'])
  })

  it('clears every card on the stage, or one, wherever it is', () => {
    const { screen, events } = setup()
    showAll(screen, [
      ['Weather', 'a', 't1', 'weather'],
      ['Chart', 'a', 't1', 'chart'],
      ['Map', 'a', 't1', 'map']
    ])
    screen.clear('view-2')
    expect(titles(screen.cards(undefined))).toEqual(['Map', 'Weather'])
    screen.clear()
    expect(screen.cards(undefined)).toEqual([])
    expect(screen.cards('a')).toEqual([])
    expect(screen.stream()).toEqual([])
    expect(events.filter((event) => event.name === 'view.cleared')).toHaveLength(3)
  })

  it('keeps the cards of a topic in the background, and brings them back together, in the order they were shown', () => {
    const { screen, events } = setup()
    screen.show(shown('Recipe'), onStage('recipe'))
    for (const card of ['Weather', 'Chart']) screen.show({ title: card, card, view: EXAMPLE_VIEW }, { thread: 'b', turn: 't2', focused: false })
    expect(titles(screen.cards(undefined))).toEqual(['Recipe'])
    expect(titles(screen.cards('b'))).toEqual(['Chart', 'Weather'])

    screen.focus('b')
    expect(titles(screen.cards(undefined))).toEqual(['Chart', 'Weather'])
    expect(titles(screen.stream())).toEqual(['Chart', 'Weather', 'Recipe'])
    screen.focus('b')
    expect(events.map((event) => (event.name === 'view.shown' ? event.view.title : event.name))).toEqual(['Recipe', 'Weather', 'Chart'])
  })

  it('shows the same cards after a restart, and the answer goes on from them', () => {
    const records = memoryRecords()
    const before = setup(records).screen
    showAll(before, [
      ['Weather', 'a', 't1', 'weather'],
      ['Chart', 'a', 't1', 'chart'],
      ['Map', 'a', 't1', 'map'],
      ['Draft', 'b', 't2'],
      ['Cities', 'b', 't2']
    ])
    before.clear('view-3')

    const after = createScreen({ records, newId: () => 'later' })
    expect(titles(after.cards(undefined))).toEqual(['Cities'])
    expect(after.cards(undefined)[0]?.card).toBe('main')
    expect(titles(after.cards('a'))).toEqual(['Chart', 'Weather'])
    expect(titles(after.stream())).toEqual(['Cities', 'Chart', 'Weather'])
    after.focus('a')
    expect(titles(after.stream())).toEqual(['Chart', 'Weather', 'Cities'])
    expect(after.show({ title: 'Weather, again', card: 'weather', view: EXAMPLE_VIEW }, onStage('a', 't1')).ok).toBe(true)
    expect(titles(after.cards(undefined))).toEqual(['Weather, again', 'Chart'])
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
