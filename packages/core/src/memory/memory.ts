import {
  type AssistantState,
  type CommandError,
  type CommandInput,
  type Event,
  type Exchange,
  exchangeSchema,
  FACT_KINDS,
  FACT_MAX_LENGTH,
  type Fact,
  type FactKind,
  inConversation,
  type MemoryImport,
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
import { shorten } from '../text.ts'
import type { Tool } from '../tools/tools.ts'
import { UnreadableAnswer } from './answer.ts'
import { EARLIER_LINE, type EarlierFact, type EarlierLine, earlierLineSchema, IMPORTED, importedSchema } from './earlier.ts'
import { type Candidate, extract } from './extract.ts'
import { createFactBook, FACT, type FactRecord, type KnownFact } from './facts.ts'
import { basisOf, PROFILE, profileFor, readProfileRecord, writeProfile } from './profile.ts'
import { recallBlock, recallFor } from './recall.ts'
import { type Decision, reconcile } from './reconcile.ts'
import { CONVERSATION_RECORDS, expiredNow, RETENTION_PASS_MS, RETENTION_SET, readRetention, wordsOfTurns } from './retention.ts'
import { foldWord } from './searchable.ts'
import { createSleepSchedule, DEFAULT_SLEEP, readSleepSettings, SLEEP_SET } from './sleep.ts'
import { readSummaryRecord, type SummaryRecord, summariesDue, THREAD_SUMMARY, writeSummary } from './summary.ts'
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
const SLEPT = 'memory.slept'

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
  /** A thread's title, for its summary. */
  titleOf?: (thread: string) => string | undefined
  /**
   * Lines of the log erased while the app was open, by the retention period or with a fact forgotten, for whoever
   * keeps them in memory. Not called for what is erased as the memory is made: nothing has read the log yet.
   */
  erased?: (turns: ReadonlySet<string>) => void
}

export type MemoryChange = { ok: true; memory: MemoryView } | { ok: false; error: CommandError }
export type SleepRequest = { ok: true; done: Promise<void> } | { ok: false; error: CommandError }

export interface Memory {
  /** What to add ahead of what the user said: the memories that bear on it. Nothing when none does. */
  recall(said: string, knownSince?: string): string | undefined
  /** The profile every session is given, and the version of the last one sleep wrote. Nothing while nothing is known. */
  profile(): { text: string; version?: string } | undefined
  /** What a thread is about and where it stands, as sleep last wrote it. Nothing before its first summary. */
  summary(thread: string): string | undefined
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
  /** Keep the conversation's words for so many days, or for good with null. What is older is erased at once. */
  setRetention(days: number | null): MemoryView
  /**
   * Keep what the proof of concept knew, found in its folder (`from`): facts not known yet, and lines of its history
   * not brought in before. Says how much was new.
   */
  bringIn(found: { from: string; facts: readonly EarlierFact[]; lines: readonly EarlierLine[] }): MemoryImport
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
  const stored = records.read([FACT, PROFILE, SLEEP_SET, SLEPT, THREAD_SUMMARY, RETENTION_SET])
  const book = createFactBook(stored)
  let profiles: Profile[] = []
  /** Each thread's latest summary, with the record that keeps it. */
  const summaries = new Map<string, SummaryRecord & { record: string }>()
  let settings: SleepSettings = DEFAULT_SLEEP
  /** How many days the conversation's words are kept; null keeps them for good, as by default. */
  let retentionDays: number | null = null
  let cursor: { through: string; at: string } | undefined
  let lastSlept: string | undefined
  for (const record of stored) {
    if (record.type === PROFILE) {
      const profile = readProfileRecord(record.payload)
      if (profile) profiles.push({ record: record.id, at: record.at, ...profile })
    } else if (record.type === THREAD_SUMMARY) {
      const summary = readSummaryRecord(record.payload)
      if (summary) summaries.set(summary.thread, { ...summary, record: record.id })
    } else if (record.type === SLEEP_SET) {
      settings = readSleepSettings(record.payload) ?? settings
    } else if (record.type === RETENTION_SET) {
      retentionDays = readRetention(record.payload) ?? retentionDays
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

  // What a thread handed a sub-thread is the assistant's own work, not the person's words: no fact or summary comes of it.
  const exchanges = (): LoggedExchange[] =>
    records.read([EXCHANGE]).flatMap((record) => {
      const exchange = exchangeSchema.safeParse(record.payload)
      return exchange.success && exchange.data.outcome !== 'running' && inConversation(exchange.data) ? [{ record, exchange: exchange.data }] : []
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
    return { revision, groups, ...(profile ? { profile: profile.text } : {}), sleep: settings, retentionDays, ...(imported ? { imported } : {}) }
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
    const said = search.search({ text: query, types: [EXCHANGE, EARLIER_LINE], limit: 6, ...period, recency: { now: at, halfLifeDays: 90 } })
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
    const clean = shorten(text, FACT_MAX_LENGTH)
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
    // The words it was learned from leave the log too, so that it cannot be recalled from them: the lines of those
    // turns, their tool calls and the views they showed that are no longer on the screen.
    const words = wordsOfTurns(records.read(CONVERSATION_RECORDS), new Set(book.turnsToForget(id)))
    // The profile and the summaries may say what is forgotten: they go too, and are written again at the next sleep.
    const erased = [
      ...book.recordsToForget(id),
      ...words.records,
      ...profiles.map((profile) => profile.record),
      ...[...summaries.values()].map((summary) => summary.record)
    ]
    records.append([{ type: ERASURE, payload: { records: erased } }])
    book.drop(id)
    profiles = []
    summaries.clear()
    for (const turn of words.turns) said.delete(turn)
    if (words.turns.size > 0) options.erased?.(words.turns)
    changed()
    return true
  }

  // —— What the proof of concept knew ——

  /** The latest import, as the view shows it. */
  let imported: MemoryImport | undefined = records
    .read([IMPORTED])
    .flatMap((record) => {
      const read = importedSchema.safeParse(record.payload)
      return read.success ? [{ at: record.at, facts: read.data.facts, lines: read.data.lines }] : []
    })
    .at(-1)

  const bringIn = ({ from, facts, lines }: { from: string; facts: readonly EarlierFact[]; lines: readonly EarlierLine[] }): MemoryImport => {
    // A fact already known, in whatever capitals and accents, is not kept twice; nor a line already brought in.
    const known = new Set(book.current().map((fact) => foldWord(fact.text)))
    const fresh = facts.filter((fact) => {
      const key = foldWord(fact.text)
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    const lineKey = (at: string, said: string, replied: string) => JSON.stringify([at, said, replied])
    const brought = new Set(
      records.read([EARLIER_LINE]).flatMap((record) => {
        const line = earlierLineSchema.safeParse(record.payload)
        return line.success ? [lineKey(record.at, line.data.said, line.data.replied)] : []
      })
    )
    const newLines = lines.filter((line) => {
      const key = lineKey(line.at, line.said, line.replied)
      if (brought.has(key)) return false
      brought.add(key)
      return true
    })
    const at = now().toISOString()
    // Kept together: the facts, the lines dated when they were said, and the record of the import.
    const written = write([
      ...fresh.map((fact) => factRecord({ fact: newId(), text: fact.text, kind: fact.kind, origin: 'imported', sources: [], since: at })),
      ...newLines.map((line) => ({ type: EARLIER_LINE, payload: { said: line.said, replied: line.replied }, at: line.at })),
      { type: IMPORTED, payload: { from, facts: fresh.length, lines: newLines.length } }
    ])
    imported = { at: written.at(-1)?.at ?? at, facts: fresh.length, lines: newLines.length }
    changed()
    return imported
  }

  // —— Keeping the words for a period ——

  /**
   * Erase the words older than the period, with one tombstone. True when anything was erased. The facts keep the
   * turns they came from; their words are simply no longer there to show.
   */
  const applyRetention = (tell: boolean): boolean => {
    let expired: ReturnType<typeof expiredNow>
    try {
      expired = expiredNow(records, retentionDays, now())
    } catch (error) {
      log.error(`The retention period could not be applied: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    if (expired.records.length === 0) return false
    records.append([{ type: ERASURE, payload: { records: expired.records } }])
    for (const turn of expired.turns) said.delete(turn)
    if (tell && expired.turns.size > 0) options.erased?.(expired.turns)
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
    if (await summarise(harness, woken)) return
    work = undefined
    lastSlept = now().toISOString()
    announce()
  }

  /**
   * Bring the summaries of the threads used since the last sleep up to date, the most recent first. True when
   * woken meanwhile: what is left waits for the next sleep.
   */
  const summarise = async (harness: Harness, woken: () => boolean): Promise<boolean> => {
    const due = summariesDue(
      exchanges().map(({ exchange }) => exchange),
      summaries
    )
    for (const { thread, exchanges: fresh } of due) {
      try {
        const text = await writeSummary(harness, { title: options.titleOf?.(thread), summary: summaries.get(thread)?.text }, fresh, now())
        if (woken()) return true
        if (text === '') continue
        const payload: SummaryRecord = { thread, text, through: (fresh.at(-1) as Exchange).turn }
        const [record] = records.append([{ type: THREAD_SUMMARY, payload }])
        if (record) summaries.set(thread, { ...payload, record: record.id })
      } catch (error) {
        if (woken()) return true
        // The harness failed: the other summaries wait for the next sleep.
        log.error(`A thread's summary could not be written: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    }
    return false
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

  // The period is applied as the memory is made, before anything reads the log, then twice a day while the app stays open.
  applyRetention(false)
  let cancelRetention = () => {}
  const armRetention = () => {
    cancelRetention =
      options.timers?.after(RETENTION_PASS_MS, () => {
        if (applyRetention(true)) changed()
        armRetention()
      }) ?? (() => {})
  }
  armRetention()

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
    summary: (thread) => summaries.get(thread)?.text,
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
    setRetention(days) {
      if (days === retentionDays) return read()
      records.append([{ type: RETENTION_SET, payload: { days } }])
      retentionDays = days
      applyRetention(true)
      changed()
      return read()
    },
    bringIn,
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close() {
      schedule.close()
      cancelRetention()
    }
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
