import { EXAMPLE_VIEW } from '@repo/catalog'
import { type Event, pinnedBySide, pinnedInOrder } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { ERASURE } from '../ports/records.ts'
import { memoryRecords } from '../records/memory.ts'
import { createScreen, type Showing } from '../views/screen.ts'
import { createLibrary, type Library, summary, WIDGET } from './library.ts'

const onStage: Showing = { thread: 'a', turn: 't1', focused: true }

const player = (title: string, url: string) => ({
  root: 'all',
  elements: {
    all: { type: 'Stack', props: {}, children: ['name', 'play'] },
    name: { type: 'Heading', props: { text: title, level: 1 } },
    play: { type: 'Media', props: { url, title, live: true } }
  }
})

function setup(records = memoryRecords()) {
  let ids = 0
  let clock = Date.parse('2026-11-17T08:00:00Z')
  const newId = () => `id-${++ids}`
  const now = () => {
    clock += 60_000
    return new Date(clock)
  }
  const screen = createScreen({ records, newId })
  const library = createLibrary({ records, screen, now, newId })
  const events: Event[] = []
  library.onEvent((event) => events.push(event))
  /** Show a view as a thread would, and give back its identifier. */
  const shown = (title: string, view: unknown = EXAMPLE_VIEW) => {
    screen.show({ title, view }, onStage)
    return screen.current()?.id ?? ''
  }
  return { records, screen, library, events, shown }
}

/** A way to save a view and pin it in one step, giving back the widget's identifier. */
const pinner = (library: Library, shown: (title: string) => string) => (title: string) => {
  const saved = library.save({ view: shown(title) })
  if (!saved.ok) throw new Error('Not saved.')
  library.update({ widget: saved.widget.id, pinned: true })
  return saved.widget.id
}

/** The identifiers of the pinned widgets in each dock, from its top. */
const docks = (library: Library) => {
  const { left, right } = pinnedBySide(library.read().widgets)
  return { left: left.map((widget) => widget.id), right: right.map((widget) => widget.id) }
}

describe('the library', () => {
  it('saves a view as a widget, and saving it again gives back the same widget', () => {
    const { library, shown, events } = setup()
    const view = shown('Lyon this week')
    const saved = library.save({ view, collection: 'Weather' })
    if (!saved.ok) throw new Error('Not saved.')
    expect(saved.widget).toMatchObject({ title: 'Lyon this week', collection: 'Weather', pinned: false, from: view })
    expect(library.save({ view })).toMatchObject({ ok: true, widget: { id: saved.widget.id } })
    expect(library.read().widgets).toHaveLength(1)
    expect(events).toHaveLength(1)
  })

  it('refuses a view that does not exist', () => {
    expect(setup().library.save({ view: 'nothing' })).toMatchObject({ ok: false, error: { code: 'unknown-widget' } })
  })

  it('keeps each change as a new version, and reads the latest one back after a restart', () => {
    const { records, library, shown } = setup()
    const saved = library.save({ view: shown('Lyon') })
    if (!saved.ok) throw new Error('Not saved.')
    const id = saved.widget.id
    library.update({ widget: id, title: 'Lyon, the week', collection: 'Weather', pinned: true })
    library.update({ widget: id, collection: null })

    expect(records.read([WIDGET])).toHaveLength(3)
    const again = setup(records).library.get(id)
    expect(again).toMatchObject({ title: 'Lyon, the week', pinned: true, since: saved.widget.since })
    expect(again?.collection).toBeUndefined()
    expect(again?.pinnedAt).toBeDefined()
  })

  it('keeps the moment a widget was pinned while it stays pinned, so pinned widgets keep their order', () => {
    const { library, shown } = setup()
    const saved = library.save({ view: shown('Lyon') })
    if (!saved.ok) throw new Error('Not saved.')
    library.update({ widget: saved.widget.id, pinned: true })
    const pinnedAt = library.get(saved.widget.id)?.pinnedAt
    library.update({ widget: saved.widget.id, title: 'Renamed' })
    expect(library.get(saved.widget.id)?.pinnedAt).toBe(pinnedAt)
    library.update({ widget: saved.widget.id, pinned: false })
    expect(library.get(saved.widget.id)?.pinnedAt).toBeUndefined()
  })

  it('puts a widget just pinned on top of the dock that holds fewer, the right one when both hold as many', () => {
    const { library, shown } = setup()
    const pin = pinner(library, shown)
    const radio = pin('Radio')
    const weather = pin('Weather')
    const plan = pin('Plan')
    const map = pin('Map')
    expect(docks(library)).toEqual({ left: [map, weather], right: [plan, radio] })
    expect(pinnedInOrder(library.read().widgets).map((widget) => widget.id)).toEqual([map, weather, plan, radio])

    // Unpinned, a widget leaves its dock; pinned again, it goes on top of the dock that now holds fewer.
    library.update({ widget: radio, pinned: false })
    expect(library.get(radio)).toMatchObject({ pinned: false })
    expect(library.get(radio)?.side).toBeUndefined()
    expect(library.get(radio)?.place).toBeUndefined()
    library.update({ widget: map, pinned: false })
    library.update({ widget: radio, pinned: true })
    expect(docks(library)).toEqual({ left: [weather], right: [radio, plan] })
  })

  it('keeps the docks and the order the user drags widgets into, across a restart', () => {
    const { records, library, shown, events } = setup()
    const pin = pinner(library, shown)
    const [radio, weather, plan, map] = [pin('Radio'), pin('Weather'), pin('Plan'), pin('Map')]
    expect(docks(library)).toEqual({ left: [map, weather], right: [plan, radio] })

    const before = records.read([WIDGET]).length
    const told = events.length
    // The radio crosses to the top of the left dock, the map goes under the weather.
    expect(library.arrange({ left: [radio, weather, map], right: [plan] })).toMatchObject({ ok: true })
    expect(docks(library)).toEqual({ left: [radio, weather, map], right: [plan] })
    expect(library.get(radio)).toMatchObject({ side: 'left', place: 0 })
    // Every place changed, so each got a version, and clients were told once.
    expect(records.read([WIDGET]).length - before).toBe(4)
    expect(events.length - told).toBe(1)

    // The same docks again write nothing.
    library.arrange({ left: [radio, weather, map], right: [plan] })
    expect(records.read([WIDGET]).length - before).toBe(4)
    expect(events.length - told).toBe(1)

    // A widget left out keeps its dock, after those listed there; an unknown one is ignored, and one named twice
    // goes where it is first named.
    library.arrange({ left: [map, 'nothing'], right: [weather, plan, map] })
    expect(docks(library)).toEqual({ left: [map, radio], right: [weather, plan] })

    expect(docks(setup(records).library)).toEqual({ left: [map, radio], right: [weather, plan] })
  })

  it('reads widgets pinned before there were two docks on the right, in the order they had', () => {
    const { records } = setup()
    const spec = { root: 'all', elements: { all: { type: 'Divider', props: {}, children: [] } } }
    const old = (widget: string, more: object) => ({ widget, title: widget, since: '2026-11-01T00:00:00Z', spec, ...more })
    // As the previous version kept them: a place from dragging, or none and only the moment they were pinned.
    records.append([
      { type: WIDGET, payload: old('radio', { pinned: true, pinnedAt: '2026-11-02T00:00:00Z', place: 1 }) },
      { type: WIDGET, payload: old('plan', { pinned: true, pinnedAt: '2026-11-03T00:00:00Z', place: 0 }) },
      { type: WIDGET, payload: old('news', { pinned: true, pinnedAt: '2026-11-04T00:00:00Z' }) },
      { type: WIDGET, payload: old('song', { pinned: false }) }
    ])
    const { library } = setup(records)
    expect(docks(library)).toEqual({ left: [], right: ['plan', 'radio', 'news'] })
    expect(library.get('radio')?.side).toBe('right')
    expect(library.get('song')?.side).toBeUndefined()
    // The next widget pinned balances the docks.
    library.update({ widget: 'song', pinned: true })
    expect(docks(library)).toEqual({ left: ['song'], right: ['plan', 'radio', 'news'] })
  })

  it('erases every version of a deleted widget', () => {
    const { records, library, shown } = setup()
    const saved = library.save({ view: shown('Lyon') })
    if (!saved.ok) throw new Error('Not saved.')
    library.update({ widget: saved.widget.id, title: 'Lyon again' })
    expect(library.remove(saved.widget.id)).toMatchObject({ ok: true, library: { widgets: [] } })

    expect(records.read([WIDGET]).map((record) => record.payload)).toEqual([null, null])
    expect(records.read([ERASURE])).toHaveLength(1)
    expect(setup(records).library.read().widgets).toEqual([])
    expect(library.remove(saved.widget.id)).toMatchObject({ ok: false, error: { code: 'unknown-widget' } })
  })

  it('finds widgets by their title first, then by what they show, a station by the words of its address', () => {
    const { library, shown } = setup()
    for (const [title, url] of [
      ['Morning news', 'https://example.org/news.mp3'],
      ['Radio FIP', 'https://icecast.radiofrance.fr/fip-hifi.aac'],
      ['Jazz', 'https://example.org/radio-jazz.aac']
    ] as const) {
      library.save({ view: shown(title, player(title, url)) })
    }
    expect(library.search('I want to listen to the radio again').map((widget) => widget.title)).toEqual(['Radio FIP', 'Jazz'])
    expect(library.search('fip').map((widget) => widget.title)).toEqual(['Radio FIP'])
    expect(library.search('nothing like that')).toEqual([])
    expect(library.search('')).toHaveLength(3)
  })

  it('shows a saved widget as it was saved, marked as that widget', () => {
    const { screen, library, shown } = setup()
    const saved = library.save({ view: shown('Radio FIP', player('Radio FIP', 'https://icecast.radiofrance.fr/fip-hifi.aac')) })
    if (!saved.ok) throw new Error('Not saved.')
    screen.clear()

    expect(library.show(saved.widget.id, onStage)).toEqual({ ok: true, text: 'Shown.' })
    expect(screen.current()).toMatchObject({ title: 'Radio FIP', widget: saved.widget.id, spec: saved.widget.spec })
    expect(library.show('nothing', onStage).ok).toBe(false)
  })

  it('checks a saved widget against the catalogue again before showing it', () => {
    const { records } = setup()
    const spec = { root: 'all', elements: { all: { type: 'Gone', props: {}, children: [] } } }
    records.append([{ type: WIDGET, payload: { widget: 'old', title: 'Old', pinned: false, since: '2026-01-01T00:00:00Z', spec } }])
    const reread = setup(records).library
    expect(reread.get('old')).toBeDefined()
    const result = reread.show('old', onStage)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no longer fits the blocks there are')
  })

  it('tells sessions what is saved, each widget in a few words', () => {
    const { library, shown } = setup()
    expect(library.standing('thread')).toBeUndefined()
    const saved = library.save({ view: shown('Radio FIP', player('Radio FIP', 'https://icecast.radiofrance.fr/fip-hifi.aac')), collection: 'Music' })
    if (!saved.ok) throw new Error('Not saved.')
    expect(library.standing('thread')).toContain(`- [${saved.widget.id}] "Radio FIP" in Music: plays "Radio FIP" (live); "Radio FIP"; Heading, Media`)
    expect(library.standing('orchestrator')).toContain('pass the request to a thread and name the saved widget')
    expect(summary(saved.widget.spec)).toBe('plays "Radio FIP" (live); "Radio FIP"; Heading, Media')
  })
})
