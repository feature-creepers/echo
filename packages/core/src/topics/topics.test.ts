import { EXAMPLE_VIEW, validateView } from '@repo/catalog'
import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createThreadRegistry, THREAD } from '../threads/registry.ts'
import { createScreen } from '../views/screen.ts'
import { createTopics } from './topics.ts'

/** A core's topics over records, with a clock that moves a minute at each look, so every answer has its own time. */
function setup(records = memoryRecords(), lines: Exchange[] = []) {
  let ids = 0
  let minutes = 0
  const now = () => new Date(Date.UTC(2026, 10, 22, 9, minutes++))
  const newId = () => `id-${++ids}`
  const registry = createThreadRegistry({ records, now, newId })
  const screen = createScreen({ records, newId })
  const topics = createTopics({ records, registry, screen, lines: () => lines, now, newId })
  const events: Extract<Event, { name: 'topics.changed' }>[] = []
  topics.onEvent((event) => event.name === 'topics.changed' && events.push(event))

  /** Open a thread, in a topic given or a new one named as it is. */
  const thread = (title: string, topic?: string) => registry.open({ title, kind: 'topic', topic: topic ?? topics.open(title) })
  /** The person says something, and it is passed to a thread. */
  const ask = (said: string, to: string, more: Partial<Exchange> = {}) => {
    const line: Exchange = { turn: newId(), at: now().toISOString(), persona: 'one', thread: to, said, replied: `About ${said}.`, outcome: 'done', ...more }
    lines.push(line)
    topics.answered(line)
    return line.turn
  }
  const spec = () => {
    const view = validateView(EXAMPLE_VIEW)
    if (!view.ok) throw new Error('The example view is valid.')
    return view.spec
  }
  const titles = () => topics.read({ limit: 50 }).topics.map((one) => one.topic.title)
  const asked = (topic: string) => topics.answers(topic, { limit: 20 })?.answers.map((answer) => answer.exchange?.said ?? answer.views[0]?.title)
  return { records, lines, registry, screen, topics, events, thread, ask, spec, titles, asked, again: () => setup(records, lines) }
}

describe('a topic', () => {
  it('gathers the answers of every thread that works on it, each one a version of it', () => {
    const { topics, thread, ask, screen, asked, titles, again } = setup()
    const weather = thread('Camping this weekend')
    const topic = topics.of(weather.id) as string
    const gear = thread('What to pack', topic)
    const first = ask('weather this weekend?', weather.id)
    screen.show({ title: 'Forecast', view: EXAMPLE_VIEW }, { thread: weather.id, turn: first })
    ask('what should I pack?', gear.id)
    ask('and if it rains?', weather.id)

    expect(titles()).toEqual(['Camping this weekend'])
    expect(topics.get(topic)).toMatchObject({ title: 'Camping this weekend', answers: 3 })
    expect(asked(topic)).toEqual(['and if it rains?', 'what should I pack?', 'weather this weekend?'])
    expect(topics.answers(topic, { limit: 20 })?.answers.at(-1)).toMatchObject({ id: first, views: [{ title: 'Forecast' }] })
    // Nothing is written for it: after a restart it is read from the conversation again.
    expect(again().asked(topic)).toEqual(['and if it rains?', 'what should I pack?', 'weather this weekend?'])
  })

  it('is the thread itself for a thread recorded before there were topics', () => {
    const records = memoryRecords()
    records.append([{ type: THREAD, payload: { id: 'old', title: 'Lisbon trip', kind: 'topic', state: 'parked', at: '2026-11-18T08:00:00.000Z' } }])
    const line: Exchange = { turn: 't1', at: '2026-11-18T08:00:00.000Z', persona: 'one', thread: 'old', said: 'plan Lisbon', replied: 'Here.', outcome: 'done' }
    const { topics, titles } = setup(records, [line])
    expect(topics.of('old')).toBe('old')
    expect(titles()).toEqual(['Lisbon trip'])
    expect(topics.get('old')).toEqual({ id: 'old', title: 'Lisbon trip', at: '2026-11-18T08:00:00.000Z', answers: 1 })
  })

  it("takes a sub-thread's topic from its thread, and none of its lines as answers", () => {
    const { topics, registry, thread, ask, asked } = setup()
    const trip = thread('Lisbon trip')
    const flights = registry.open({ title: 'Flights', kind: 'subthread', parent: trip.id })
    ask('plan Lisbon', trip.id)
    ask('find the flights', flights.id, { trigger: 'delegated' })
    expect(topics.of(flights.id)).toBe(topics.of(trip.id))
    expect(asked(topics.of(trip.id) as string)).toEqual(['plan Lisbon'])
  })

  it('is listed the one last active first, a page at a time, and comes back to the top when asked for again', () => {
    const context = setup()
    const { topics, thread, ask, titles } = context
    const { registry } = context
    const threads = ['Taxes', 'Garden', 'Radio'].map((title) => thread(title))
    for (const one of threads) {
      ask(`about ${one.title}`, one.id)
      registry.setState(one.id, 'parked')
    }
    expect(titles()).toEqual(['Radio', 'Garden', 'Taxes'])

    const first = topics.read({ limit: 2 })
    expect(first.topics.map((one) => one.topic.title)).toEqual(['Radio', 'Garden'])
    expect(first.next).toBe(first.topics.at(-1)?.topic.at)
    const rest = topics.read({ limit: 2, before: first.next })
    expect(rest.topics.map((one) => one.topic.title)).toEqual(['Taxes'])
    expect(rest.next).toBeUndefined()

    ask('more about taxes', threads[0]?.id as string)
    expect(titles()).toEqual(['Taxes', 'Radio', 'Garden'])
    topics.touch(topics.of(threads[1]?.id as string) as string)
    expect(titles()).toEqual(['Garden', 'Taxes', 'Radio'])
  })

  it('gives its answers the latest first, a page at a time', () => {
    const { topics, thread, ask } = setup()
    const taxes = thread('Taxes')
    const turns = ['one', 'two', 'three', 'four', 'five'].map((said) => ask(said, taxes.id))
    const topic = topics.of(taxes.id) as string
    const latest = topics.answers(topic, { limit: 2 })
    expect(latest?.answers.map((answer) => answer.exchange?.said)).toEqual(['five', 'four'])
    expect(latest?.more).toBe(true)
    const earlier = topics.answers(topic, { limit: 3, before: turns[3] })
    expect(earlier?.answers.map((answer) => answer.exchange?.said)).toEqual(['three', 'two', 'one'])
    expect(earlier?.more).toBe(false)
    expect(topics.answers('nowhere', { limit: 2 })).toBeUndefined()
  })

  it('tells of each change with the topic and its latest answer', () => {
    const { topics, thread, ask, events } = setup()
    const taxes = thread('Taxes')
    ask('how much do I owe?', taxes.id)
    expect(events).toMatchObject([
      { topics: [{ topic: { title: 'Taxes', answers: 1 }, answers: [{ exchange: { said: 'how much do I owe?' }, views: [] }] }], gone: [] }
    ])
    topics.rename(topics.of(taxes.id) as string, 'Taxes 2026')
    expect(events.at(-1)?.topics[0]?.topic.title).toBe('Taxes 2026')
  })
})

describe('what the person corrects', () => {
  it('is kept: a name, a topic put away, which work brings back', () => {
    const { topics, thread, ask, titles, again } = setup()
    const taxes = thread('Taxes')
    ask('how much do I owe?', taxes.id)
    const topic = topics.of(taxes.id) as string
    expect(topics.rename(topic, 'Taxes 2026')).toBe(true)
    expect(topics.archive(topic, true)).toBe(true)
    expect(titles()).toEqual([])
    expect(topics.read({ limit: 5, archived: true }).topics.map((one) => one.topic.title)).toEqual(['Taxes 2026'])
    expect(again().topics.get(topic)).toMatchObject({ title: 'Taxes 2026', archived: true })

    ask('and next year?', taxes.id)
    expect(titles()).toEqual(['Taxes 2026'])
    expect(again().titles()).toEqual(['Taxes 2026'])
    expect([topics.rename('nowhere', 'x'), topics.archive('nowhere', true)]).toEqual([false, false])
  })

  it('moves an answer to another topic, or to a new one, and the one left with nothing is gone', () => {
    const { topics, thread, ask, asked, titles, events, again } = setup()
    const taxes = thread('Taxes')
    const garden = thread('Garden')
    ask('how much do I owe?', taxes.id)
    const stray = ask('when do I prune roses?', taxes.id)
    ask('what to plant in May?', garden.id)
    const [from, to] = [topics.of(taxes.id) as string, topics.of(garden.id) as string]

    expect(topics.move(stray, { topic: to })).toBe(to)
    expect(asked(from)).toEqual(['how much do I owe?'])
    expect(asked(to)).toEqual(['what to plant in May?', 'when do I prune roses?'])

    const roses = topics.move(stray, { title: 'Roses' }) as string
    expect(titles()).toEqual(['Garden', 'Roses', 'Taxes'])
    expect(again().asked(roses)).toEqual(['when do I prune roses?'])

    // The thread it came from still files what it answers next in its own topic.
    ask('and the deadline?', taxes.id)
    expect(asked(from)).toEqual(['and the deadline?', 'how much do I owe?'])

    events.length = 0
    expect(topics.move(stray, { topic: to })).toBe(to)
    expect(events.at(-1)).toMatchObject({ topics: [{ topic: { id: to } }], gone: [roses] })
    expect([topics.move('nothing', { topic: to }), topics.move(stray, { topic: 'nowhere' })]).toEqual([undefined, undefined])
  })

  it('merges a topic into another, with what its threads answer next', () => {
    const { topics, thread, ask, asked, titles, events, again } = setup()
    const weather = thread('Weather this weekend')
    const camping = thread('Camping')
    ask('weather this weekend?', weather.id)
    ask('where to camp?', camping.id)
    const [from, into] = [topics.of(weather.id) as string, topics.of(camping.id) as string]

    expect(topics.merge(from, into)).toBe(true)
    expect(events.at(-1)).toMatchObject({ topics: [{ topic: { id: into, answers: 2 } }], gone: [from] })
    ask('and on Sunday?', weather.id)
    expect(titles()).toEqual(['Camping'])
    expect(asked(into)).toEqual(['and on Sunday?', 'where to camp?', 'weather this weekend?'])
    expect(again().asked(into)).toEqual(['and on Sunday?', 'where to camp?', 'weather this weekend?'])
    expect([topics.merge(into, into), topics.merge('nowhere', into)]).toEqual([false, false])
  })

  it('keeps, of a line erased from the conversation, the cards it showed, and nothing of one that showed none', () => {
    const { topics, screen, spec, thread, ask, titles, lines, again } = setup()
    const taxes = thread('Taxes')
    const garden = thread('Garden')
    const owed = ask('how much do I owe?', taxes.id)
    const planted = ask('what to plant in May?', garden.id)
    screen.present({ title: 'Owed', spec: spec() }, { thread: taxes.id, turn: owed })
    lines.length = 0
    topics.forget(new Set([owed, planted]))

    expect(titles()).toEqual(['Taxes'])
    expect(topics.read({ limit: 5 }).topics[0]?.answers).toMatchObject([{ id: owed, views: [{ title: 'Owed' }] }])
    expect(topics.read({ limit: 5 }).topics[0]?.answers[0]?.exchange).toBeUndefined()
    // The same after a restart, and until its card is removed.
    expect(again().titles()).toEqual(['Taxes'])
    screen.clear(screen.cards(taxes.id).at(-1)?.id as string)
    expect(titles()).toEqual([])
    expect(again().titles()).toEqual([])
  })

  it('keeps an answer moved into a topic made from a thread recorded before there were topics, after a restart too', () => {
    const records = memoryRecords()
    const old = (id: string, title: string) => ({ type: THREAD, payload: { id, title, kind: 'topic', state: 'parked', at: '2026-11-18T08:00:00.000Z' } })
    records.append([old('k', 'Kitchen'), old('l', 'Lisbon trip')])
    const line = (turn: string, thread: string, hour: string): Exchange => ({
      turn,
      at: `2026-11-18T${hour}:00:00.000Z`,
      persona: 'one',
      thread,
      said: turn,
      replied: 'Here.',
      outcome: 'done'
    })
    // The answer moved was given before any line of the topic it goes to.
    const { topics, asked, again } = setup(records, [line('flights', 'k', '10'), line('plan', 'l', '11')])
    expect(topics.move('flights', { topic: 'l' })).toBe('l')
    expect(asked('l')).toEqual(['plan', 'flights'])
    expect(again().asked('l')).toEqual(['plan', 'flights'])
    expect(again().titles()).toEqual(['Lisbon trip'])
  })
})

describe('what is shown outside any thread', () => {
  it('is a topic of its own, named as it is, for as long as it has a card: a reminder, with its words', () => {
    const { topics, screen, spec, lines, titles, again } = setup()
    lines.push({
      turn: 'ring',
      at: '2026-11-22T08:00:00.000Z',
      persona: 'one',
      said: '',
      trigger: 'reminder',
      replied: 'Time to feed the cat.',
      outcome: 'done'
    })
    screen.present({ title: 'Feed the cat', spec: spec() }, { thread: undefined, turn: 'ring' })
    expect(titles()).toEqual(['Feed the cat'])
    expect(topics.read({ limit: 5 }).topics[0]?.answers[0]).toMatchObject({
      id: 'ring',
      exchange: { trigger: 'reminder' },
      views: [{ title: 'Feed the cat' }]
    })
    expect(again().titles()).toEqual(['Feed the cat'])
    screen.clear(topics.read({ limit: 5 }).topics[0]?.answers[0]?.views[0]?.id as string)
    expect(titles()).toEqual([])
    expect(again().titles()).toEqual([])
  })

  it('is one topic for a saved widget however often it is shown, back on top each time, and gone once its card is closed', () => {
    const { topics, screen, spec, thread, ask, titles, events, again } = setup()
    const nobody = { thread: undefined, turn: undefined }
    screen.present({ title: 'Radio', spec: spec(), widget: 'radio' }, nobody)
    ask('how much do I owe?', thread('Taxes').id)
    expect(titles()).toEqual(['Taxes', 'Radio'])
    screen.present({ title: 'Radio', spec: spec(), widget: 'radio' }, nobody)
    expect(titles()).toEqual(['Radio', 'Taxes'])
    const radio = topics.read({ limit: 5 }).topics[0]
    expect(radio?.topic.answers).toBe(1)
    expect(again().titles()).toEqual(['Radio', 'Taxes'])

    screen.clear(radio?.answers[0]?.views[0]?.id as string)
    expect(events.at(-1)).toMatchObject({ topics: [], gone: [radio?.topic.id] })
    expect(titles()).toEqual(['Taxes'])
    expect(again().titles()).toEqual(['Taxes'])
  })

  it("joins its thread's topic once the line it was shown for is passed on", () => {
    const { topics, screen, spec, thread, lines, asked, titles } = setup()
    const line: Exchange = { turn: 'ask', at: '2026-11-22T08:00:00.000Z', persona: 'one', said: 'work in my thesis folder', replied: '', outcome: 'running' }
    lines.push(line)
    screen.present({ title: 'Waiting for you', spec: spec() }, { thread: undefined, turn: 'ask' })
    expect(titles()).toEqual(['Waiting for you'])
    const thesis = thread('Thesis')
    Object.assign(line, { thread: thesis.id })
    topics.answered(line)
    expect(titles()).toEqual(['Thesis'])
    expect(asked(topics.of(thesis.id) as string)).toEqual(['work in my thesis folder'])
  })

  it('is gone with its card when the line it was shown for is never passed on', () => {
    const { screen, spec, lines, titles, again } = setup()
    lines.push({ turn: 'ask', at: '2026-11-22T08:00:00.000Z', persona: 'one', said: 'work in my thesis folder', replied: 'As you wish.', outcome: 'done' })
    screen.present({ id: 'approval', title: 'Waiting for you', spec: spec() }, { thread: undefined, turn: 'ask' })
    expect(titles()).toEqual(['Waiting for you'])
    screen.clear('approval')
    expect(titles()).toEqual([])
    expect(again().titles()).toEqual([])
  })

  it("is an answer of its thread's topic when a sub-thread shows it, without the sub-thread's request, and gone with it", () => {
    const { topics, registry, screen, thread, ask, lines, events } = setup()
    const taxes = thread('Taxes')
    ask('how much do I owe?', taxes.id)
    const part = registry.open({ title: 'Receipts', kind: 'subthread', parent: taxes.id })
    lines.push({
      turn: 'handed',
      at: '2026-11-22T09:30:00.000Z',
      persona: 'one',
      thread: part.id,
      said: 'read the receipts',
      trigger: 'delegated',
      replied: '',
      outcome: 'running'
    })
    const question = { root: 'q', elements: { q: { type: 'Questions', props: { questions: [] }, children: [] } } }
    screen.present({ id: 'approval', title: 'Waiting for you', spec: question as never }, { thread: part.id, turn: 'handed' })

    const topic = topics.of(taxes.id) as string
    expect(events.at(-1)?.topics[0]).toMatchObject({
      topic: { id: topic, answers: 2, progress: 'asks' },
      answers: [{ id: 'handed', views: [{ id: 'approval' }] }]
    })
    expect(events.at(-1)?.topics[0]?.answers[0]?.exchange).toBeUndefined()
    screen.clear('approval')
    expect(topics.get(topic)).toMatchObject({ answers: 1 })
  })
})

describe('a topic in progress', () => {
  /** A card that asks the person something, as a questionnaire or an approval does. */
  const question = {
    root: 'q',
    elements: { q: { type: 'Questions', props: { questions: [{ options: [{ label: 'Yes' }, { label: 'No' }], other: false }] }, children: [] } }
  }

  it.each<[string, (context: ReturnType<typeof setup>, thread: string) => void, string | undefined]>([
    [
      'a single answer that needs nothing: none, a quick question is never in progress',
      ({ registry }, thread) => registry.setState(thread, 'parked'),
      undefined
    ],
    ['at work', () => undefined, 'working'],
    ['an answer waiting to be heard', ({ registry }, thread) => registry.setState(thread, 'ready'), 'ready'],
    [
      'come back to and resting',
      ({ registry, ask }, thread) => {
        ask('and next year?', thread)
        registry.setState(thread, 'parked')
      },
      'quiet'
    ],
    [
      'asking something, which comes before its being at work',
      ({ screen, lines }, thread) => void screen.present({ title: 'Waiting for you', spec: question as never }, { thread, turn: lines.at(-1)?.turn }),
      'asks'
    ]
  ])('stands by what it needs of the person first: %s', (_case, act, progress) => {
    const context = setup()
    const taxes = context.thread('Taxes')
    context.ask('how much do I owe?', taxes.id)
    act(context, taxes.id)
    expect(context.topics.get(context.topics.of(taxes.id) as string)?.progress).toBe(progress)
  })

  it('asks while an answer still being given asks, though a later request was passed on behind it', () => {
    const { topics, screen, thread, ask, lines } = setup()
    const taxes = thread('Taxes')
    const first = ask('how much do I owe?', taxes.id, { outcome: 'running' })
    ask('and next year?', taxes.id, { outcome: 'running' })
    const topic = topics.of(taxes.id) as string
    screen.present({ id: 'approval', title: 'Waiting for you', spec: question as never }, { thread: taxes.id, turn: first })
    expect(topics.get(topic)?.progress).toBe('asks')
    // Once the answer that asked is given, what it showed no longer asks for the topic.
    Object.assign(lines[0] as Exchange, { outcome: 'done' })
    expect(topics.get(topic)?.progress).toBe('working')
  })

  it('tells when it no longer stands as it did: a thread finishes, a card that asks comes and goes', () => {
    const { topics, registry, screen, thread, ask, events } = setup()
    const taxes = thread('Taxes')
    const turn = ask('how much do I owe?', taxes.id)
    const stood = () => events.at(-1)?.topics[0]?.topic.progress
    expect(stood()).toBe('working')

    const part = registry.open({ title: 'Receipts', kind: 'subthread', parent: taxes.id })
    registry.setState(taxes.id, 'parked')
    // Its sub-thread still works for it.
    expect(topics.get(topics.of(taxes.id) as string)?.progress).toBe('working')
    events.length = 0
    registry.setState(part.id, 'parked')
    expect(events).toMatchObject([{ topics: [{ topic: { title: 'Taxes' } }], gone: [] }])
    expect(stood()).toBeUndefined()

    screen.present({ title: 'Which year?', spec: question as never }, { thread: taxes.id, turn })
    expect(stood()).toBe('asks')
    screen.clear(screen.cards(taxes.id).at(-1)?.id as string)
    expect(stood()).toBeUndefined()

    // What changes nothing tells nothing.
    events.length = 0
    registry.focus(taxes.id)
    expect(events).toEqual([])
  })

  it('is on the first page however far down it stands, unless it has rested for three days', () => {
    const { topics, registry, thread, ask } = setup()
    const asked = (title: string, times: number, more = {}) => {
      const one = thread(title)
      for (let time = 0; time < times; time++) ask(`about ${title}`, one.id, more)
      registry.setState(one.id, 'parked')
    }
    asked('Old thesis', 2, { at: '2026-11-01T09:00:00.000Z' })
    asked('Camping', 2)
    for (const title of ['Weather', 'Radio']) asked(title, 1)

    const first = topics.read({ limit: 2 })
    expect(first.topics.map((one) => [one.topic.title, one.topic.progress])).toEqual([
      ['Radio', undefined],
      ['Weather', undefined],
      ['Camping', 'quiet']
    ])
    // The page after starts where the page ended, not after what was added to it.
    expect(first.next).toBe(first.topics[1]?.topic.at)
    expect(topics.read({ limit: 2, before: first.next }).topics.map((one) => one.topic.title)).toEqual(['Camping', 'Old thesis'])
  })
})

describe('what the orchestrator reads', () => {
  it('lists the recent topics, each with its threads, what they are doing and what they are about', () => {
    const { topics, registry, thread, ask } = setup()
    const weather = thread('Weather this weekend')
    const topic = topics.of(weather.id) as string
    ask('weather this weekend?', weather.id)
    registry.setState(weather.id, 'parked')
    const gear = thread('What to pack', topic)
    ask('what should I pack?', gear.id)
    registry.focus(gear.id)
    topics.rename(topic, 'Camping this weekend')
    const long = `Packing for two nights. ${'More detail. '.repeat(40)}`
    const lines = topics
      .index(
        (id) => (id === gear.id ? 'what should I pack?' : undefined),
        (id) => (id === gear.id ? long : undefined)
      )
      .split('\n')

    expect(lines[0]).toMatch(new RegExp(`^- topic ${topic}: "Camping this weekend" \\(2 answers, last active 2026-11-22 09:\\d\\d\\)$`))
    expect(lines[1]).toBe(`  - thread ${gear.id}: "What to pack" (working, the one the person last turned to, answering: what should I pack?)`)
    expect(lines[2]?.startsWith('    about: Packing for two nights. More detail.')).toBe(true)
    expect(lines[2]?.endsWith('…')).toBe(true)
    expect(lines[3]).toBe(`  - thread ${weather.id}: "Weather this weekend" (parked)`)
    expect(setup().topics.index()).toBe('There are no topics yet.')
  })
})
