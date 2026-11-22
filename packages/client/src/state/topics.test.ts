import type { Answer, Event, Exchange, ShownView, TopicAnswers } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followTopics } from './topics.ts'

const view = (id: string, more: Partial<ShownView> = {}): ShownView => ({
  id,
  title: id,
  spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } },
  ...more
})
const line = (turn: string, more: Partial<Exchange> = {}): Exchange => ({
  turn,
  at: `2026-11-22T09:0${turn.slice(1)}:00.000Z`,
  persona: 'one',
  said: turn,
  replied: '',
  outcome: 'running',
  ...more
})
const answer = (turn: string, views: ShownView[] = []): Answer => ({ id: turn, at: line(turn).at, exchange: line(turn), views })
/** A topic with the answers given, the latest first, last active when its latest answer was asked for. */
const topic = (id: string, answers: Answer[], more: Partial<TopicAnswers['topic']> = {}): TopicAnswers => ({
  topic: { id, title: id, at: answers[0]?.at ?? '', answers: answers.length, ...more },
  answers
})

function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  const waiting = new Map<string, (output: unknown) => void>()
  const ran: [string, unknown][] = []
  const session: Session = {
    run: (name, input) => {
      ran.push([name, input])
      return new Promise<never>((resolve) => waiting.set(name, resolve as (output: unknown) => void))
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => undefined
  }
  const settled = async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
  }
  return {
    session,
    ran,
    emit(event: Event) {
      for (const listener of listeners) listener(event)
    },
    /** The core answers the command that waits. */
    async answer(name: string, output: unknown) {
      waiting.get(name)?.(output)
      waiting.delete(name)
      await settled()
    }
  }
}

const changed = (topics: TopicAnswers[], gone: string[] = []): Event => ({ type: 'event', name: 'topics.changed', topics, gone })
const shown = (one: ShownView): Event => ({ type: 'event', name: 'view.shown', view: one })

/** The topics read, each with the answers of it that were read and the titles of their cards. */
const read = (state: ReturnType<typeof followTopics>) =>
  state.current().topics.map((one) => [one.topic.id, ...one.answers.map((each) => `${each.id}:${each.views.map((card) => card.title).join('+')}`)])

async function opened(topics: TopicAnswers[] = [], next?: string) {
  const core = fakeSession()
  const state = followTopics(core.session)
  await core.answer('topics.read', { topics, ...(next === undefined ? {} : { next }) })
  return { core, state }
}

describe('followTopics', () => {
  it('starts with the topics the core has, and says when they were read', async () => {
    const core = fakeSession()
    const state = followTopics(core.session)
    expect(state.current()).toMatchObject({ topics: [], ready: false })
    await core.answer('topics.read', { topics: [topic('trip', [answer('t2', [view('map')])])], next: line('t2').at })
    expect(state.current()).toMatchObject({ ready: true, more: true, arrived: [] })
    expect(read(state)).toEqual([['trip', 't2:map']])
  })

  it('keeps what arrived while the first read was on its way', async () => {
    const core = fakeSession()
    const state = followTopics(core.session)
    core.emit(changed([topic('build', [answer('t5')])]))
    core.emit(shown(view('status', { turn: 't5' })))
    await core.answer('topics.read', { topics: [topic('trip', [answer('t2')])] })
    expect(read(state)).toEqual([
      ['build', 't5:status'],
      ['trip', 't2:']
    ])
    expect(state.current().arrived).toEqual(['status'])
  })

  it.each<[string, TopicAnswers, string[][]]>([
    [
      'a new answer goes before the ones read, and the topic rises',
      topic('trip', [answer('t6')], { answers: 3 }),
      [
        ['trip', 't6:', 't2:map', 't1:'],
        ['build', 't5:']
      ]
    ],
    [
      'a new name keeps the answers read',
      topic('trip', [answer('t2', [view('map')])], { title: 'Lisbon', answers: 2 }),
      [
        ['build', 't5:'],
        ['trip', 't2:map', 't1:']
      ]
    ],
    [
      'after a move or a merge only the latest answer is kept, the others read again when asked for',
      topic('trip', [answer('t2', [view('map')])], { answers: 5 }),
      [
        ['build', 't5:'],
        ['trip', 't2:map']
      ]
    ],
    [
      'a topic not read yet comes in where its time says',
      topic('old', [answer('t3')]),
      [
        ['build', 't5:'],
        ['old', 't3:'],
        ['trip', 't2:map', 't1:']
      ]
    ],
    ['a topic put away leaves', topic('build', [answer('t5')], { archived: true }), [['trip', 't2:map', 't1:']]]
  ])('follows a change: %s', async (_case, given, expected) => {
    const { core, state } = await opened([topic('build', [answer('t5')]), topic('trip', [answer('t2', [view('map')]), answer('t1')])])
    core.emit(changed([given]))
    expect(read(state)).toEqual(expected)
  })

  it('drops a topic that has no answer left', async () => {
    const { core, state } = await opened([topic('build', [answer('t5')]), topic('trip', [answer('t2')])])
    core.emit(changed([], ['build']))
    expect(read(state)).toEqual([['trip', 't2:']])
  })

  it('puts a view shown among the cards of its answer, in place of the card of its name, and takes one removed away', async () => {
    const { core, state } = await opened([topic('trip', [answer('t2', [view('map', { turn: 't2', card: 'map' })]), answer('t1')])])
    core.emit(shown(view('weather', { turn: 't2', card: 'weather' })))
    core.emit(shown(view('map, closer', { turn: 't2', card: 'map' })))
    core.emit(shown(view('unknown', { turn: 't9' })))
    expect(read(state)).toEqual([['trip', 't2:map, closer+weather', 't1:']])
    expect(state.current().arrived).toEqual(['weather', 'map, closer', 'unknown'])
    core.emit({ type: 'event', name: 'view.cleared', view: 'weather' })
    expect(read(state)).toEqual([['trip', 't2:map, closer', 't1:']])
  })

  it('moves a card brought up to date in a later turn to that answer', async () => {
    const { core, state } = await opened([topic('trip', [answer('t2'), answer('t1', [view('files', { turn: 't1' })])])])
    core.emit(shown(view('files', { turn: 't2', title: 'files, more' })))
    expect(read(state)).toEqual([['trip', 't2:files, more', 't1:']])
  })

  it('keeps the line of an answer current as it is answered', async () => {
    const { core, state } = await opened([topic('trip', [answer('t2')])])
    core.emit({ type: 'event', name: 'turn.ended', exchange: line('t2', { replied: 'Here is the plan.', outcome: 'done' }) })
    expect(state.current().topics[0]?.answers[0]?.exchange).toMatchObject({ replied: 'Here is the plan.', outcome: 'done' })
  })

  it('reads the topics active before those it has, from where the core says, once at a time', async () => {
    // The first page also holds a topic in progress from long before: the next page starts after the page, not after it.
    const { core, state } = await opened([topic('trip', [answer('t5')]), topic('thesis', [answer('t1')], { progress: 'quiet' })], line('t5').at)
    void state.older()
    void state.older()
    expect(core.ran).toEqual([
      ['topics.read', {}],
      ['topics.read', { before: line('t5').at }]
    ])
    await core.answer('topics.read', { topics: [topic('old', [answer('t3')]), topic('thesis', [answer('t1')], { progress: 'quiet' })] })
    expect(read(state)).toEqual([
      ['trip', 't5:'],
      ['old', 't3:'],
      ['thesis', 't1:']
    ])
    expect(state.current().more).toBe(false)
    await state.older()
    expect(core.ran).toHaveLength(2)
  })

  it("reads a topic's earlier answers when asked for, and nothing once it has them all", async () => {
    const { core, state } = await opened([topic('trip', [answer('t3')], { answers: 3 })])
    void state.earlier('trip')
    void state.earlier('trip')
    expect(core.ran.slice(1)).toEqual([['topic.read', { topic: 'trip', before: 't3' }]])
    await core.answer('topic.read', { ...topic('trip', [answer('t2', [view('map')]), answer('t1')], { answers: 3 }), more: false })
    expect(read(state)).toEqual([['trip', 't3:', 't2:map', 't1:']])
    await state.earlier('trip')
    await state.earlier('nowhere')
    expect(core.ran).toHaveLength(2)
  })

  it('sends what the person corrects', async () => {
    const { core, state } = await opened()
    void state.rename('trip', 'Lisbon')
    void state.archive('trip', true)
    void state.move('t2', { topic: 'build' })
    void state.move('t2', { title: 'Roses' })
    void state.merge('trip', 'build')
    void state.clear('map')
    void state.away()
    expect(core.ran.slice(1)).toEqual([
      ['topic.rename', { topic: 'trip', title: 'Lisbon' }],
      ['topic.archive', { topic: 'trip', archived: true }],
      ['topic.move', { answer: 't2', topic: 'build' }],
      ['topic.move', { answer: 't2', title: 'Roses' }],
      ['topic.merge', { topic: 'trip', into: 'build' }],
      ['view.clear', { view: 'map' }],
      ['topics.read', { archived: true, limit: 50 }]
    ])
  })
})
