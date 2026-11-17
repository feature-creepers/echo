import {
  type AssistantState,
  type CommandError,
  type CommandInput,
  type Event,
  type Exchange,
  exchangeSchema,
  FACT_KINDS,
  type Fact,
  type FactKind,
  type MemoryView,
  type SleepSettings
} from '@repo/protocol'
import { z } from 'zod'
import { EXCHANGE } from '../channel/channel.ts'
import type { EngineRoom } from '../engines/engines.ts'
import type { Timers } from '../ports/clock.ts'
import type { Harness } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import { ERASURE, type NewRecord, type Records, type StoredRecord } from '../ports/records.ts'
import type { Search } from '../ports/search.ts'
import type { Tool } from '../tools/tools.ts'
import { shorten, UnreadableAnswer } from './answer.ts'
import { type Candidate, extract } from './extract.ts'
import { createFactBook, FACT, type FactRecord, type KnownFact } from './facts.ts'
import { basisOf, PROFILE, profileFor, readProfileRecord, writeProfile } from './profile.ts'
import { recallBlock, recallFor } from './recall.ts'
import { type Decision, reconcile } from './reconcile.ts'
import { foldWord } from './searchable.ts'
import { createSleepSchedule, DEFAULT_SLEEP, readSleepSettings, SLEEP_SET } from './sleep.ts'
import { MEMORY_INSTRUCTIONS, memoryTools } from './tools.ts'

/**
 * The assistant's memory (docs/SPEC.md, section 10).
 *
 * Awake, it keeps the words: the channel writes each exchange to the log, which the search index takes in at
 * once. Asleep, it makes sense of them: what was said since the last sleep is read in batches by a cheap
 * model, which picks out facts about the user and weighs each against the similar facts already known. Before
 * each turn, what bears on it is recalled from the facts and the log, with no model call.
 */

/** The type of the record written after each batch a sleep made sense of: the last exchange it read. */
export const SLEPT = 'memory.slept'

const sleptSchema = z.object({ through: z.string(), at: z.string() })

/** The most exchanges, and characters, one model call reads. Small enough to be read with care. */
const BATCH_EXCHANGES = 12
const BATCH_CHARACTERS = 9000
/** The known facts each candidate is compared with. */
const SIMILAR_FACTS = 3
/** How much of what the user said is shown beside a fact, as where it was learned. */
const SOURCE_LENGTH = 200
/** Two facts are both meant by a description when the second matches it nearly as well as the first. */
const AMBIGUOUS = 0.8

export interface MemoryOptions {
  records: Records
  search: Search
  /** Where the harness for the sleep's model calls comes from. */
  engines: Pick<EngineRoom, 'active'>
  log: Log
  now: () => Date
  /** A new identifier, unique for good, for each new fact. */
  newId: () => string
  /** Left out, the assistant falls asleep only when told. */
  timers?: Timers | undefined
  /** The turn under way, kept as the source of what is remembered on request. */
  turn?: () => string | undefined
  /** Whether the assistant is answering: it does not fall asleep in the middle of an answer. */
  busy?: () => boolean
}

export type MemoryChange = { ok: true; memory: MemoryView } | { ok: false; error: CommandError }
export type SleepRequest = { ok: true; done: Promise<void> } | { ok: false; error: CommandError }

export interface Memory {
  /** What to add ahead of what the user said: the memories that bear on it. Nothing when none does. */
  recall(said: string, knownSince?: string): string | undefined
  /** The profile every session is given, and the version of the last one sleep wrote. Nothing while nothing is known. */
  profile(): { text: string; version?: string } | undefined
  /** The tools sessions use to search, remember and forget. */
  tools: readonly Tool[]
  /** What sessions are told about those tools. */
  instructions: string
  /** Something was said or answered: wake up at once if asleep, and start the quiet period again. */
  wake(): void
  /** Fall asleep now. `done` resolves when the sleep's work is over, or was cut short by waking. */
  sleepNow(): SleepRequest
  state(): AssistantState
  read(): MemoryView
  /** The facts true now. */
  facts(): KnownFact[]
  /** Keep a fact at once, as the user asked. */
  remember(text: string, kind?: FactKind): KnownFact
  edit(input: CommandInput<'memory.edit'>): MemoryChange
  forget(fact: string): MemoryChange
  setSleep(input: CommandInput<'memory.sleep-settings.set'>): MemoryView
  /** Be told `memory.changed` and `assistant.state`. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** Stop the timers. */
  close(): void
}

interface LoggedExchange {
  record: StoredRecord
  exchange: Exchange
}

interface Profile {
  record: string
  at: string
  text: string
  basis: string
}

export function createMemory(options: MemoryOptions): Memory {
  const { records, search, engines, log, now, newId } = options
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  // What the records say, read once. From here on, each record written is taken in as it is written.
  const stored = records.read([FACT, PROFILE, SLEEP_SET, SLEPT])
  const book = createFactBook(stored)
  let profiles: Profile[] = []
  let settings: SleepSettings = DEFAULT_SLEEP
  let cursor: { through: string; at: string } | undefined
  let lastSlept: string | undefined
  for (const record of stored) {
    if (record.type === PROFILE) {
      const profile = readProfileRecord(record.payload)
      if (profile) profiles.push({ record: record.id, at: record.at, ...profile })
    } else if (record.type === SLEEP_SET) {
      settings = readSleepSettings(record.payload) ?? settings
    } else if (record.type === SLEPT) {
      const slept = sleptSchema.safeParse(record.payload)
      if (slept.success) {
        cursor = slept.data
        lastSlept = record.at
      }
    }
  }
  let revision = stored.length

  let asleep: { since: string; generation: number } | undefined
  let generation = 0
  let work: { done: number; total: number } | undefined
  let running: Promise<void> = Promise.resolve()

  const state = (): AssistantState => ({
    asleep: asleep !== undefined,
    ...(asleep ? { since: asleep.since } : {}),
    ...(work ? { work } : {}),
    ...(lastSlept === undefined ? {} : { lastSlept })
  })
  const announce = () => emit({ type: 'event', name: 'assistant.state', state: state() })
  const changed = () => {
    revision++
    emit({ type: 'event', name: 'memory.changed', memory: read() })
  }

  /** Write records and take them in. */
  const write = (written: readonly NewRecord[]): StoredRecord[] => {
    const kept = records.append(written)
    for (const record of kept) book.take(record)
    return kept
  }

  const factRecord = (fact: FactRecord): NewRecord => ({ type: FACT, payload: fact })

  // —— Reading ——

  const exchanges = (): LoggedExchange[] =>
    records.read([EXCHANGE]).flatMap((record) => {
      const exchange = exchangeSchema.safeParse(record.payload)
      return exchange.success && exchange.data.outcome !== 'running' ? [{ record, exchange: exchange.data }] : []
    })

  // What the user said in the turns facts came from, kept so the view is not built from the whole log each time.
  // The log is read again only when a source is missing and something was said since the last reading.
  const said = new Map<string, Exchange>()
  let logGrew = true

  const read = (): MemoryView => {
    const facts = book.current()
    const wanted = new Set(facts.flatMap((fact) => fact.sources))
    if (logGrew && [...wanted].some((turn) => !said.has(turn))) {
      logGrew = false
      for (const { exchange } of exchanges()) if (wanted.has(exchange.turn)) said.set(exchange.turn, exchange)
    }
    const shown = (fact: KnownFact): Fact => ({
      id: fact.fact,
      text: fact.text,
      kind: fact.kind,
      origin: fact.origin,
      since: fact.since,
      at: fact.at,
      sources: fact.sources.map((turn) => {
        const exchange = said.get(turn)
        return exchange ? { turn, at: exchange.at, said: shorten(exchange.said, SOURCE_LENGTH) } : { turn, at: fact.since }
      })
    })
    const groups = FACT_KINDS.flatMap((kind) => {
      const ofKind = facts.filter((fact) => fact.kind === kind).map(shown)
      return ofKind.length === 0 ? [] : [{ kind, facts: ofKind }]
    })
    const profile = profiles.at(-1)
    return { revision, groups, ...(profile ? { profile: profile.text } : {}), sleep: settings }
  }

  const find = (query: string, after?: string, before?: string) => {
    const at = now().toISOString()
    const period = { ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) }
    const facts = unique(
      search.search({ text: query, types: [FACT], limit: 24, ...period, recency: { now: at, halfLifeDays: 365 } }).flatMap((hit) => {
        const fact = book.byRecord(hit.record)
        return fact ? [{ fact, score: hit.score }] : []
      })
    )
    const said = search.search({ text: query, types: [EXCHANGE], limit: 6, ...period, recency: { now: at, halfLifeDays: 90 } })
    return { facts, said }
  }

  /** The known facts most like a text, best first, each once. */
  const similarTo = (text: string): KnownFact[] => {
    const hits = search.search({ text, types: [FACT], limit: SIMILAR_FACTS * 4 }).flatMap((hit) => {
      const fact = book.byRecord(hit.record)
      return fact ? [{ fact, score: hit.score }] : []
    })
    return unique(hits)
      .slice(0, SIMILAR_FACTS)
      .map(({ fact }) => fact)
  }

  // —— Writing, awake ——

  const remember = (text: string, kind: FactKind = 'other'): { fact: KnownFact; known: boolean } => {
    const clean = shorten(text, 500)
    const same = book.current().find((fact) => foldWord(fact.text) === foldWord(clean))
    if (same) return { fact: same, known: true }
    const turn = options.turn?.()
    const at = now().toISOString()
    const [record] = write([factRecord({ fact: newId(), text: clean, kind, origin: 'told', sources: turn === undefined ? [] : [turn], since: at })])
    changed()
    return { fact: book.byRecord(record?.id ?? '') as KnownFact, known: false }
  }

  const forget = (id: string): boolean => {
    if (!book.get(id)) return false
    // The profile may say what is forgotten: it goes too, and is written again at the next sleep.
    const erased = [...book.recordsToForget(id), ...profiles.map((profile) => profile.record)]
    records.append([{ type: ERASURE, payload: { records: erased } }])
    book.drop(id)
    profiles = []
    changed()
    return true
  }

  const unknownFact = (id: string): MemoryChange => ({ ok: false, error: { code: 'unknown-fact', message: `There is no fact "${id}" now.` } })

  // —— Sleeping ——

  const pending = (): LoggedExchange[] => {
    const all = exchanges()
    if (!cursor) return all
    const through = cursor.through
    const index = all.findIndex(({ record }) => record.id === through)
    if (index >= 0) return all.slice(index + 1)
    const after = cursor.at
    return all.filter(({ record }) => record.at > after)
  }

  const batchFrom = (all: readonly LoggedExchange[], start: number): LoggedExchange[] => {
    const batch: LoggedExchange[] = []
    let characters = 0
    for (const logged of all.slice(start, start + BATCH_EXCHANGES)) {
      characters += logged.exchange.said.length + Math.min(logged.exchange.replied.length, 400)
      if (batch.length > 0 && characters > BATCH_CHARACTERS) break
      batch.push(logged)
    }
    return batch
  }

  /** What a batch says that is worth keeping, decided against what is known. */
  const understand = async (harness: Harness, batch: readonly LoggedExchange[]): Promise<Decision[]> => {
    const candidates = await extract(
      harness,
      batch.map(({ exchange }) => exchange)
    )
    if (candidates.length === 0) return []
    return reconcile(
      harness,
      candidates.map((candidate) => ({ candidate, similar: similarTo(candidate.text) }))
    )
  }

  /** The records for what was decided, checked against what is known now: the user may have changed it meanwhile. */
  const recordsFor = (decisions: readonly Decision[], batch: readonly LoggedExchange[]): NewRecord[] => {
    const saidAt = new Map(batch.map(({ exchange }) => [exchange.turn, exchange.at]))
    const firstSaid = (candidate: Candidate) =>
      candidate.turns
        .map((turn) => saidAt.get(turn))
        .filter((at): at is string => at !== undefined)
        .sort()[0] ?? now().toISOString()
    return decisions.flatMap((decision): NewRecord[] => {
      if (decision.action === 'ignore') return []
      const { candidate, text } = decision
      const known = decision.action === 'add' ? undefined : book.get(decision.fact.fact)
      if (decision.action === 'update' && known) {
        const sources = [...new Set([...known.sources, ...candidate.turns])]
        return [factRecord({ fact: known.fact, text, kind: known.kind, origin: 'conversation', sources, since: known.since })]
      }
      const fresh: FactRecord = { fact: newId(), text, kind: candidate.kind, origin: 'conversation', sources: candidate.turns, since: firstSaid(candidate) }
      return [factRecord(decision.action === 'replace' && known ? { ...fresh, replaces: known.fact } : fresh)]
    })
  }

  const dream = async (dreaming: number) => {
    const woken = () => asleep?.generation !== dreaming
    const harness = await engines.active()
    if (woken() || !harness) return

    const all = pending()
    work = { done: 0, total: all.length }
    announce()
    let retried = false
    let start = 0
    while (start < all.length) {
      const batch = batchFrom(all, start)
      let decisions: Decision[]
      try {
        decisions = await understand(harness, batch)
      } catch (error) {
        if (woken()) return
        if (!(error instanceof UnreadableAnswer)) {
          // The harness could not be reached: the rest waits for the next sleep, from this batch on.
          log.error(`Sleep stopped: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
        if (!retried) {
          retried = true
          continue
        }
        // Read twice and still not understood: passed over, so that one batch cannot stop every sleep after it.
        log.error(`Sleep passed over ${batch.length} exchanges it could not make sense of: ${error.message}`)
        decisions = []
      }
      // Woken during the call: the batch is made sense of again at the next sleep.
      if (woken()) return
      retried = false
      const last = batch.at(-1) as LoggedExchange
      const learned = recordsFor(decisions, batch)
      cursor = { through: last.record.id, at: last.record.at }
      write([...learned, { type: SLEPT, payload: cursor }])
      start += batch.length
      work = { done: start, total: all.length }
      if (learned.length > 0) changed()
      announce()
    }

    const facts = book.current()
    const profile = profiles.at(-1)
    if (facts.length > 0 && profile?.basis !== basisOf(facts)) {
      try {
        const text = await writeProfile(harness, facts, now())
        if (woken()) return
        if (text !== '') {
          const basis = basisOf(book.current())
          const [record] = records.append([{ type: PROFILE, payload: { text, basis } }])
          if (record) profiles.push({ record: record.id, at: record.at, text, basis })
          changed()
        }
      } catch (error) {
        if (woken()) return
        log.error(`The profile could not be written: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    work = undefined
    lastSlept = now().toISOString()
    announce()
  }

  const fallAsleep = (): Promise<void> => {
    if (asleep) return running
    generation++
    asleep = { since: now().toISOString(), generation }
    announce()
    running = dream(generation).catch((error: unknown) => {
      log.error(`Sleep failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return running
  }

  const schedule = createSleepSchedule(settings, {
    now,
    timers: options.timers,
    busy: () => options.busy?.() ?? false,
    fallAsleep: () => {
      if (settings.when !== 'never') void fallAsleep()
    }
  })

  const tools = memoryTools({
    find: (query, after, before) => {
      const { facts, said } = find(query, after, before)
      return { facts: facts.map(({ fact }) => fact), exchanges: said }
    },
    remember,
    match(description) {
      const { facts } = find(description)
      const best = facts[0]
      return best ? facts.filter(({ score }) => score >= best.score * AMBIGUOUS).map(({ fact }) => fact) : []
    },
    forget
  })

  return {
    recall(said, knownSince) {
      try {
        return recallBlock(recallFor({ search, facts: book, now }, { said, knownSince }))
      } catch (error) {
        // A memory that cannot be searched must not stop the answer.
        log.error(`Recall failed: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    },
    profile: () => {
      const profile = profiles.at(-1)
      const text = profileFor(profile, book.current())
      if (text === undefined) return undefined
      return profile ? { text, version: profile.record } : { text }
    },
    tools,
    instructions: MEMORY_INSTRUCTIONS,
    wake() {
      logGrew = true
      schedule.heard()
      if (!asleep) return
      asleep = undefined
      work = undefined
      announce()
    },
    sleepNow() {
      if (settings.when === 'never') return { ok: false, error: { code: 'sleep-off', message: 'The user chose that the assistant never sleeps.' } }
      return { ok: true, done: fallAsleep() }
    },
    state,
    read,
    facts: () => book.current(),
    remember: (text, kind) => remember(text, kind).fact,
    edit({ fact: id, text, kind }) {
      const known = book.get(id)
      if (!known) return unknownFact(id)
      const clean = text.trim()
      if (clean === known.text && (kind === undefined || kind === known.kind)) return { ok: true, memory: read() }
      const { fact, sources, since, replaces } = known
      write([factRecord({ fact, text: clean, kind: kind ?? known.kind, origin: 'edited', sources, since, ...(replaces === undefined ? {} : { replaces }) })])
      changed()
      return { ok: true, memory: read() }
    },
    forget: (id) => (forget(id) ? { ok: true, memory: read() } : unknownFact(id)),
    setSleep(input) {
      const next: SleepSettings = { ...settings, ...definedOnly(input) }
      if (JSON.stringify(next) === JSON.stringify(settings)) return read()
      records.append([{ type: SLEEP_SET, payload: next }])
      settings = next
      schedule.follow(settings)
      changed()
      return read()
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => schedule.close()
  }
}

/** Each fact once, at its best score, best first. */
function unique(found: readonly { fact: KnownFact; score: number }[]): { fact: KnownFact; score: number }[] {
  const best = new Map<string, { fact: KnownFact; score: number }>()
  for (const hit of found) if ((best.get(hit.fact.fact)?.score ?? -1) < hit.score) best.set(hit.fact.fact, hit)
  return [...best.values()].sort((one, other) => other.score - one.score)
}

/** The fields of a partial setting that were given. */
function definedOnly<Value extends object>(partial: Value): { [Key in keyof Value]?: Exclude<Value[Key], undefined> } {
  return Object.fromEntries(Object.entries(partial).filter(([, value]) => value !== undefined)) as { [Key in keyof Value]?: Exclude<Value[Key], undefined> }
}
