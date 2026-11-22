import {
  type Answer,
  answerIdOf,
  type Event,
  type Exchange,
  inConversation,
  inProgress,
  type ShownView,
  type Thread,
  type Topic,
  type TopicAnswers,
  type TopicProgress
} from '@repo/protocol'
import { z } from 'zod'
import type { Records } from '../ports/records.ts'
import { shorten } from '../text.ts'
import type { ThreadRegistry } from '../threads/registry.ts'
import type { Screen } from '../views/screen.ts'

/** The type of the record written each time a topic is opened, renamed, brought back or put away: the topic as it stands. */
const TOPIC = 'topic'
/**
 * The type of the record written when an answer is filed in a topic by something other than the thread that gave it:
 * the person moved it, or it is no thread's (a reminder, a saved widget the person had shown).
 */
const FILED = 'topic.answer'

const topicRecord = z.object({ id: z.string(), title: z.string(), at: z.string().optional(), archived: z.boolean().optional() })
const filedRecord = z.object({ answer: z.string(), topic: z.string(), at: z.string(), moved: z.boolean().optional() })
type FiledByHand = z.infer<typeof filedRecord>

/** How many topics the orchestrator is told about, and how many threads of each. Older ones are still kept, and searched. */
const INDEXED = { topics: 12, threads: 4 }
/** How much of a thread's summary the orchestrator reads beside its line: enough to know where a request belongs. */
const ABOUT_LENGTH = 240

/** A page of something read the latest first. */
interface Page {
  limit: number
  before?: string | undefined
}

export interface Topics {
  /** The topic a thread's answers are filed in. A sub-thread's is its thread's. */
  of(thread: string): string | undefined
  /** A topic, by its identifier. */
  get(topic: string): Topic | undefined
  /** Open a topic. It is one for the person once it has an answer. */
  open(title: string): string
  /** A line of the conversation was passed to a thread: it is an answer of that thread's topic, which is active again. */
  answered(line: Exchange): void
  /** A topic was asked for again: it is active now, and no longer put away. */
  touch(topic: string): void
  /** Lines were erased from the conversation: they are no longer answers. */
  forget(turns: ReadonlySet<string>): void
  /**
   * The topics for the main screen, the one last active first, each with its latest answer, and where the page after
   * starts. The first page holds every topic in progress too.
   */
  read(page: Page): { topics: TopicAnswers[]; next?: string }
  /** A topic's answers, the latest first. Undefined when there is no such topic. */
  answers(topic: string, page: Page): (TopicAnswers & { more: boolean }) | undefined
  rename(topic: string, title: string): boolean
  archive(topic: string, archived: boolean): boolean
  /** Move an answer to a topic, or to a new one of the title given. Says where it is now, or nothing when it cannot be. */
  move(answer: string, to: { topic: string } | { title: string }): string | undefined
  /** Merge a topic into another: its answers, and what its threads answer next. */
  merge(topic: string, into: string): boolean
  /** The recent topics and their threads, as the orchestrator reads them, with what each thread at work is answering. */
  index(doing?: (thread: string) => string | undefined, summary?: (thread: string) => string | undefined): string
  onEvent(listener: (event: Event) => void): () => void
}

export interface TopicsOptions {
  records: Records
  registry: ThreadRegistry
  screen: Screen
  /** The lines of the conversation, oldest first. */
  lines(): readonly Exchange[]
  now: () => Date
  newId: () => string
}

/** An answer where it is filed: enough to list it, its words and cards being read when asked for. */
interface Filed {
  id: string
  at: string
}

interface Kept {
  id: string
  title: string
  /** When it was last brought back, if it was. */
  touched: string | undefined
  archived: boolean
  /** Its answers, oldest first. */
  filed: Filed[]
  /** Its place among the topics active at the same moment: the one active last has the highest. */
  turn: number
}

/**
 * The topics, built from the conversation and kept current (docs/SPEC.md, section 7.3). An answer belongs to the topic
 * of the thread that gave it, unless the person moved it; so a topic gathers several threads, and nothing is written
 * for the common case. A thread recorded before there were topics is a topic of its own, under its own identifier.
 */
export function createTopics({ records, registry, screen, lines, now, newId }: TopicsOptions): Topics {
  const topics = new Map<string, Kept>()
  /** The topic each answer is filed in. */
  const where = new Map<string, string>()
  /** The answers filed by a record, each as last filed. */
  const byHand = new Map<string, FiledByHand>()
  /** The answers that are no line of the conversation: each one lasts as long as it has a card. */
  const loose = new Set<string>()

  const listeners = new Set<(event: Event) => void>()
  let turns = 0
  const lineOf = (answer: string) => lines().findLast((line) => line.turn === answer)
  const activeAt = (topic: Kept) => {
    const answered = topic.filed.at(-1)?.at ?? ''
    return topic.touched !== undefined && topic.touched > answered ? topic.touched : answered
  }
  /** The topics in order, the one last active first. */
  const byActivity = (one: Kept, other: Kept) => activeAt(other).localeCompare(activeAt(one)) || other.turn - one.turn

  const of = (id: string): string | undefined => {
    const thread = registry.get(id)
    if (!thread) return undefined
    if (thread.kind === 'subthread') return thread.parent === undefined ? undefined : of(thread.parent)
    return thread.topic ?? thread.id
  }

  /** The threads that work for each topic, sub-threads among them: put together when asked for, until a thread changes. */
  let working: Map<string, Thread[]> | undefined
  const threadsOf = (topic: string): readonly Thread[] => {
    if (!working) {
      working = new Map()
      for (const thread of registry.read().threads) {
        const id = of(thread.id)
        if (id !== undefined) working.set(id, [...(working.get(id) ?? []), thread])
      }
    }
    return working.get(topic) ?? []
  }
  /**
   * How a topic stands, by what it needs of the person first (docs/SPEC.md, section 7.3): it asks them something, it
   * is at work, an answer of it waits to be heard, or it rests. A single answer that needs nothing has no standing.
   */
  const progressOf = (topic: Kept): TopicProgress | undefined => {
    const latest = topic.filed.at(-1)
    if (!latest) return undefined
    if (screen.asks(latest.id)) return 'asks'
    const threads = threadsOf(topic.id)
    if (threads.some((thread) => thread.state === 'working')) return 'working'
    if (threads.some((thread) => thread.state === 'ready')) return 'ready'
    return topic.filed.length > 1 ? 'quiet' : undefined
  }
  /** How each topic stood when it was last told: what `refresh` compares with. */
  const told = new Map<string, TopicProgress>()
  const asTopic = (topic: Kept): Topic => {
    const progress = progressOf(topic)
    if (progress === undefined) told.delete(topic.id)
    else told.set(topic.id, progress)
    return {
      id: topic.id,
      title: topic.title,
      at: activeAt(topic),
      answers: topic.filed.length,
      ...(progress === undefined ? {} : { progress }),
      ...(topic.archived ? { archived: true } : {})
    }
  }
  /** The topic of a thread, made from the thread itself when it was recorded before there were topics. */
  const topicFor = (thread: string): Kept | undefined => {
    const id = of(thread)
    if (id === undefined) return undefined
    const known = topics.get(id)
    if (known) return known
    const first = registry.get(id)
    if (!first) return undefined
    const made: Kept = { id, title: first.title, touched: undefined, archived: false, filed: [], turn: 0 }
    topics.set(id, made)
    return made
  }

  const unplace = (answer: string) => {
    const topic = topics.get(where.get(answer) ?? '')
    if (topic) topic.filed = topic.filed.filter((one) => one.id !== answer)
    where.delete(answer)
    loose.delete(answer)
  }
  const place = (answer: Filed, topic: Kept) => {
    unplace(answer.id)
    // Nearly always the latest: it goes at the end, and anything else is put where its time says.
    const after = topic.filed.findLastIndex((one) => one.at <= answer.at)
    topic.filed.splice(after + 1, 0, answer)
    topic.turn = ++turns
    where.set(answer.id, topic.id)
  }

  for (const record of records.read([TOPIC, FILED])) {
    if (record.type === FILED) {
      const filed = filedRecord.safeParse(record.payload)
      if (filed.success) byHand.set(filed.data.answer, filed.data)
      continue
    }
    const topic = topicRecord.safeParse(record.payload)
    if (topic.success)
      topics.set(topic.data.id, {
        id: topic.data.id,
        title: topic.data.title,
        touched: topic.data.at,
        archived: topic.data.archived === true,
        filed: [],
        turn: 0
      })
  }
  const spoken = new Set<string>()
  for (const line of lines()) {
    spoken.add(line.turn)
    if (line.thread === undefined || !inConversation(line)) continue
    const moved = byHand.get(line.turn)
    const topic = (moved?.moved === true ? topics.get(moved.topic) : undefined) ?? topicFor(line.thread)
    if (topic) place({ id: line.turn, at: line.at }, topic)
  }
  for (const filed of byHand.values()) {
    const topic = topics.get(filed.topic)
    if (!topic || where.has(filed.answer)) continue
    if (!spoken.has(filed.answer)) {
      if (!screen.has(filed.answer)) continue
      loose.add(filed.answer)
    }
    place({ id: filed.answer, at: filed.at }, topic)
  }

  /** Answers as they are read, the latest first: their lines from the conversation, their cards from the screen. */
  const answersOf = (filed: readonly Filed[], cards = screen.of(filed.map((one) => one.id))): Answer[] =>
    filed.toReversed().map((one) => {
      const exchange = lineOf(one.id)
      return { id: one.id, at: one.at, ...(exchange ? { exchange } : {}), views: cards.get(one.id) ?? [] }
    })
  const withLatest = (list: readonly Kept[]): TopicAnswers[] => {
    const cards = screen.of(list.flatMap((topic) => topic.filed.at(-1)?.id ?? []))
    return list.map((topic) => ({ topic: asTopic(topic), answers: answersOf(topic.filed.slice(-1), cards) }))
  }

  const announce = (...changed: (string | undefined)[]) => {
    const still: Kept[] = []
    const gone: string[] = []
    for (const id of new Set(changed)) {
      const topic = id === undefined ? undefined : topics.get(id)
      if (topic && topic.filed.length > 0) still.push(topic)
      else if (id !== undefined) gone.push(id)
    }
    const event: Event = { type: 'event', name: 'topics.changed', topics: withLatest(still), gone }
    for (const listener of listeners) listener(event)
  }
  const write = (topic: Kept) =>
    records.append([
      {
        type: TOPIC,
        payload: {
          id: topic.id,
          title: topic.title,
          ...(topic.touched === undefined ? {} : { at: topic.touched }),
          ...(topic.archived ? { archived: true } : {})
        }
      }
    ])
  const fileByHand = (answer: Filed, topic: Kept, moved: boolean) => {
    const filed: FiledByHand = { answer: answer.id, topic: topic.id, at: answer.at, ...(moved ? { moved } : {}) }
    records.append([{ type: FILED, payload: filed }])
    byHand.set(answer.id, filed)
    place(answer, topic)
  }
  const open = (title: string): Kept => {
    const topic: Kept = { id: newId(), title, touched: undefined, archived: false, filed: [], turn: 0 }
    topics.set(topic.id, topic)
    write(topic)
    return topic
  }
  const touch = (id: string) => {
    const topic = topics.get(id)
    if (!topic) return
    topic.touched = now().toISOString()
    topic.turn = ++turns
    topic.archived = false
    write(topic)
    announce(id)
  }

  /** A view was shown: one that is no card of a filed answer starts an answer of its own, in its thread's topic or a new one. */
  const shown = (view: ShownView) => {
    const answer = answerIdOf(view)
    const filedIn = where.get(answer)
    if (filedIn !== undefined) {
      // What the person had shown and shows again comes back to the top.
      if (loose.has(answer)) touch(filedIn)
      return
    }
    const line = lineOf(answer)
    // A line a thread is answering is filed by its thread.
    if (line?.thread !== undefined) return
    const topic = (view.thread === undefined ? undefined : topicFor(view.thread)) ?? open(view.title)
    fileByHand({ id: answer, at: line?.at ?? now().toISOString() }, topic, false)
    if (!line) loose.add(answer)
    announce(topic.id)
  }
  /** A card was removed: what was no line of the conversation and has no card left is nothing any more. */
  const cleared = () => {
    const emptied = [...loose].filter((answer) => !screen.has(answer))
    const changed = emptied.map((answer) => where.get(answer))
    for (const answer of emptied) unplace(answer)
    if (changed.length > 0) announce(...changed)
  }
  /**
   * Tell of the topics that no longer stand as they were last told: a thread started or finished, a card that asks
   * something came or went. Only those that stood somehow, have a thread that makes them stand, or are named are
   * looked at.
   */
  const refresh = (...named: (string | undefined)[]) => {
    const lively = registry.read().threads.flatMap((thread) => (thread.state === 'parked' ? [] : (of(thread.id) ?? [])))
    const changed = [...new Set([...told.keys(), ...lively, ...named])].filter((id): id is string => {
      if (id === undefined) return false
      const topic = topics.get(id)
      return topic !== undefined && topic.filed.length > 0 && progressOf(topic) !== told.get(id)
    })
    if (changed.length > 0) announce(...changed)
  }
  screen.onEvent((event) => {
    if (event.name === 'view.shown') {
      shown(event.view)
      refresh(where.get(answerIdOf(event.view)))
    } else if (event.name === 'view.cleared') {
      cleared()
      refresh()
    }
  })
  registry.onEvent(() => {
    working = undefined
    refresh()
  })

  return {
    of,
    get(id) {
      const topic = topics.get(id)
      return topic && asTopic(topic)
    },
    open: (title) => open(title).id,

    answered(line) {
      if (line.thread === undefined || !inConversation(line)) return
      const moved = byHand.get(line.turn)
      const topic = (moved?.moved === true ? topics.get(moved.topic) : undefined) ?? topicFor(line.thread)
      if (!topic) return
      const was = where.get(line.turn)
      place({ id: line.turn, at: line.at }, topic)
      if (topic.archived) {
        topic.archived = false
        write(topic)
      }
      announce(topic.id, was)
    },

    touch,

    forget(turns) {
      const changed = [...turns].map((turn) => where.get(turn))
      for (const turn of turns) unplace(turn)
      if (changed.some((topic) => topic !== undefined)) announce(...changed)
    },

    read({ limit, before }) {
      const listed = [...topics.values()]
        .filter((topic) => topic.filed.length > 0 && !topic.archived && (before === undefined || activeAt(topic) < before))
        .sort(byActivity)
      const page = listed.slice(0, limit)
      const last = page.at(-1)
      // What is in progress is there from the start, however far down the list it stands.
      const moment = now()
      const further = before === undefined ? listed.slice(limit).filter((topic) => inProgress(asTopic(topic), moment)) : []
      return { topics: withLatest([...page, ...further]), ...(last !== undefined && listed.length > limit ? { next: activeAt(last) } : {}) }
    },

    answers(id, { limit, before }) {
      const topic = topics.get(id)
      if (!topic) return undefined
      const found = before === undefined ? -1 : topic.filed.findIndex((one) => one.id === before)
      const end = found < 0 ? topic.filed.length : found
      const start = Math.max(0, end - limit)
      return { topic: asTopic(topic), answers: answersOf(topic.filed.slice(start, end)), more: start > 0 }
    },

    rename(id, title) {
      const topic = topics.get(id)
      if (!topic) return false
      topic.title = title
      write(topic)
      announce(id)
      return true
    },

    archive(id, archived) {
      const topic = topics.get(id)
      if (!topic) return false
      if (topic.archived !== archived) {
        topic.archived = archived
        write(topic)
        announce(id)
      }
      return true
    },

    move(answer, to) {
      const from = topics.get(where.get(answer) ?? '')
      const filed = from?.filed.find((one) => one.id === answer)
      if (!from || !filed) return undefined
      const target = 'topic' in to ? topics.get(to.topic) : open(to.title)
      if (!target) return undefined
      if (target !== from) {
        const wasLoose = loose.has(answer)
        fileByHand(filed, target, true)
        if (wasLoose) loose.add(answer)
        announce(from.id, target.id)
      }
      return target.id
    },

    merge(id, into) {
      const from = topics.get(id)
      const target = topics.get(into)
      if (!from || !target || from === target) return false
      // What its threads answer next is the other topic's, and so is what they answered: an answer follows its thread.
      for (const thread of registry.read().threads) if (thread.kind === 'topic' && of(thread.id) === from.id) registry.file(thread.id, target.id)
      for (const answer of [...from.filed]) {
        const wasLoose = loose.has(answer.id)
        const filed = byHand.get(answer.id)
        // What a record filed there is filed again by a record, which is all that says where it is.
        if (filed?.topic === from.id) fileByHand(answer, target, filed.moved === true)
        else place(answer, target)
        if (wasLoose) loose.add(answer.id)
      }
      announce(from.id, target.id)
      return true
    },

    index(doing, summary) {
      const recent = [...topics.values()]
        .filter((topic) => topic.filed.length > 0)
        .sort(byActivity)
        .slice(0, INDEXED.topics)
      if (recent.length === 0) return 'There are no topics yet.'
      const { threads, focus } = registry.read()
      return recent
        .map((topic) => {
          const facts = [
            `${topic.filed.length} ${topic.filed.length === 1 ? 'answer' : 'answers'}`,
            `last active ${activeAt(topic).slice(0, 16).replace('T', ' ')}`,
            topic.archived ? 'put away by the person' : undefined
          ]
          const working = threads
            .filter((thread) => thread.kind === 'topic' && of(thread.id) === topic.id)
            .slice(0, INDEXED.threads)
            .map((thread) => {
              const answering = thread.state === 'working' ? doing?.(thread.id) : undefined
              const about = shorten(summary?.(thread.id) ?? '', ABOUT_LENGTH)
              const said = [
                thread.state,
                thread.folder === undefined ? undefined : `working in ${thread.folder}`,
                thread.id === focus ? 'the one the person last turned to' : undefined,
                answering ? `answering: ${answering}` : undefined
              ]
              return `  - thread ${thread.id}: "${thread.title}" (${said.filter(Boolean).join(', ')})${about === '' ? '' : `\n    about: ${about}`}`
            })
          return [`- topic ${topic.id}: "${topic.title}" (${facts.filter(Boolean).join(', ')})`, ...working].join('\n')
        })
        .join('\n')
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
