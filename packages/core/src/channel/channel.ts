import { type Event, type Exchange, exchangeSchema, type Persona, type Thread, type Threads, type TurnId } from '@repo/protocol'
import { z } from 'zod'
import type { EngineRoom } from '../engines/engines.ts'
import type { Harness, Session, SessionEvent } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import type { Records } from '../ports/records.ts'
import type { UserSettings } from '../settings/settings.ts'
import { languageOf } from '../speech/language.ts'
import { createSentenceCutter, type SentenceCutter, speakable } from '../speech/sentences.ts'
import { createThreadRegistry } from '../threads/registry.ts'
import type { Grant, Tool } from '../tools/tools.ts'
import type { Screen, Showing } from '../views/screen.ts'
import { instructionsFor, orchestratorInstructions, threadInstructions } from './instructions.ts'

/** The type of the record written when a turn is over: one line of the channel log, word for word. */
export const EXCHANGE = 'channel.exchange'

/** How many of the latest lines a new session is told about, so it carries on where the last one stopped. */
const RECAP_EXCHANGES = 8

/** The languages the voice is asked to tell apart. */
const LANGUAGES = ['en', 'fr'] as const

/** What sessions can do besides speak, given by the core. */
export interface Abilities {
  /** Where the tool server listens. Nothing while it is not running: there are then no threads, and one session answers. */
  server(): string | undefined
  /** Give a session the right to call these tools, under a token of its own. */
  grant(tools: readonly Tool[]): Grant
  /** The tools a thread works with: the screen, bound to where its views go. */
  threadTools(showing: () => Showing): Tool[]
  /** What a thread is told about its tools, added to its instructions. */
  instructions: string
}

export interface ChannelOptions {
  engines: EngineRoom
  settings: UserSettings
  records: Records
  screen: Screen
  log: Log
  now: () => Date
  /** A new identifier, unique for good. */
  newId: () => string
  /** What sessions can do besides speak. Left out, one session answers everything, and only speaks. */
  abilities?: Abilities
  /** The user's time zone, as an IANA name. Left out, the machine's. */
  timeZone?: string
}

/** A moment as a person says it, with its time zone: "Tuesday, 17 November 2026, 14:13 (Europe/Paris)". */
export function moment(at: Date, timeZone?: string): string {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const written = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone
  }).format(at)
  return `${written.replace(' at ', ', ')} (${zone})`
}

/** The single conversation: it takes what the user says, one turn at a time, and announces the answer as it comes. */
export interface Channel {
  /** The user said something. The answer follows as events. Said during an answer, it takes the answer's place. */
  say(text: string, language?: string): TurnId
  /** Stop the answer under way, if there is one. */
  stop(): void
  /** The latest lines of the transcript, oldest first. */
  read(limit: number): Exchange[]
  /** The threads, and the one in focus. */
  threads(): Threads
  /** Bring a thread to the stage, with its last answer if it was waiting to be seen. False when there is no such thread. */
  focus(thread: string): boolean
  /** Be told each event of the conversation. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** End every session. The next thing said opens new ones. */
  close(): void
}

interface Turn {
  exchange: Exchange
  language: string | undefined
  cutter: SentenceCutter
  /** The user stopped it: nothing more of it is said or kept. */
  stopped: boolean
  /** The thread answering it, once the orchestrator has passed it on. */
  routed: Runtime | undefined
}

/** A live session, and what it was opened for. When any of that changes, the session is replaced. */
interface Live {
  session: Session
  key: string
  grant: Grant | undefined
}

/** A thread at work: its session, the turn it answers, and what waits for it. */
interface Runtime {
  thread: string
  live: Live | undefined
  answering: Turn | undefined
  queue: { turn: Turn; text: string }[]
}

const openInput = z.object({ title: z.string().trim().min(1).max(80), kind: z.enum(['topic', 'aside']).default('topic'), request: z.string().optional() })
const sendInput = z.object({ thread: z.string().min(1), request: z.string().optional() })
const focusInput = z.object({ thread: z.string().min(1) })

/**
 * The channel hears every turn through the orchestrator, a warm session on a fast model, which answers small
 * things itself and passes the rest to threads. A thread answers the user directly, sentence by sentence.
 * When the user moves on before a thread has finished, it finishes in the background and its answer waits,
 * marked ready, to be brought back.
 *
 * The store is the truth and sessions are caches: when the harness or the persona changes, or after a
 * restart, new sessions are opened and told the latest lines of what concerns them.
 */
export function createChannel(options: ChannelOptions): Channel {
  const { engines, settings, records, screen, log, now, newId, abilities } = options
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  const transcript: Exchange[] = []
  for (const record of records.read([EXCHANGE])) {
    const exchange = exchangeSchema.safeParse(record.payload)
    if (exchange.success) transcript.push(exchange.data)
  }
  const registry = createThreadRegistry({ records, now, newId })
  registry.onEvent(emit)

  /** The turn on the stage: what is said is said aloud. */
  let current: Turn | undefined
  /** The orchestrator, and the turn it is deciding about. */
  let orchestrator: Live | undefined
  let deciding: Turn | undefined
  /** Said while the orchestrator was still busy: decided about as soon as it is free. */
  let pending: Turn | undefined
  const runtimes = new Map<string, Runtime>()

  const activePersona = (): Persona => {
    const { available, active } = settings.read().personas
    const persona = available.find((candidate) => candidate.id === active) ?? available[0]
    if (!persona) throw new Error('There is no persona.')
    return persona
  }

  const replace = (exchange: Exchange) => {
    const at = transcript.findIndex((line) => line.turn === exchange.turn)
    if (at >= 0) transcript[at] = exchange
    else transcript.push(exchange)
  }

  /** A sentence of a turn: kept in the transcript, and said aloud while the turn is on the stage. */
  const say = (turn: Turn, sentence: string) => {
    if (turn.stopped) return
    const text = speakable(sentence)
    if (text === '') return
    turn.exchange = { ...turn.exchange, replied: turn.exchange.replied ? `${turn.exchange.replied} ${text}` : text }
    replace(turn.exchange)
    if (current !== turn) return
    const language = languageOf(text, LANGUAGES, turn.language)
    emit({ type: 'event', name: 'speech.say', turn: turn.exchange.turn, text, ...(language === undefined ? {} : { language }) })
  }

  const finish = (turn: Turn, outcome: Exchange['outcome'], problem?: string) => {
    if (turn.exchange.outcome !== 'running') return
    for (const sentence of turn.cutter.flush()) say(turn, sentence)
    turn.exchange = problem === undefined ? { ...turn.exchange, outcome } : { ...turn.exchange, outcome, problem }
    replace(turn.exchange)
    records.append([{ type: EXCHANGE, payload: turn.exchange }])
    if (current === turn) current = undefined
    emit({ type: 'event', name: 'turn.ended', exchange: turn.exchange })
  }

  const recapFor = (thread: string | undefined) =>
    transcript.filter((line) => line.outcome !== 'running' && (thread === undefined || line.thread === thread)).slice(-RECAP_EXCHANGES)

  const end = (live: Live | undefined) => {
    live?.session.close()
    live?.grant?.revoke()
  }

  /** The harness in use, or why there is none. */
  const harness = async (): Promise<Harness | string> => {
    try {
      return (await engines.active()) ?? 'No AI program is ready. Install Claude Code or Codex and sign in, then try again.'
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  // ---------------------------------------------------------------- threads

  const runtimeFor = (thread: string): Runtime => {
    let runtime = runtimes.get(thread)
    if (!runtime) {
      runtime = { thread, live: undefined, answering: undefined, queue: [] }
      runtimes.set(thread, runtime)
    }
    return runtime
  }

  const threadSession = (runtime: Runtime, engine: Harness, server: string): Session => {
    const thread = registry.get(runtime.thread)
    const persona = activePersona()
    const key = JSON.stringify([engine.id, persona.id, persona.name, persona.stance, server])
    if (runtime.live?.key === key) return runtime.live.session
    end(runtime.live)
    const kind = thread?.kind ?? 'topic'
    const grant = abilities?.grant(
      abilities.threadTools(() => ({
        thread: runtime.thread,
        turn: runtime.answering?.exchange.turn,
        slot: kind === 'aside' ? 'margin' : 'stage',
        focused: registry.focused()?.id === runtime.thread
      }))
    )
    const instructions = threadInstructions({
      persona,
      earlier: recapFor(runtime.thread),
      title: thread?.title ?? 'A topic',
      kind,
      ...(abilities ? { abilities: abilities.instructions } : {})
    })
    const session = engine.open(grant ? { role: 'thread', instructions, tools: { url: server, token: grant.token } } : { role: 'thread', instructions })
    const live: Live = { session, key, grant }
    runtime.live = live
    session.onEvent((event) => hearThread(runtime, live, event))
    return session
  }

  const hearThread = (runtime: Runtime, live: Live, event: SessionEvent) => {
    if (runtime.live !== live) return
    const turn = runtime.answering
    switch (event.type) {
      case 'text':
        if (turn) for (const sentence of turn.cutter.push(event.text)) say(turn, sentence)
        return
      case 'tool':
        if (turn) emit({ type: 'event', name: 'activity', turn: turn.exchange.turn, tool: event.name, phase: event.phase })
        return
      case 'turn-end': {
        if (!turn) return
        const seen = current === turn
        finish(turn, turn.stopped ? 'stopped' : 'done')
        runtime.answering = undefined
        registry.setState(runtime.thread, seen || turn.stopped ? 'parked' : 'ready')
        return void next(runtime)
      }
      case 'failed':
        log.error(`A thread failed: ${event.reason}`)
        end(live)
        runtime.live = undefined
        if (turn) finish(turn, 'failed', event.reason)
        runtime.answering = undefined
        registry.setState(runtime.thread, 'parked')
        for (const waiting of runtime.queue.splice(0)) finish(waiting.turn, 'failed', event.reason)
        return
    }
  }

  /** Give the thread the next request that waits for it, if it is free. */
  const next = async (runtime: Runtime) => {
    if (runtime.answering) return
    const waiting = runtime.queue.shift()
    if (!waiting) return
    runtime.answering = waiting.turn
    registry.setState(runtime.thread, 'working')
    const engine = await harness()
    const server = abilities?.server()
    if (typeof engine === 'string' || server === undefined) {
      runtime.answering = undefined
      finish(waiting.turn, 'failed', typeof engine === 'string' ? engine : 'The tools are not running.')
      return void next(runtime)
    }
    if (waiting.turn.stopped) {
      runtime.answering = undefined
      finish(waiting.turn, 'stopped')
      return void next(runtime)
    }
    threadSession(runtime, engine, server).send(`${context()}\n${waiting.text}`)
  }

  /** Pass a turn to a thread, which answers it as soon as it is free. */
  const route = (turn: Turn, thread: Thread, text: string) => {
    const runtime = runtimeFor(thread.id)
    turn.routed = runtime
    turn.exchange = { ...turn.exchange, thread: thread.id }
    replace(turn.exchange)
    if (thread.kind === 'topic') {
      registry.focus(thread.id)
      screen.focus(thread.id)
    }
    runtime.queue.push({ turn, text })
    void next(runtime)
  }

  // ---------------------------------------------------------------- the orchestrator

  const orchestratorTools = (): Tool[] => [
    {
      definition: {
        name: 'thread_open',
        description: 'Open a new thread and pass it what the person said. kind "topic" for something to work on, "aside" for a quick side question.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The topic in a few words.' },
            kind: { type: 'string', enum: ['topic', 'aside'] },
            request: { type: 'string', description: 'What to pass on. Left out, what the person said.' }
          },
          required: ['title']
        }
      },
      run(input) {
        const turn = deciding
        const asked = openInput.safeParse(input)
        if (!turn) return { ok: false, text: 'There is nothing to pass on.' }
        if (!asked.success) return { ok: false, text: 'thread_open takes a title, a kind ("topic" or "aside") and a request.' }
        if (turn.routed) return { ok: false, text: 'This has already been passed on. Write nothing more.' }
        const thread = registry.open(asked.data.title, asked.data.kind)
        route(turn, thread, asked.data.request ?? turn.exchange.said)
        return { ok: true, text: `Thread ${thread.id} is answering. Write nothing more.` }
      }
    },
    {
      definition: {
        name: 'thread_send',
        description: 'Pass what the person said to an existing thread, which answers it.',
        inputSchema: {
          type: 'object',
          properties: {
            thread: { type: 'string', description: 'The thread id, from the list.' },
            request: { type: 'string', description: 'What to pass on. Left out, what the person said.' }
          },
          required: ['thread']
        }
      },
      run(input) {
        const turn = deciding
        const asked = sendInput.safeParse(input)
        if (!turn) return { ok: false, text: 'There is nothing to pass on.' }
        const thread = asked.success ? registry.get(asked.data.thread) : undefined
        if (!asked.success || !thread) return { ok: false, text: `There is no such thread. The threads are:\n${registry.index()}` }
        if (turn.routed) return { ok: false, text: 'This has already been passed on. Write nothing more.' }
        route(turn, thread, asked.data.request ?? turn.exchange.said)
        return { ok: true, text: `Thread ${thread.id} is answering. Write nothing more.` }
      }
    },
    {
      definition: {
        name: 'thread_focus',
        description: 'Bring an earlier topic back on screen. Then say in a few words that it is back.',
        inputSchema: { type: 'object', properties: { thread: { type: 'string' } }, required: ['thread'] }
      },
      run(input) {
        const asked = focusInput.safeParse(input)
        const thread = asked.success ? registry.get(asked.data.thread) : undefined
        if (thread?.kind !== 'topic') return { ok: false, text: `There is no such topic. The threads are:\n${registry.index()}` }
        registry.focus(thread.id)
        screen.focus(thread.id)
        if (thread.state === 'ready') registry.setState(thread.id, 'parked')
        return { ok: true, text: `"${thread.title}" is on screen.` }
      }
    }
  ]

  const orchestratorSession = (engine: Harness): Session => {
    const persona = activePersona()
    const server = abilities?.server()
    const key = JSON.stringify([engine.id, persona.id, persona.name, persona.stance, server ?? null])
    if (orchestrator?.key === key) return orchestrator.session
    end(orchestrator)
    const routing = abilities !== undefined && server !== undefined
    const grant = routing ? abilities.grant(orchestratorTools()) : undefined
    const session = grant
      ? engine.open({
          role: 'orchestrator',
          instructions: orchestratorInstructions({ persona, earlier: recapFor(undefined) }),
          tools: { url: server as string, token: grant.token }
        })
      : engine.open({ role: 'thread', instructions: instructionsFor({ persona, earlier: recapFor(undefined) }) })
    const live: Live = { session, key, grant }
    orchestrator = live
    session.onEvent((event) => hearOrchestrator(live, event))
    return session
  }

  const hearOrchestrator = (live: Live, event: SessionEvent) => {
    if (orchestrator !== live) return
    const turn = deciding
    switch (event.type) {
      case 'text':
        // Once a turn is passed on, its thread answers; what the orchestrator still writes is not said.
        if (turn && !turn.routed) for (const sentence of turn.cutter.push(event.text)) say(turn, sentence)
        return
      case 'tool':
        return
      case 'turn-end':
        deciding = undefined
        if (turn && !turn.routed) finish(turn, turn.stopped ? 'stopped' : 'done')
        return void decideNext()
      case 'failed':
        log.error(`The orchestrator failed: ${event.reason}`)
        end(live)
        orchestrator = undefined
        deciding = undefined
        if (turn && !turn.routed) finish(turn, 'failed', event.reason)
        return void decideNext()
    }
  }

  /** The moment and the place a turn happens in: a model has no clock of its own. */
  const context = () => `(Now: ${moment(now(), options.timeZone)})`

  /** What the orchestrator reads for each turn: the moment, the threads, then what the person said. */
  const message = (turn: Turn) =>
    abilities?.server() === undefined
      ? `${context()}\n${turn.exchange.said}`
      : `${context()}\nThreads:\n${registry.index()}\n\nThe person says: ${turn.exchange.said}`

  const decide = async (turn: Turn) => {
    deciding = turn
    emit({ type: 'event', name: 'turn.started', exchange: turn.exchange })
    const engine = await harness()
    if (deciding !== turn) return
    if (typeof engine === 'string') {
      deciding = undefined
      finish(turn, 'failed', engine)
      return void decideNext()
    }
    if (turn.stopped) {
      deciding = undefined
      finish(turn, 'stopped')
      return void decideNext()
    }
    orchestratorSession(engine).send(message(turn))
  }

  const decideNext = () => {
    const waiting = pending
    pending = undefined
    if (waiting) void decide(waiting)
  }

  /** Stop a turn: nothing more of it is said, and whoever works on it is interrupted. */
  const halt = (turn: Turn) => {
    if (turn.stopped || turn.exchange.outcome !== 'running') return
    turn.stopped = true
    if (turn.routed) {
      if (turn.routed.answering === turn) turn.routed.live?.session.interrupt()
      else {
        turn.routed.queue = turn.routed.queue.filter((waiting) => waiting.turn !== turn)
        finish(turn, 'stopped')
      }
    } else if (deciding === turn) {
      orchestrator?.session.interrupt()
    } else {
      finish(turn, 'stopped')
    }
  }

  return {
    say(text, language) {
      const persona = activePersona()
      const exchange: Exchange = { turn: newId(), at: now().toISOString(), persona: persona.id, said: text, replied: '', outcome: 'running' }
      const turn: Turn = { exchange, language, cutter: createSentenceCutter(), stopped: false, routed: undefined }
      transcript.push(exchange)

      const previous = current
      current = turn
      if (previous) {
        // What is said now takes the stage. A thread that was answering finishes in the background, and its
        // answer waits, marked ready; an answer the orchestrator was still giving is stopped.
        if (!previous.routed) halt(previous)
      }
      if (pending) finish(pending, 'stopped')
      pending = undefined
      if (deciding) pending = turn
      else void decide(turn)
      return exchange.turn
    },

    stop() {
      if (current) halt(current)
    },

    read: (limit) => transcript.slice(-limit),

    threads: () => registry.read(),

    focus(id) {
      const thread = registry.get(id)
      if (thread?.kind !== 'topic') return false
      registry.focus(id)
      screen.focus(id)
      if (thread.state === 'ready') {
        registry.setState(id, 'parked')
        // Its answer was written while another topic was on the stage: say it now.
        const answer = transcript.findLast((line) => line.thread === id && line.outcome === 'done')
        if (answer?.replied) {
          const cutter = createSentenceCutter()
          for (const sentence of [...cutter.push(answer.replied), ...cutter.flush()]) {
            emit({
              type: 'event',
              name: 'speech.say',
              turn: answer.turn,
              text: sentence,
              ...(languageOf(sentence, LANGUAGES, undefined) ? { language: languageOf(sentence, LANGUAGES, undefined) as string } : {})
            })
          }
        }
      }
      return true
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    close() {
      end(orchestrator)
      orchestrator = undefined
      for (const runtime of runtimes.values()) end(runtime.live)
      runtimes.clear()
    }
  }
}
