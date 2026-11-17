import { type Event, type Exchange, exchangeSchema, type Persona, type TurnId } from '@repo/protocol'
import type { EngineRoom } from '../engines/engines.ts'
import type { Session, SessionEvent } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import type { Records } from '../ports/records.ts'
import type { UserSettings } from '../settings/settings.ts'
import { languageOf } from '../speech/language.ts'
import { createSentenceCutter, type SentenceCutter, speakable } from '../speech/sentences.ts'
import type { Grant } from '../tools/tools.ts'
import { instructionsFor } from './instructions.ts'

/** The type of the record written when a turn is over: one line of the channel log, word for word. */
export const EXCHANGE = 'channel.exchange'

/** How many of the latest lines a new session is told about, so it carries on where the last one stopped. */
const RECAP_EXCHANGES = 8

/** The languages the voice is asked to tell apart. */
const LANGUAGES = ['en', 'fr'] as const

export interface ChannelOptions {
  engines: EngineRoom
  settings: UserSettings
  records: Records
  log: Log
  now: () => Date
  /** A new identifier, unique for good. */
  newId: () => string
  /** What sessions can do besides speak. Left out, they can only speak. */
  abilities?: Abilities
}

/** The tools sessions are given, and what they are told about them. */
export interface Abilities {
  /** Where the tool server listens. Nothing while it is not running, and sessions then only speak. */
  server(): string | undefined
  /** Give the session about to open the right to call the tools, under a token of its own. */
  grant(): Grant
  /** What a session is told about the tools, added to its instructions. */
  instructions: string
}

/** The single conversation: it takes what the user says, one turn at a time, and announces the answer as it comes. */
export interface Channel {
  /** The user said something. The answer follows as events. Said during an answer, it stops that answer first. */
  say(text: string, language?: string): TurnId
  /** Stop the answer under way, if there is one. */
  stop(): void
  /** The latest lines of the transcript, oldest first. */
  read(limit: number): Exchange[]
  /** The turn the assistant is answering, if any. */
  turn(): TurnId | undefined
  /** Be told each event of the conversation. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** End the session in use. The next thing said opens a new one. */
  close(): void
}

interface Turn {
  exchange: Exchange
  language: string | undefined
  cutter: SentenceCutter
  /** The user stopped it: what the session still writes is no longer said. */
  stopped: boolean
}

interface Open {
  session: Session
  /** What the session was opened for. When any of it changes, the session is replaced. */
  key: string
  /** Its right to call tools, which ends with it. */
  grant: Grant | undefined
}

/**
 * The channel keeps one warm session and gives it every turn. The store is the truth and the session is a
 * cache: when the harness or the persona changes, or after a restart, a new session is opened and told the
 * latest lines of the transcript.
 */
export function createChannel(options: ChannelOptions): Channel {
  const { engines, settings, records, log, now, newId } = options
  const listeners = new Set<(event: Event) => void>()
  const transcript: Exchange[] = []
  for (const record of records.read([EXCHANGE])) {
    const exchange = exchangeSchema.safeParse(record.payload)
    if (exchange.success) transcript.push(exchange.data)
  }

  let open: Open | undefined
  let current: Turn | undefined
  /** Said while a turn was being stopped: started as soon as that turn is over. */
  let next: Turn | undefined

  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  const activePersona = (): Persona => {
    const { available, active } = settings.read().personas
    const persona = available.find((candidate) => candidate.id === active) ?? available[0]
    if (!persona) throw new Error('There is no persona.')
    return persona
  }

  const finish = (turn: Turn, outcome: Exchange['outcome'], problem?: string) => {
    for (const sentence of turn.cutter.flush()) say(turn, sentence)
    turn.exchange = problem === undefined ? { ...turn.exchange, outcome } : { ...turn.exchange, outcome, problem }
    replace(turn.exchange)
    records.append([{ type: EXCHANGE, payload: turn.exchange }])
    if (current === turn) current = undefined
    emit({ type: 'event', name: 'turn.ended', exchange: turn.exchange })
    const waiting = next
    next = undefined
    if (waiting) void start(waiting)
  }

  const replace = (exchange: Exchange) => {
    const at = transcript.findIndex((line) => line.turn === exchange.turn)
    if (at >= 0) transcript[at] = exchange
    else transcript.push(exchange)
  }

  const say = (turn: Turn, sentence: string) => {
    if (turn.stopped) return
    const text = speakable(sentence)
    if (text === '') return
    turn.exchange = { ...turn.exchange, replied: turn.exchange.replied ? `${turn.exchange.replied} ${text}` : text }
    replace(turn.exchange)
    const language = languageOf(text, LANGUAGES, turn.language)
    emit(
      language === undefined
        ? { type: 'event', name: 'speech.say', turn: turn.exchange.turn, text }
        : { type: 'event', name: 'speech.say', turn: turn.exchange.turn, text, language }
    )
  }

  const hear = (from: Session, event: SessionEvent) => {
    if (open?.session !== from) return
    const turn = current
    switch (event.type) {
      case 'text':
        if (turn) for (const sentence of turn.cutter.push(event.text)) say(turn, sentence)
        return
      case 'tool':
        if (turn) emit({ type: 'event', name: 'activity', turn: turn.exchange.turn, tool: event.name, phase: event.phase })
        return
      case 'turn-end':
        if (turn) finish(turn, turn.stopped ? 'stopped' : 'done')
        return
      case 'failed':
        log.error(`The session failed: ${event.reason}`)
        end()
        if (turn) finish(turn, 'failed', event.reason)
        return
    }
  }

  /** End the session in use and its right to call tools. */
  const end = () => {
    open?.session.close()
    open?.grant?.revoke()
    open = undefined
  }

  /** The session for this persona on the harness in use, opened when there is none or when either changed. */
  const sessionFor = async (persona: Persona): Promise<Session | string> => {
    const harness = await engines.active()
    if (!harness) return 'No AI program is ready. Install Claude Code or Codex and sign in, then try again.'
    const server = options.abilities?.server()
    const key = JSON.stringify([harness.id, persona.id, persona.name, persona.stance, server ?? null])
    if (open?.key === key) return open.session
    end()
    const earlier = transcript.filter((line) => line.outcome !== 'running').slice(-RECAP_EXCHANGES)
    const abilities = options.abilities
    if (abilities && server !== undefined) {
      const grant = abilities.grant()
      const instructions = instructionsFor({ persona, earlier, abilities: abilities.instructions })
      const session = harness.open({ role: 'thread', instructions, tools: { url: server, token: grant.token } })
      open = { session, key, grant }
    } else {
      const session = harness.open({ role: 'thread', instructions: instructionsFor({ persona, earlier }) })
      open = { session, key, grant: undefined }
    }
    const session = open.session
    session.onEvent((event) => hear(session, event))
    return session
  }

  const start = async (turn: Turn) => {
    current = turn
    emit({ type: 'event', name: 'turn.started', exchange: turn.exchange })
    let session: Session | string
    try {
      session = await sessionFor(activePersona())
    } catch (error) {
      session = error instanceof Error ? error.message : String(error)
    }
    if (current !== turn) return // Stopped or replaced while the harness was being looked up.
    if (typeof session === 'string') return finish(turn, 'failed', session)
    if (turn.stopped) return finish(turn, 'stopped')
    session.send(turn.exchange.said)
  }

  const stop = () => {
    next = undefined
    const turn = current
    if (!turn || turn.stopped) return
    turn.stopped = true
    // The session answers an interrupt by ending the turn, which is when the turn is recorded as stopped.
    if (open) open.session.interrupt()
    else finish(turn, 'stopped')
  }

  return {
    say(text, language) {
      const persona = activePersona()
      const exchange: Exchange = { turn: newId(), at: now().toISOString(), persona: persona.id, said: text, replied: '', outcome: 'running' }
      const turn: Turn = { exchange, language, cutter: createSentenceCutter(), stopped: false }
      transcript.push(exchange)
      if (current) {
        // One turn at a time: what is said now replaces what was being answered.
        stop()
        next = turn
        if (!current) {
          next = undefined
          void start(turn)
        }
      } else {
        void start(turn)
      }
      return exchange.turn
    },
    stop,
    read: (limit) => transcript.slice(-limit),
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    turn: () => current?.exchange.turn,
    close: end
  }
}
