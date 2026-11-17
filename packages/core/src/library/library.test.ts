import { EXAMPLE_VIEW } from '@repo/catalog'
import { type Event, pinnedInOrder } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { ERASURE } from '../ports/records.ts'
import { memoryRecords } from '../records/memory.ts'
import { createScreen, type Showing } from '../views/screen.ts'
import { createLibrary, summary, WIDGET } from './library.ts'

const onStage: Showing = { thread: 'a', turn: 't1', slot: 'stage', focused: true }

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

  it('puts a widget just pinned on top of the stack, and keeps the order the user drags them into', () => {
    const { records, library, shown, events } = setup()
    const pin = (title: string) => {
      const saved = library.save({ view: shown(title) })
      if (!saved.ok) throw new Error('Not saved.')
      library.update({ widget: saved.widget.id, pinned: true })
      return saved.widget.id
    }
    const radio = pin('Radio')
    const weather = pin('Weather')
    const plan = pin('Plan')
    const order = () => pinnedInOrder(library.read().widgets).map((widget) => widget.id)
    expect(order()).toEqual([plan, weather, radio])

    const before = records.read([WIDGET]).length
    const told = events.length
    expect(library.arrange({ pinned: [radio, plan, weather] })).toMatchObject({ ok: true })
    expect(order()).toEqual([radio, plan, weather])
    // Every place changed, so each got a version, and clients were told once.
    expect(records.read([WIDGET]).length - before).toBe(3)
    expect(events.length - told).toBe(1)

    // The same order again writes nothing; a widget left out keeps its place after those listed; an unknown one is ignored.
    library.arrange({ pinned: [radio, plan, weather] })
    expect(records.read([WIDGET]).length - before).toBe(3)
    library.arrange({ pinned: [plan, 'nothing'] })
    expect(order()).toEqual([plan, radio, weather])

    // Unpinned, a widget leaves the stack; pinned again, it comes back on top. The order outlives a restart.
    library.update({ widget: weather, pinned: false })
    expect(library.get(weather)?.place).toBeUndefined()
    library.update({ widget: weather, pinned: true })
    expect(order()).toEqual([weather, plan, radio])
    expect(pinnedInOrder(setup(records).library.read().widgets).map((widget) => widget.id)).toEqual([weather, plan, radio])
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
