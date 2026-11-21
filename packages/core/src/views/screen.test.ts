import { EXAMPLE_VIEW, validateView } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { reminderCard } from '../schedule/words.ts'
import { createScreen, type Showing, VIEW_CLEARED, VIEW_SHOWN } from './screen.ts'

function setup(records = memoryRecords()) {
  let ids = 0
  const screen = createScreen({ records, newId: () => `view-${++ids}` })
  const events: Event[] = []
  screen.onEvent((event) => events.push(event))
  return { screen, events, records }
}

const answering = (thread = 'a', turn = 't1'): Showing => ({ thread, turn })
const shown = (title: string) => ({ title, view: EXAMPLE_VIEW })
const titles = (views: readonly { title: string }[] | undefined) => views?.map((view) => view.title)
const checked = () => {
  const view = validateView(EXAMPLE_VIEW)
  if (!view.ok) throw new Error('The example view is valid.')
  return view.spec
}

describe('the screen', () => {
  it('shows a valid view as a card of the answer its thread is giving', () => {
    const { screen, events } = setup()
    expect(screen.show(shown('Budget'), answering())).toEqual({ ok: true, text: 'Shown.' })
    expect(screen.of(['t1']).get('t1')).toMatchObject([{ id: 'view-1', title: 'Budget', thread: 'a', turn: 't1' }])
    expect(events).toMatchObject([{ name: 'view.shown', view: { id: 'view-1' } }])
  })

  it('shows nothing for an invalid view, and lists what to correct', () => {
    const { screen, events } = setup()
    const result = screen.show({ title: 'Broken', view: { root: 'gone', elements: {} } }, answering())
    expect(result.ok).toBe(false)
    expect(result.text).toContain('Correct this')
    expect(screen.has('t1')).toBe(false)
    expect(events).toEqual([])
  })

  it('asks for a title', () => {
    expect(setup().screen.show({ view: EXAMPLE_VIEW }, answering()).ok).toBe(false)
  })

  it('shows at once what a thread shows while the person is on something else', () => {
    const { screen, events } = setup()
    screen.show(shown('Trip'), answering('a', 't1'))
    expect(screen.show(shown('Build'), answering('b', 't2'))).toEqual({ ok: true, text: 'Shown.' })
    expect(events.map((event) => event.name)).toEqual(['view.shown', 'view.shown'])
  })

  it('keeps the cards of every answer, each read when asked for', () => {
    const { screen } = setup()
    screen.show(shown('Trip'), answering('a', 't1'))
    screen.show(shown('Trip, by train'), answering('a', 't2'))
    screen.show(shown('Build'), answering('b', 't3'))
    const cards = screen.of(['t1', 't2', 'never'])
    expect([...cards.keys()]).toEqual(['t1', 't2'])
    expect(titles(cards.get('t1'))).toEqual(['Trip'])
    expect(titles(cards.get('t2'))).toEqual(['Trip, by train'])
    // A thread's cards are those of the answer it last showed something in.
    expect(titles(screen.cards('a'))).toEqual(['Trip, by train'])
    expect(titles(screen.cards('b'))).toEqual(['Build'])
    expect(screen.cards('nobody')).toEqual([])
  })

  it('removes a card from its answer for good, and says so once', () => {
    const { screen, events, records } = setup()
    screen.show({ ...shown('Weather'), card: 'weather' }, answering())
    screen.show({ ...shown('Chart'), card: 'chart' }, answering())
    events.length = 0
    screen.clear('view-1')
    screen.clear('view-1')
    screen.clear('unknown')
    expect(events).toEqual([{ type: 'event', name: 'view.cleared', view: 'view-1' }])
    expect(titles(screen.of(['t1']).get('t1'))).toEqual(['Chart'])
    expect(titles(setup(records).screen.of(['t1']).get('t1'))).toEqual(['Chart'])
    screen.clear('view-2')
    expect(screen.has('t1')).toBe(false)
  })

  it('finds a view by its identifier, one removed too', () => {
    const { screen } = setup()
    screen.show(shown('Budget'), answering())
    screen.clear('view-1')
    expect(screen.find('view-1')?.title).toBe('Budget')
    expect(screen.find('unknown')).toBeUndefined()
  })

  it('files what is shown outside a turn as an answer of its own: a saved widget one answer however often it is shown', () => {
    const { screen } = setup()
    const nobody: Showing = { thread: undefined, turn: undefined }
    screen.present({ title: 'Radio', spec: checked(), widget: 'radio' }, nobody)
    screen.present({ title: 'Radio, tuned', spec: checked(), widget: 'radio' }, nobody)
    screen.present({ title: 'A note', spec: checked() }, nobody)
    expect(titles(screen.of(['radio']).get('radio'))).toEqual(['Radio, tuned'])
    expect(titles(screen.of(['view-3']).get('view-3'))).toEqual(['A note'])
  })

  it('moves a card brought up to date in a later turn to that answer', () => {
    const { screen } = setup()
    screen.present({ id: 'files', title: 'Written', spec: checked() }, answering('a', 't1'))
    screen.present({ id: 'files', title: 'Written, more', spec: checked() }, answering('a', 't2'))
    expect(screen.has('t1')).toBe(false)
    expect(titles(screen.of(['t2']).get('t2'))).toEqual(['Written, more'])
  })

  it('is as it was after a restart', () => {
    const records = memoryRecords()
    const { screen } = setup(records)
    screen.show({ ...shown('Weather'), card: 'weather' }, answering('a', 't1'))
    screen.show({ ...shown('Chart'), card: 'chart' }, answering('a', 't1'))
    screen.show(shown('Cities'), answering('b', 't2'))
    const after = setup(records).screen
    expect(titles(after.of(['t1']).get('t1'))).toEqual(['Weather', 'Chart'])
    expect(titles(after.cards('b'))).toEqual(['Cities'])
    // The answer goes on from its cards.
    expect(after.show({ ...shown('Weather, again'), card: 'weather' }, answering('a', 't1')).ok).toBe(true)
    expect(titles(after.cards('a'))).toEqual(['Weather, again', 'Chart'])
  })

  it('keeps what side questions showed before answers were kept for good, though it left the screen of the time', () => {
    const records = memoryRecords()
    const view = { title: 'Montreal', thread: 'side', turn: 't2', spec: checked() }
    records.append([
      { type: VIEW_SHOWN, payload: { ...view, id: 'aside', aside: true } },
      { type: VIEW_CLEARED, payload: { view: 'aside' } },
      { type: VIEW_SHOWN, payload: { ...view, id: 'margin', turn: 't3', slot: 'margin' } },
      { type: VIEW_CLEARED, payload: { view: 'margin' } },
      { type: VIEW_SHOWN, payload: { ...view, id: 'closed', turn: 't4' } },
      { type: VIEW_CLEARED, payload: { view: 'closed' } },
      // A clearing that named no view emptied the stage of the time.
      { type: VIEW_SHOWN, payload: { ...view, id: 'staged', turn: 't5' } },
      { type: VIEW_CLEARED, payload: {} }
    ])
    const { screen } = setup(records)
    expect([screen.has('t2'), screen.has('t3'), screen.has('t4'), screen.has('t5')]).toEqual([true, true, false, true])
  })
})

describe('the cards of an answer', () => {
  /** A card shown: its title, the thread and turn that show it, and the name it is given, if any. */
  type Shown = [title: string, thread: string, turn: string, card?: string]
  const showAll = (screen: ReturnType<typeof setup>['screen'], cards: readonly Shown[]) =>
    cards.map(([title, thread, turn, card]) => screen.show({ title, ...(card === undefined ? {} : { card }), view: EXAMPLE_VIEW }, answering(thread, turn)))

  it.each<[string, Shown[], string[]]>([
    [
      'a new name goes beside the cards of the answer',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Chart', 'a', 't1', 'chart']
      ],
      ['Weather', 'Chart']
    ],
    [
      'the same name replaces that card, where it stands',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Chart', 'a', 't1', 'chart'],
        ['Weather, again', 'a', 't1', 'weather']
      ],
      ['Weather, again', 'Chart']
    ],
    [
      'names that differ only in case are one',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Weather, again', 'a', 't1', ' Weather ']
      ],
      ['Weather, again']
    ],
    [
      'without a name, each call replaces the one card',
      [
        ['Draft', 'a', 't1'],
        ['Final', 'a', 't1']
      ],
      ['Final']
    ],
    [
      'without a name, a card goes beside named ones',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Summary', 'a', 't1']
      ],
      ['Weather', 'Summary']
    ],
    [
      'a new turn starts a new answer, and the one before keeps its cards',
      [
        ['Weather', 'a', 't1', 'weather'],
        ['Chart', 'a', 't1', 'chart'],
        ['Rates', 'a', 't2', 'chart']
      ],
      ['Rates']
    ]
  ])('%s', (_case, cards, latest) => {
    const { screen } = setup()
    expect(showAll(screen, cards).every((result) => result.ok)).toBe(true)
    expect(titles(screen.cards('a'))).toEqual(latest)
    expect(titles(screen.of(['t1']).get('t1'))).toEqual(cards.at(-1)?.[2] === 't1' ? latest : ['Weather', 'Chart'])
  })

  it('carries the name of each card, and names the one shown without a name', () => {
    const { screen } = setup()
    showAll(screen, [
      ['Weather', 'a', 't1', 'Weather'],
      ['Summary', 'a', 't1']
    ])
    expect(screen.cards('a').map((view) => view.card)).toEqual(['weather', 'main'])
  })

  it.each<[string, unknown, string | undefined]>([
    ['the main card of the row', 'two-thirds', 'two-thirds'],
    ['one that supports it', 'third', 'third'],
    ['a table across the row', 'full', 'full'],
    ['a card that says none, to share the row evenly', undefined, undefined]
  ])('carries the width of %s, after a restart too', (_case, width, carried) => {
    const records = memoryRecords()
    const { screen, events } = setup(records)
    expect(screen.show({ title: 'Weather', card: 'weather', ...(width === undefined ? {} : { width }), view: EXAMPLE_VIEW }, answering()).ok).toBe(true)
    expect(events.map((event) => (event.name === 'view.shown' ? event.view.width : 'none'))).toEqual([carried])
    expect(setup(records).screen.cards('a')[0]?.width).toBe(carried)
  })

  it('refuses a width it does not know, naming those it does', () => {
    const { screen } = setup()
    expect(screen.show({ title: 'Weather', width: 'quarter', view: EXAMPLE_VIEW }, answering())).toEqual({
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
    const refused = screen.show({ title: 'Rates', card: 'rates', view: EXAMPLE_VIEW }, answering())
    expect(refused).toEqual({
      ok: false,
      text: 'Not shown: an answer shows 4 cards at most, and yours shows weather, chart, map, news. Show it under one of these names to replace that card, or remove one with ui_clear first.'
    })
    expect(events).toHaveLength(4)
    expect(screen.show({ title: 'Map, closer', card: 'map', view: EXAMPLE_VIEW }, answering()).ok).toBe(true)
    expect(screen.present({ title: 'Waiting for you', spec: checked() }, answering()).ok).toBe(true)
    expect(titles(screen.cards('a'))).toEqual(['Weather', 'Chart', 'Map, closer', 'News', 'Waiting for you'])
    // The next answer starts again.
    expect(screen.show({ title: 'Rates', card: 'rates', view: EXAMPLE_VIEW }, answering('a', 't2')).ok).toBe(true)
    expect(titles(screen.cards('a'))).toEqual(['Rates'])
  })
})

describe("a reminder's card", () => {
  it('names its reminder, so it can be snoozed from it, after a restart too', () => {
    const { screen, records } = setup()
    screen.present(reminderCard('Feed the cat', '14:15', 'job-1'), { thread: undefined, turn: 't1' })
    expect(screen.of(['t1']).get('t1')).toMatchObject([{ title: 'Reminder', reminder: 'job-1' }])
    expect(setup(records).screen.of(['t1']).get('t1')?.[0]?.reminder).toBe('job-1')
  })
})
