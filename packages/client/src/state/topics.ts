import { type Answer, answerIdOf, type EventOf, type Exchange, type ShownView, type TopicAnswers, withCard } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the main screen shows: the topics read so far, each with the answers of it read so far. */
export interface TopicsShown {
  /**
   * The topics, the one last active first, none of them put away. Each comes with its latest answers, the latest
   * first: at least the latest one, and the earlier ones once they were asked for.
   */
  topics: readonly TopicAnswers[]
  /** Whether topics active before these are still to be read. */
  more: boolean
  /** Whether the topics were read: until then, an empty list says nothing. */
  ready: boolean
  /**
   * The views that arrived while this client was connected, as opposed to ones read when it connected: only
   * these may start playing by themselves, so the app never bursts into sound on opening.
   */
  arrived: readonly string[]
}

export interface TopicsState extends Followed<TopicsShown> {
  /** Read the topics active before those read so far. */
  older(): Promise<void>
  /** Read the answers of a topic that come before those read so far. */
  earlier(topic: string): Promise<void>
  rename(topic: string, title: string): Promise<void>
  /** Put a topic away from the main screen, or bring it back. */
  archive(topic: string, archived: boolean): Promise<void>
  /** Move an answer to another topic, or to a new one of the title given. */
  move(answer: string, to: { topic: string } | { title: string }): Promise<void>
  /** Merge a topic into another. */
  merge(topic: string, into: string): Promise<void>
  /** Remove a card from its answer. */
  clear(view: string): Promise<void>
  unfollow(): void
}

/** How many arrived views are remembered: more than can be on screen at once. */
const ARRIVED = 12

type TopicEvent = EventOf<'topics.changed' | 'view.shown' | 'view.cleared' | 'turn.ended' | 'answer.written' | 'turn.planned'>
const FOLLOWED: ReadonlySet<string> = new Set<TopicEvent['name']>([
  'topics.changed',
  'view.shown',
  'view.cleared',
  'turn.ended',
  'answer.written',
  'turn.planned'
])

/** The topics in order, the one last active first: among those active at the same moment, as they were given. */
const inOrder = (topics: readonly TopicAnswers[]) => [...topics].sort((one, other) => other.topic.at.localeCompare(one.topic.at))

/** Every answer of every topic, each changed as `change` says: the same object back means no change. */
const eachAnswer = (topics: readonly TopicAnswers[], change: (answer: Answer) => Answer): readonly TopicAnswers[] => {
  let changed = false
  const next = topics.map((one) => {
    const answers = one.answers.map(change)
    if (answers.every((answer, at) => answer === one.answers[at])) return one
    changed = true
    return { ...one, answers }
  })
  return changed ? next : topics
}

/**
 * A topic as the core just gave it, with its latest answer, joined to what was read of it. Its earlier answers are
 * kept while they are still the ones before its latest; after a move or a merge they are read again when asked for.
 */
function joined(known: TopicAnswers | undefined, given: TopicAnswers): TopicAnswers {
  const [latest] = given.answers
  if (!known || !latest) return given
  if (known.answers[0]?.id === latest.id && known.topic.answers === given.topic.answers)
    return { topic: given.topic, answers: [latest, ...known.answers.slice(1)] }
  if (known.topic.answers + 1 === given.topic.answers && known.answers.every((answer) => answer.id !== latest.id))
    return { topic: given.topic, answers: [latest, ...known.answers] }
  return given
}

/** The topics once the core said some changed: those given first among the ones active at the same moment. */
function changedTopics(topics: readonly TopicAnswers[], given: readonly TopicAnswers[], gone: readonly string[]): readonly TopicAnswers[] {
  const named = new Set([...given.map((one) => one.topic.id), ...gone])
  const shown = given
    .filter((one) => one.topic.archived !== true)
    .map((one) =>
      joined(
        topics.find((known) => known.topic.id === one.topic.id),
        one
      )
    )
  return inOrder([...shown, ...topics.filter((one) => !named.has(one.topic.id))])
}

/** The topics once a view is shown: a card of its answer, and no longer of any other. */
function withView(topics: readonly TopicAnswers[], view: ShownView): readonly TopicAnswers[] {
  const answer = answerIdOf(view)
  return eachAnswer(topics, (one) => {
    if (one.id === answer) return { ...one, views: withCard(one.views, view) }
    return one.views.some((card) => card.id === view.id) ? { ...one, views: one.views.filter((card) => card.id !== view.id) } : one
  })
}

const withoutView = (topics: readonly TopicAnswers[], view: string) =>
  eachAnswer(topics, (one) => (one.views.some((card) => card.id === view) ? { ...one, views: one.views.filter((card) => card.id !== view) } : one))

const withLine = (topics: readonly TopicAnswers[], exchange: Exchange) =>
  eachAnswer(topics, (one) => (one.id === exchange.turn && one.exchange !== undefined ? { ...one, exchange } : one))

/**
 * Read the topics from the core and follow them: every topic answered, renamed, brought back or put away, every card
 * shown or removed, on this device or another, changes what is shown.
 */
export function followTopics(session: Session): TopicsState {
  const state = cell<TopicsShown>({ topics: [], more: false, ready: false, arrived: [] })
  /** What arrived while the first read was on its way, in order: applied again on top of what the read returns. */
  let early: TopicEvent[] | undefined = []

  const apply = (event: TopicEvent) => {
    const shown = state.current()
    if (event.name === 'topics.changed') state.set({ ...shown, topics: changedTopics(shown.topics, event.topics, event.gone) })
    else if (event.name === 'view.cleared') state.set({ ...shown, topics: withoutView(shown.topics, event.view) })
    else if (event.name === 'view.shown')
      state.set({
        ...shown,
        topics: withView(shown.topics, event.view),
        arrived: [...shown.arrived.filter((id) => id !== event.view.id), event.view.id].slice(-ARRIVED)
      })
    else state.set({ ...shown, topics: withLine(shown.topics, event.exchange) })
  }

  const stopEvents = session.onEvent((event) => {
    if (!FOLLOWED.has(event.name)) return
    early?.push(event as TopicEvent)
    apply(event as TopicEvent)
  })
  session.run('topics.read', {}).then(
    ({ topics, more }) => {
      // The read is the screen as the core had it when it read it, which may be before or after an event that arrived
      // meanwhile. Those events are applied again on top of it: applying one twice changes nothing.
      const heard = early ?? []
      early = undefined
      state.set({ topics, more, ready: true, arrived: [] })
      for (const event of heard) apply(event)
    },
    () => {
      early = undefined
      state.set({ ...state.current(), ready: true })
    }
  )

  let reading: Promise<void> | undefined
  const earlier = new Map<string, Promise<void>>()
  return {
    current: state.current,
    subscribe: state.subscribe,

    older() {
      const last = state.current().topics.at(-1)
      if (!last || !state.current().more) return Promise.resolve()
      reading ??= session
        .run('topics.read', { before: last.topic.at })
        .then(({ topics, more }) => {
          const shown = state.current()
          const known = new Set(shown.topics.map((one) => one.topic.id))
          state.set({ ...shown, topics: [...shown.topics, ...topics.filter((one) => !known.has(one.topic.id))], more })
        })
        .finally(() => {
          reading = undefined
        })
      return reading
    },

    earlier(topic) {
      const known = state.current().topics.find((one) => one.topic.id === topic)
      const oldest = known?.answers.at(-1)
      if (!known || !oldest || known.answers.length >= known.topic.answers) return Promise.resolve()
      const running = earlier.get(topic)
      if (running) return running
      const read = session
        .run('topic.read', { topic, before: oldest.id })
        .then(({ answers }) => {
          const shown = state.current()
          state.set({
            ...shown,
            topics: shown.topics.map((one) => {
              // Read meanwhile after a move or a merge, its answers are no longer the ones these come before.
              if (one.topic.id !== topic || one.answers.at(-1)?.id !== oldest.id) return one
              const had = new Set(one.answers.map((answer) => answer.id))
              return { ...one, answers: [...one.answers, ...answers.filter((answer) => !had.has(answer.id))] }
            })
          })
        })
        .finally(() => void earlier.delete(topic))
      earlier.set(topic, read)
      return read
    },

    async rename(topic, title) {
      await session.run('topic.rename', { topic, title })
    },
    async archive(topic, archived) {
      await session.run('topic.archive', { topic, archived })
    },
    async move(answer, to) {
      await session.run('topic.move', { answer, ...to })
    },
    async merge(topic, into) {
      await session.run('topic.merge', { topic, into })
    },
    async clear(view) {
      await session.run('view.clear', { view })
    },
    unfollow: stopEvents
  }
}
