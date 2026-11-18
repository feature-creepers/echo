import { SHOW_TOOL } from '@repo/catalog'
import {
  type Event,
  type Exchange,
  exchangeSchema,
  LANGUAGE_CODES,
  languageName,
  type Persona,
  type ShownView,
  type Step,
  stepSchema,
  type Thread,
  type Threads,
  type TurnId
} from '@repo/protocol'
import { z } from 'zod'
import { attachmentsFor, type Handed, handedAny, NOTHING_HANDED, noteForOrchestrator, noteForThread } from '../attachments/framing.ts'
import type { EngineRoom } from '../engines/engines.ts'
import type { Harness, Reach, Scope, Session, SessionEvent } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import type { Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'
import type { UserSettings } from '../settings/settings.ts'
import { languageOf } from '../speech/language.ts'
import { createSentenceCutter, type SentenceCutter, speakable } from '../speech/sentences.ts'
import { createThreadRegistry } from '../threads/registry.ts'
import type { Grant, Tool } from '../tools/tools.ts'
import type { Checked, Screen, Showing } from '../views/screen.ts'
import { instructionsFor, orchestratorInstructions, SPEAK_FIRST, threadInstructions, WORK_FIRST } from './instructions.ts'

/** The type of the record written when a turn is over: one line of the channel log, word for word. */
export const EXCHANGE = 'channel.exchange'

/** The type of the record written each time the assistant greets the user. */
export const GREETING = 'channel.greeting'

/** The type of the record written when a tool call ends: what went in and what came out, for the side sheet. */
export const STEP = 'channel.step'

/** The name of the tool a thread writes its full answer with. */
export const ANSWER_TOOL = 'answer_write'

/** The tools a thread calls only once it has said its short answer. */
const SPOKEN_FIRST = new Set([SHOW_TOOL, ANSWER_TOOL])

/** How much of a tool's output is kept, in characters. A page read whole can be far longer, and is not needed whole twice. */
const OUTPUT_KEPT = 40_000

/** How long after a greeting the assistant does not greet again, in milliseconds. */
const GREETING_GAP_MS = 6 * 60 * 60 * 1000

/** How many of the latest lines a new session is told about, so it carries on where the last one stopped. */
const RECAP_EXCHANGES = 8

/**
 * How long an answer takes before the person is likely to have turned to something else: a notification then says
 * it is done when they are not looking ("tell me when it's done").
 */
const LONG_ANSWER_MS = 20_000

/** How much of an answer a notification carries, in characters. */
const NOTICE_LENGTH = 240

/** What sessions can do besides speak, given by the core. */
export interface Abilities {
  /** Where the tool server listens. Nothing while it is not running: there are then no threads, and one session answers. */
  server(): string | undefined
  /** Give a session the right to call these tools, under a token of its own. */
  grant(tools: readonly Tool[]): Grant
  /** The tools a thread works with, for the persona's stance: the screen, bound to where its views go, and more. */
  threadTools(showing: () => Showing, stance: Persona['stance']): Tool[]
  /** Tools the orchestrator works with itself, besides passing turns on: what needs no screen, such as setting a reminder. */
  orchestratorTools?(): Tool[]
  /** What a thread is told about its tools, added to its instructions. */
  instructions: string
  /** What every session must keep in mind, such as decisions already made and widgets saved. Read each time a session opens. */
  standing?(role: 'orchestrator' | 'thread'): string | undefined
  /**
   * What a thread is told of what it may do on the computer, as it stands now. When it changes while a session is
   * open (the person chose another approval level), the session is told the new one with its next message instead
   * of being opened again, so work under way keeps its context.
   */
  told?(): string | undefined
  /**
   * Have a folder for a project's thread to work in, asking the person on screen, where `showing` says, when it is
   * not theirs to change yet. Gives back the folder as the system names it, or why not.
   */
  workIn?(path: string, showing: Showing): Promise<{ ok: true; folder: string } | { ok: false; text: string }>
  /** What a project tells those who work in it: its own instructions, read from its folder each time a session opens. */
  guide?(folder: string): Promise<string | undefined>
  /** What a thread did on the computer so far, for a new session carrying on its work. Paths are written from `folder`. */
  worked?(thread: string, folder?: string): string | undefined
  /** The person's computer as a thread reaches it, its questions going where `showing` says. */
  reach?(showing: () => Showing): Reach | undefined
  /** Changes when what a thread is given changes, such as its access to the computer: its session is then opened again. */
  version?(): string
  /** Something the person said that answers a question on screen, taken before any turn. True when it did. */
  hear?(said: string): boolean
  /** A thread made or changed files on the computer, at these places, absolute: they are shown where `showing` says. */
  wrote?(showing: Showing, paths: readonly string[]): void
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
  /** What the assistant remembers. Left out, it knows only the latest lines of the transcript. */
  memory?: Remembering
  /**
   * Tell the person something finished while they may not be looking: a scheduled task's answer, a long answer, an
   * answer finished in the background (docs/SPEC.md, section 7.4). Left out, nothing is told.
   */
  notify?(notice: { title: string; body: string }): void
}

/** What the channel asks of the memory (docs/SPEC.md, section 10.5). */
export interface Remembering {
  /** Something was said or answered: the assistant wakes if it was asleep, and the quiet period starts again. */
  wake(): void
  /** What to add ahead of what the user said. Lines of the log written from `knownSince` on are known to the session already. */
  recall(said: string, knownSince?: string): string | undefined
  /**
   * What every session is told about the user. `version` changes only when sleep writes a new profile: sessions
   * are then opened again with it. Facts learned in between reach the next session opened for another reason.
   */
  profile(): { text: string; version?: string | undefined } | undefined
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
  /**
   * The user said something, and may have handed over files and folders with it. The answer follows as events.
   * Said during an answer, it takes the answer's place.
   */
  say(text: string, language?: string, handed?: Handed): TurnId
  /** Greet the user and brief them, unless it was done a little while ago or a turn is under way. */
  greet(): TurnId | undefined
  /**
   * Say a reminder whose time has come: a turn of its own, started by the assistant, with nothing to work out, so no
   * model is asked. Its card goes on top of the stream. Silent, it is shown and kept, and not said.
   */
  remind(reminder: { sentence: string; language: string | undefined; card: Checked; silent: boolean }): TurnId
  /** Carry out a task the person scheduled, as if they had just asked it. Silent, its answer is shown and not said. */
  task(task: { title: string; request: string; language: string | undefined; silent: boolean }): TurnId
  /** Whether the person is being answered: a turn on the stage, or one waiting to be. Work in the background does not count. */
  busy(): boolean
  /** Stop the answer under way, if there is one. */
  stop(): void
  /**
   * Stop everything: every turn, the one on the stage, those waiting and every thread's, is recorded as stopped, and
   * every session ends with what it still runs. The next thing said opens new ones.
   */
  stopAll(): void
  /** The latest lines of the transcript, oldest first. */
  read(limit: number): Exchange[]
  /** The threads, and the one in focus. */
  threads(): Threads
  /** The turn on the stage, if any. */
  turn(): TurnId | undefined
  /**
   * Bring a thread back: a topic to the stage, an aside's card beside it, with what of its last answer was not
   * heard yet. False when there is no such thread.
   */
  focus(thread: string): boolean
  /** A thread whole, for the side sheet: what it answered, the calls it made, the views it showed. */
  thread(id: string): { thread: Thread; exchanges: Exchange[]; steps: Step[]; views: ShownView[] } | undefined
  /** Be told each event of the conversation. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** End every session. The next thing said opens new ones. */
  close(): void
}

interface Turn {
  exchange: Exchange
  language: string | undefined
  /** The files and folders the person handed over with it. They follow it to the thread that answers. */
  handed: Handed
  /** Cuts the text of whoever is speaking into sentences. Each speaker gets its own, so one's words never run into another's. */
  cutter: SentenceCutter
  /** How many of its sentences were said aloud while it was on the stage. */
  heard: number
  /** Its sentences so far, as said: a model that repeats itself after its tool calls is not heard twice. */
  sentences: Set<string>
  /** A call to show or write was sent back once because nothing had been said yet. It is not sent back twice. */
  urged: boolean
  /** Its tool calls under way, by call, and how many it made. */
  steps: Map<string, Step>
  calls: number
  /** The user stopped it: nothing more of it is said or kept. */
  stopped: boolean
  /** The thread answering it, once the orchestrator has passed it on. */
  routed: Runtime | undefined
  /**
   * A second request in the same words ("stop the radio, and what is the weather?") is a turn of its own,
   * answered by its own thread. It is heard after this one: `next` on the first, `after` on the second.
   */
  next: Turn | undefined
  after: Turn | undefined
  /** What a second request's thread said while the first was still being answered, said once it is. */
  held: string[]
  /** It has spoken and then shown its view: anything it writes after that would only say the answer again. */
  shown: boolean
  /** Its answer is kept and shown, and not said: a scheduled task during the quiet hours. */
  silent: boolean
  /** What a notification calls it, for a turn the person did not start: the scheduled task's title. */
  title: string | undefined
  /** A notification already told the person it is done. */
  noticed: boolean
  /**
   * For a project's thread: a tool call has started. What it writes after that is held, since it is commentary on
   * the way unless the turn ends after it: then it is how the work went, and it is said.
   */
  working: boolean
  /** What it wrote since its last call, held. */
  narration: string[]
  /** How many sentences it had said when its work began: more must follow, saying how the work went. */
  saidBeforeWork: number
}

/** A live session, and what it was opened for. When any of that changes, the session is replaced. */
interface Live {
  session: Session
  key: string
  grant: Grant | undefined
  /** The date of the oldest line the session was told about: recall leaves out what it already has. */
  knownSince: string
  /** What it was last told of what it may do on the computer. */
  told?: string | undefined
}

/** A thread at work: its session, the turn it answers, and what waits for it. */
interface Runtime {
  thread: string
  live: Live | undefined
  answering: Turn | undefined
  queue: { turn: Turn; text: string }[]
  /** Files the person handed this thread, by where they are: it may read them, whatever else it may reach. */
  readable: string[]
  /** Where its views go, once its session is open. */
  showing: (() => Showing) | undefined
}

const openInput = z.object({
  title: z.string().trim().min(1).max(80),
  kind: z.enum(['topic', 'aside']).default('topic'),
  request: z.string().optional(),
  folder: z.string().trim().min(1).max(4096).optional()
})
const sendInput = z.object({ thread: z.string().min(1), request: z.string().optional() })
const focusInput = z.object({ thread: z.string().min(1) })
const answerInput = z.object({ text: z.string().trim().min(1) })

const newTurn = (exchange: Exchange, language: string | undefined, handed: Handed = NOTHING_HANDED, silent = false, title?: string): Turn => ({
  exchange,
  language,
  handed,
  cutter: createSentenceCutter(),
  heard: 0,
  sentences: new Set(),
  urged: false,
  steps: new Map(),
  calls: 0,
  stopped: false,
  routed: undefined,
  next: undefined,
  after: undefined,
  held: [],
  shown: false,
  silent,
  title,
  noticed: false,
  working: false,
  narration: [],
  saidBeforeWork: 0
})

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
  const { engines, settings, records, screen, log, now, newId, abilities, memory } = options
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
  /**
   * Sentences of an answer written while another turn was on the stage, by turn: what is said when its thread is
   * brought back. Only what was not heard, so nothing is ever said twice.
   */
  const unheard = new Map<TurnId, string[]>()

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
    if (text === '' || turn.sentences.has(text)) return
    turn.sentences.add(text)
    turn.exchange = { ...turn.exchange, replied: turn.exchange.replied ? `${turn.exchange.replied} ${text}` : text }
    replace(turn.exchange)
    if (current !== turn) {
      if (turn.after !== undefined && current === turn.after) turn.held.push(text)
      else unheard.set(turn.exchange.turn, [...(unheard.get(turn.exchange.turn) ?? []), text])
      return
    }
    voice(turn, text)
  }

  const voice = (turn: Turn, text: string) => {
    turn.heard += 1
    if (turn.silent) return
    const language = answerIn(text, turn.language)
    emit({ type: 'event', name: 'speech.say', turn: turn.exchange.turn, text, ...(language === undefined ? {} : { language }) })
  }

  /** A tool call started or ended: kept with its turn, recorded once it ends, and told to the clients. */
  const step = (turn: Turn, thread: string | undefined, event: Extract<SessionEvent, { type: 'tool' }>) => {
    // A harness that does not name its calls: a start is a new call, an end closes the oldest open call of that tool.
    const call =
      event.call ??
      (event.phase === 'started'
        ? `${turn.exchange.turn}:${++turn.calls}`
        : ([...turn.steps.values()].find((open) => open.tool === event.name)?.call ?? `${turn.exchange.turn}:${++turn.calls}`))
    const known = turn.steps.get(call)
    const at = now().toISOString()
    const next: Step = {
      call,
      turn: turn.exchange.turn,
      ...(thread === undefined ? {} : { thread }),
      tool: event.name,
      at: known?.at ?? at,
      ...((event.input ?? known?.input) === undefined ? {} : { input: event.input ?? known?.input })
    }
    if (event.phase === 'ended') {
      if (event.output !== undefined) next.output = event.output.length > OUTPUT_KEPT ? `${event.output.slice(0, OUTPUT_KEPT)}\n[…cut]` : event.output
      if (event.failed) next.failed = true
      if (event.use !== undefined) next.use = event.use
      next.ended = at
      turn.steps.delete(call)
      records.append([{ type: STEP, payload: next }])
    } else turn.steps.set(call, next)
    emit({ type: 'event', name: 'activity', turn: turn.exchange.turn, tool: event.name, phase: event.phase, step: next })
  }

  const finish = (turn: Turn, outcome: Exchange['outcome'], problem?: string) => {
    if (turn.exchange.outcome !== 'running') return
    // A reminder said by itself does not wake an assistant asleep at its work: nobody spoke to it.
    if (turn.exchange.trigger !== 'reminder') memory?.wake()
    for (const sentence of turn.cutter.flush()) say(turn, sentence)
    // A call cut short has no end of its own: it is recorded as it stood.
    for (const open of [...turn.steps.values()]) step(turn, open.thread, { type: 'tool', name: open.tool, phase: 'ended', call: open.call })
    turn.exchange = problem === undefined ? { ...turn.exchange, outcome } : { ...turn.exchange, outcome, problem }
    replace(turn.exchange)
    records.append([{ type: EXCHANGE, payload: turn.exchange }])
    // A scheduled task's answer, or one that took long, is told in a notification too: the person may have turned away.
    const long = now().getTime() - new Date(turn.exchange.at).getTime() > LONG_ANSWER_MS
    if (turn.exchange.outcome === 'done' && (turn.exchange.trigger === 'task' || long)) notice(turn)
    if (current === turn) {
      current = undefined
      // The second request of the same words is heard now: what its thread said meanwhile first.
      const second = turn.next
      if (second && !second.stopped) {
        if (second.exchange.outcome === 'running') current = second
        for (const text of second.held.splice(0)) voice(second, text)
      }
    }
    emit({ type: 'event', name: 'turn.ended', exchange: turn.exchange })
  }

  /** Tell the person, in a notification, that an answer is there: once per turn, and only for an answer with words. */
  const notice = (turn: Turn) => {
    const body = turn.exchange.replied.trim()
    if (turn.noticed || turn.stopped || body === '' || !options.notify) return
    turn.noticed = true
    const thread = turn.exchange.thread === undefined ? undefined : registry.get(turn.exchange.thread)
    options.notify({
      title: turn.title ?? thread?.title ?? activePersona().name,
      body: body.length > NOTICE_LENGTH ? `${body.slice(0, NOTICE_LENGTH - 1).trimEnd()}…` : body
    })
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
      runtime = { thread, live: undefined, answering: undefined, queue: [], readable: [], showing: undefined }
      runtimes.set(thread, runtime)
    }
    return runtime
  }

  const threadSession = async (runtime: Runtime, engine: Harness, server: string): Promise<Session> => {
    const thread = registry.get(runtime.thread)
    const folder = thread?.folder
    const persona = activePersona()
    const profile = memory?.profile()
    const granted = abilities?.reach?.(() => showing())
    // Files handed to the thread are readable by it, whatever else it may reach: the person gave them.
    const computer: Reach | undefined = granted && { ...granted, scope: () => withReadable(granted.scope(), runtime.readable) }
    // A change of program, model or persona opens a new session for the next question, told what was said before.
    const key = JSON.stringify([
      engine.id,
      engines.chosenModel(engine.id) ?? null,
      persona.id,
      persona.name,
      persona.stance,
      server,
      profile?.version ?? null,
      abilities?.version?.() ?? null,
      // A session that could read nothing is opened again once it is handed something to read.
      computer === undefined ? null : reads(computer.scope()),
      folder ?? null
    ])
    if (runtime.live?.key === key) return runtime.live.session
    end(runtime.live)
    runtime.live = undefined
    const kind = thread?.kind ?? 'topic'
    const told = abilities?.told?.()
    // A project's thread is given what the project tells those who work in it, and what it did there so far.
    const project = folder ? { folder, guide: await abilities?.guide?.(folder), worked: abilities?.worked?.(runtime.thread, folder) } : undefined
    const showing = (): Showing => ({
      thread: runtime.thread,
      turn: runtime.answering?.exchange.turn,
      slot: kind === 'aside' ? 'margin' : 'stage',
      focused: registry.focused()?.id === runtime.thread
    })
    runtime.showing = showing
    const grant = abilities?.grant(
      [...abilities.threadTools(showing, persona.stance), answerTool(runtime)].map((tool) =>
        SPOKEN_FIRST.has(tool.definition.name) ? speakFirst(runtime, tool) : tool
      )
    )
    const earlier = recapFor(runtime.thread)
    const instructions = threadInstructions({
      persona,
      earlier,
      profile: profile?.text,
      title: thread?.title ?? 'A topic',
      kind,
      project,
      ...(abilities ? { abilities: [abilities.instructions, abilities.standing?.('thread'), told].filter(Boolean).join('\n\n') } : {})
    })
    // A thread may search the web and read pages with the harness's own tools. A project's works in its folder.
    const session = engine.open({
      role: 'thread',
      instructions,
      web: true,
      ...(grant ? { tools: { url: server, token: grant.token } } : {}),
      ...(computer ? { computer } : {}),
      ...(folder ? { folder } : {})
    })
    const live: Live = { session, key, grant, knownSince: earlier[0]?.at ?? now().toISOString(), told }
    runtime.live = live
    session.onEvent((event) => hearThread(runtime, live, event))
    return session
  }

  const hearThread = (runtime: Runtime, live: Live, event: SessionEvent) => {
    if (runtime.live !== live) return
    const turn = runtime.answering
    const project = registry.get(runtime.thread)?.folder !== undefined
    switch (event.type) {
      case 'text':
        // The view and the full answer come after the spoken answer: what a thread writes after them would only say
        // the answer again.
        if (turn && turn.exchange.written === undefined && !turn.shown) {
          const sentences = turn.cutter.push(event.text)
          if (turn.working) turn.narration.push(...sentences)
          else for (const sentence of sentences) say(turn, sentence)
        }
        return
      case 'tool':
        if (!turn) return
        if (event.phase === 'started') {
          // What was written before a call is whole: it is said now, while the tool runs, not once more text follows.
          const written = turn.cutter.flush()
          if (!turn.working) for (const sentence of written) say(turn, sentence)
          else {
            // A project's thread, at work: what it wrote between two calls was commentary on the way, and is dropped.
            // Before its report or a view, it is how the work went, and is said.
            turn.narration.push(...written)
            const held = turn.narration.splice(0)
            if (SPOKEN_FIRST.has(event.name)) for (const sentence of held) say(turn, sentence)
          }
          // Its work begins with its first call that is not the report or a view: a quick answer has none.
          if (project && !turn.working && !SPOKEN_FIRST.has(event.name)) {
            turn.working = true
            turn.saidBeforeWork = turn.sentences.size
          }
        }
        step(turn, runtime.thread, event)
        // At work on a project, a view shown on the way does not end what is said.
        if (event.phase === 'ended' && event.name === SHOW_TOOL && !event.failed && turn.sentences.size > 0 && !project) turn.shown = true
        if (event.phase === 'ended' && !event.failed && event.wrote && event.wrote.length > 0 && runtime.showing)
          abilities?.wrote?.(runtime.showing(), event.wrote)
        return
      case 'turn-end': {
        if (!turn) return
        // An answer is waiting to be seen when some of it was said while another turn had the stage, or when it
        // finished out of sight before saying anything.
        const outOfSight = current !== turn && !(turn.after !== undefined && current === turn.after)
        // What a project's thread wrote after its last call is how the work went.
        for (const sentence of turn.narration.splice(0)) say(turn, sentence)
        finish(turn, turn.stopped ? 'stopped' : 'done')
        const missed = (unheard.get(turn.exchange.turn)?.length ?? 0) > 0 || (outOfSight && turn.heard === 0)
        runtime.answering = undefined
        registry.setState(runtime.thread, missed && !turn.stopped ? 'ready' : 'parked')
        // An answer finished out of sight waits, marked ready; a notification says so to a person not looking.
        if (missed) notice(turn)
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
    const live = runtime.live
    const session = await threadSession(runtime, engine, server)
    if (waiting.turn.stopped) {
      runtime.answering = undefined
      finish(waiting.turn, 'stopped')
      return void next(runtime)
    }
    // A session kept open is told what changed of what it may do on the computer, rather than opened again.
    const told = abilities?.told?.()
    const changed =
      runtime.live === live && live !== undefined && live.told !== told
        ? `(What you may do on the computer changed since your instructions were written. It now stands as follows, in place of what they said:)\n${told ?? 'You have no access to the computer.'}\n\n`
        : ''
    if (runtime.live) runtime.live.told = told
    const recalled = memory?.recall(waiting.text, runtime.live?.knownSince)
    const { handed } = waiting.turn
    const images = engine.capabilities?.images === true
    const note = noteForThread(handed, waiting.text, images)
    const reminder = registry.get(runtime.thread)?.folder === undefined ? SPEAK_FIRST : WORK_FIRST
    session.send(
      `${context()}\n${changed}${recalled ? `${recalled}\n\n` : ''}${waiting.text}\n\n${note ? `${note}\n\n` : ''}${reminder}`,
      attachmentsFor(handed, images)
    )
  }

  /** Pass a turn to a thread, which answers it as soon as it is free. */
  const route = (turn: Turn, thread: Thread, request: string) => {
    const runtime = runtimeFor(thread.id)
    // What the orchestrator wrote before passing the turn on is said now, whole, and the thread is told of it, so
    // that the person never hears the same thing twice. The thread's words are cut into sentences of their own.
    for (const sentence of turn.cutter.flush()) say(turn, sentence)
    turn.cutter = createSentenceCutter()
    const said = turn.exchange.replied.trim()
    const text = said === '' ? request : `${request}\n\n(You have already said this aloud: "${said}". Do not say it again; carry on from there.)`
    turn.routed = runtime
    turn.exchange = { ...turn.exchange, thread: thread.id }
    replace(turn.exchange)
    for (const file of turn.handed.files) if (!runtime.readable.includes(file.location)) runtime.readable.push(file.location)
    if (thread.kind === 'topic') {
      registry.focus(thread.id)
      screen.focus(thread.id)
    }
    runtime.queue.push({ turn, text })
    void next(runtime)
  }

  /**
   * Pass a request on. The first one passed takes the turn; a second, when the person asked two things at once,
   * becomes a turn of its own, heard once the first is answered. A third is refused: two is already a lot to hear.
   */
  const passOn = (turn: Turn, thread: Thread, request: string): ToolResult => {
    if (!turn.routed) {
      route(turn, thread, request)
      return { ok: true, text: `Thread ${thread.id} is answering. Write nothing more.` }
    }
    if (turn.next || turn.routed.thread === thread.id) return { ok: false, text: 'This has already been passed on. Write nothing more.' }
    const exchange: Exchange = { turn: newId(), at: now().toISOString(), persona: turn.exchange.persona, said: request, replied: '', outcome: 'running' }
    const second = newTurn(exchange, turn.language, turn.handed)
    second.after = turn
    turn.next = second
    transcript.push(exchange)
    emit({ type: 'event', name: 'turn.started', exchange })
    route(second, thread, request)
    return { ok: true, text: `Thread ${thread.id} is answering that part. Write nothing more.` }
  }

  /**
   * The full answer, for reading. What a thread writes as text is spoken, so it is short; what it found, whole,
   * goes through this tool once the spoken answer has started, and waits in the side sheet.
   */
  const answerTool = (runtime: Runtime): Tool => ({
    definition: {
      name: ANSWER_TOOL,
      description:
        'Keep the full answer, written for reading, beside the short one you say aloud: complete, in Markdown, with the figures, sources and details. The person reads it only if they want to. Call it after you have started speaking, and not for small talk or a one-line answer.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The full answer, in Markdown.' } },
        required: ['text']
      }
    },
    run(input) {
      const turn = runtime.answering
      const asked = answerInput.safeParse(input)
      if (!turn) return { ok: false, text: 'There is no answer under way.' }
      if (!asked.success) return { ok: false, text: `${ANSWER_TOOL} takes the full answer as text.` }
      turn.exchange = { ...turn.exchange, written: asked.data.text }
      replace(turn.exchange)
      emit({ type: 'event', name: 'answer.written', exchange: turn.exchange })
      return { ok: true, text: 'Kept for the person to read. Do not mention it.' }
    }
  })

  /**
   * The voice comes first: a call to show or to write the full answer before anything was said is sent back once,
   * asking for the short answer first. The model then speaks at once, and keeps that order for the rest of its
   * thread. A project's thread that worked and goes straight to its report has not said how the work went: that
   * is asked for once too. A second call is always taken, so nothing is ever lost.
   */
  const speakFirst = (runtime: Runtime, tool: Tool): Tool => ({
    definition: tool.definition,
    run(input) {
      const turn = runtime.answering
      if (turn && !turn.urged && turn.sentences.size === 0 && turn.exchange.replied === '') {
        turn.urged = true
        return {
          ok: false,
          text: `Nothing has been said yet. Write the short spoken answer first, as text, then call ${tool.definition.name} again with the same input.`
        }
      }
      if (turn && !turn.urged && tool.definition.name === ANSWER_TOOL && turn.working && turn.sentences.size === turn.saidBeforeWork) {
        turn.urged = true
        return {
          ok: false,
          text: `You have not said how the work went. Say it in a sentence or two, as plain text, then call ${ANSWER_TOOL} again with the same input.`
        }
      }
      return tool.run(input)
    }
  })

  // ---------------------------------------------------------------- the orchestrator

  const orchestratorTools = (): Tool[] => [
    {
      definition: {
        name: 'thread_open',
        description:
          'Open a new thread and pass it what the person said. kind "topic" for something to work on, "aside" for a quick side question. For work on a project, a code repository or a folder of files the person works on with you, give `folder`: the thread works there.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'The topic in a few words.' },
            kind: { type: 'string', enum: ['topic', 'aside'] },
            request: { type: 'string', description: 'What to pass on. Left out, what the person said.' },
            folder: {
              type: 'string',
              description: 'For a project: its folder, absolute or from ~. The person is asked on screen first when it is not one they let you change.'
            }
          },
          required: ['title']
        }
      },
      async run(input) {
        const turn = deciding
        const asked = openInput.safeParse(input)
        if (!turn) return { ok: false, text: 'There is nothing to pass on.' }
        if (!asked.success) return { ok: false, text: 'thread_open takes a title, a kind ("topic" or "aside"), a request, and for a project its folder.' }
        if (turn.next) return { ok: false, text: 'This has already been passed on. Write nothing more.' }
        let folder: string | undefined
        if (asked.data.folder !== undefined) {
          if (!abilities?.workIn) return { ok: false, text: 'Projects cannot be worked on here: there is no computer to work on.' }
          const found = await abilities.workIn(asked.data.folder, { thread: undefined, turn: turn.exchange.turn, slot: 'stage', focused: true })
          if (!found.ok) return { ok: false, text: `${found.text} Tell the person in a sentence.` }
          if (deciding !== turn || turn.stopped) return { ok: false, text: 'The person moved on. Write nothing more.' }
          folder = found.folder
        }
        // An aside sits beside the topic on the stage. With no topic on the stage, there is nothing to sit beside:
        // the question is a topic of its own. A project is always a topic.
        const beside = registry.focused()
        const aside = folder === undefined && asked.data.kind === 'aside' && beside !== undefined && screen.current() !== undefined
        const thread = registry.open({ title: asked.data.title, kind: aside ? 'aside' : 'topic', parent: aside ? beside.id : undefined, folder })
        return passOn(turn, thread, asked.data.request ?? turn.exchange.said)
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
        return passOn(turn, thread, asked.data.request ?? turn.exchange.said)
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
    const profile = memory?.profile()
    const key = JSON.stringify([engine.id, persona.id, persona.name, persona.stance, server ?? null, profile?.version ?? null])
    if (orchestrator?.key === key) return orchestrator.session
    end(orchestrator)
    const routing = abilities !== undefined && server !== undefined
    const standing = abilities?.standing?.('orchestrator')
    const grant = routing ? abilities.grant([...orchestratorTools(), ...(abilities.orchestratorTools?.() ?? [])]) : undefined
    const session = grant
      ? engine.open({
          role: 'orchestrator',
          instructions: orchestratorInstructions({
            persona,
            earlier: recapFor(undefined),
            profile: profile?.text,
            ...(standing ? { abilities: standing } : {})
          }),
          tools: { url: server as string, token: grant.token }
        })
      : engine.open({ role: 'thread', instructions: instructionsFor({ persona, earlier: recapFor(undefined), profile: profile?.text }) })
    const live: Live = { session, key, grant, knownSince: recapFor(undefined)[0]?.at ?? now().toISOString() }
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
        if (turn) step(turn, undefined, event)
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
  /** The language the person last spoke in: what a sentence that does not say is taken to be in. */
  let conversationLanguage: string | undefined

  /** The language of what the person said: the one they set, else the one their words or speech say, else the conversation's. */
  const spokenIn = (text: string, heard: string | undefined): string | undefined => {
    const { spoken } = settings.read().languages
    if (spoken !== 'auto') return spoken
    return heard ?? languageOf(text, LANGUAGE_CODES, conversationLanguage)
  }

  /** The language the assistant answers in, when the user set it: the one set, or the one they set as theirs. */
  const answerLanguage = (): string | undefined => {
    const { spoken, answers } = settings.read().languages
    return answers !== 'spoken' ? answers : spoken !== 'auto' ? spoken : undefined
  }

  /** The language a sentence of an answer is said in: the one set, else the one it is written in, else the turn's. */
  const answerIn = (sentence: string, turnLanguage: string | undefined): string | undefined =>
    answerLanguage() ?? languageOf(sentence, LANGUAGE_CODES, turnLanguage ?? conversationLanguage)

  /** What a session reads first with each message: the moment, and the language to answer in when the user set it. */
  const context = () => {
    const language = answerLanguage()
    return `(Now: ${moment(now(), options.timeZone)}${language === undefined ? '' : `. Answer in ${languageName(language)}.`})`
  }

  /** What the person said, or what the assistant starts on by itself, and what they handed over with it. */
  const what = (turn: Turn) => {
    if (turn.exchange.trigger === 'task')
      return `A task the person scheduled is due now ("${turn.title ?? turn.exchange.said}"). Nobody has said anything: carry it out as if they had just asked it, and answer them as usual. They may be away from the screen: if something needs their approval, ask as usual; unanswered, it counts as no.\nThe request: ${turn.exchange.said}`
    if (turn.exchange.trigger === 'greeting')
      return 'The person has just opened the app; nobody has said anything yet. Greet them by their name if you know it, in one short sentence, then give a brief briefing for today: the day, the weather where they are if you can find it (their time zone says roughly where), and anything left pending from earlier topics. Keep it short. Either say it all yourself, or pass it whole to a thread if a view of the day would help, saying nothing yourself.'
    const note = noteForOrchestrator(turn.handed)
    const said = turn.exchange.said === '' ? 'The person says nothing.' : `The person says: ${turn.exchange.said}`
    return note ? `${said}\n${note}` : said
  }

  /**
   * What the orchestrator reads for each turn: the moment, the threads, then what the person said. With no tools,
   * it is the one session that answers, and is given the files itself.
   */
  const message = (turn: Turn, images: boolean) => {
    if (abilities?.server() !== undefined) return `${context()}\nThreads:\n${registry.index()}\n\n${what(turn)}`
    if (turn.exchange.trigger !== undefined) return `${context()}\n${what(turn)}`
    const note = noteForThread(turn.handed, turn.exchange.said, images)
    return `${context()}\n${[turn.exchange.said, note].filter(Boolean).join('\n\n')}`
  }

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
    const session = orchestratorSession(engine)
    // A briefing has nothing to recall by; a scheduled task is recalled by its request, as if the person had said it.
    const asked = turn.exchange.trigger === undefined || turn.exchange.trigger === 'task'
    const recalled = asked ? memory?.recall(turn.exchange.said, orchestrator?.knownSince) : undefined
    const images = engine.capabilities?.images === true
    const text = recalled ? `${recalled}\n\n${message(turn, images)}` : message(turn, images)
    // Only the one session that answers everything is given the files; an orchestrator is told of them, and routes.
    if (abilities?.server() === undefined && handedAny(turn.handed)) session.send(text, attachmentsFor(turn.handed, images))
    else session.send(text)
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
    if (turn.next) halt(turn.next)
  }

  return {
    say(text, language, handed = NOTHING_HANDED) {
      // A yes or a no to a question on screen answers it: the turn that asked goes on, and no new one starts.
      // Files handed over are something new to look at, never an answer.
      if (!handedAny(handed) && abilities?.hear?.(text)) return current?.exchange.turn ?? newId()
      memory?.wake()
      const persona = activePersona()
      const attached = attachedOf(handed)
      const exchange: Exchange = {
        turn: newId(),
        at: now().toISOString(),
        persona: persona.id,
        said: text,
        ...(attached.length > 0 ? { attached } : {}),
        replied: '',
        outcome: 'running'
      }
      const spoken = text === '' ? undefined : spokenIn(text, language)
      if (spoken) conversationLanguage = spoken
      const turn = newTurn(exchange, spoken, handed)
      transcript.push(exchange)

      const previous = current
      current = turn
      if (previous) {
        // What is said now takes the stage. A thread that was answering finishes in the background, and its
        // answer waits, marked ready; an answer the orchestrator was still giving is stopped.
        if (!previous.routed) halt(previous)
        const second = previous.next
        if (second && second.held.length > 0) {
          unheard.set(second.exchange.turn, [...(unheard.get(second.exchange.turn) ?? []), ...second.held.splice(0)])
          if (second.exchange.outcome !== 'running' && second.routed) registry.setState(second.routed.thread, 'ready')
        }
      }
      if (pending) finish(pending, 'stopped')
      pending = undefined
      if (deciding) pending = turn
      else void decide(turn)
      return exchange.turn
    },

    greet() {
      if (current || deciding || pending) return undefined
      const last = records.read([GREETING]).at(-1)
      if (last && now().getTime() - new Date(last.at).getTime() < GREETING_GAP_MS) return undefined
      records.append([{ type: GREETING, payload: {} }])
      const persona = activePersona()
      const exchange: Exchange = { turn: newId(), at: now().toISOString(), persona: persona.id, said: '', trigger: 'greeting', replied: '', outcome: 'running' }
      const turn = newTurn(exchange, undefined)
      transcript.push(exchange)
      current = turn
      void decide(turn)
      return exchange.turn
    },

    remind({ sentence, language, card, silent }) {
      const persona = activePersona()
      const at = now().toISOString()
      const exchange: Exchange = { turn: newId(), at, persona: persona.id, said: '', trigger: 'reminder', replied: '', outcome: 'running' }
      const turn = newTurn(exchange, language, NOTHING_HANDED, silent)
      transcript.push(exchange)
      emit({ type: 'event', name: 'turn.started', exchange })
      // Said whole, as one turn the assistant started; the card shows what it is about while it is heard.
      const cutter = createSentenceCutter()
      for (const text of [...cutter.push(sentence), ...cutter.flush()]) {
        const spoken = speakable(text)
        if (spoken === '') continue
        turn.exchange = { ...turn.exchange, replied: turn.exchange.replied ? `${turn.exchange.replied} ${spoken}` : spoken }
        voice(turn, spoken)
      }
      screen.present(card, { thread: undefined, turn: exchange.turn, slot: 'stage', focused: true })
      finish(turn, 'done')
      return exchange.turn
    },

    task({ title, request, language, silent }) {
      const persona = activePersona()
      const exchange: Exchange = {
        turn: newId(),
        at: now().toISOString(),
        persona: persona.id,
        said: request,
        trigger: 'task',
        replied: '',
        outcome: 'running'
      }
      const turn = newTurn(exchange, language, NOTHING_HANDED, silent, title)
      transcript.push(exchange)
      current = turn
      if (deciding) pending = turn
      else void decide(turn)
      return exchange.turn
    },

    busy: () => (current !== undefined && current.exchange.outcome === 'running') || deciding !== undefined || pending !== undefined,

    stop() {
      if (current) halt(current)
    },

    stopAll() {
      const running = new Set<Turn>()
      for (const turn of [pending, current, deciding]) if (turn) running.add(turn)
      for (const runtime of runtimes.values()) {
        if (runtime.answering) running.add(runtime.answering)
        for (const waiting of runtime.queue.splice(0)) running.add(waiting.turn)
      }
      pending = undefined
      for (const turn of running) {
        turn.stopped = true
        finish(turn, 'stopped')
      }
      // Every session ends, and with it whatever it still runs, a command left in the background included. The
      // next request opens new ones, told what was said.
      end(orchestrator)
      orchestrator = undefined
      deciding = undefined
      for (const runtime of runtimes.values()) {
        end(runtime.live)
        runtime.live = undefined
        if (runtime.answering) registry.setState(runtime.thread, 'parked')
        runtime.answering = undefined
      }
    },

    read: (limit) => transcript.slice(-limit),

    threads: () => registry.read(),

    turn: () => current?.exchange.turn,

    focus(id) {
      const thread = registry.get(id)
      if (!thread) return false
      if (thread.kind === 'topic') {
        registry.focus(id)
        screen.focus(id)
      } else screen.recall(id)
      if (thread.state === 'ready') {
        registry.setState(id, 'parked')
        // Its answer was written while another turn was on the stage: what was not heard of it is said now.
        const answer = transcript.findLast((line) => line.thread === id && line.outcome === 'done')
        if (answer) {
          const missed = unheard.get(answer.turn)
          unheard.delete(answer.turn)
          // After a restart nothing is known of what was heard: the answer is said whole.
          const cutter = createSentenceCutter()
          const sentences = missed ?? [...cutter.push(answer.replied), ...cutter.flush()]
          for (const sentence of sentences) {
            const language = answerIn(sentence, undefined)
            emit({ type: 'event', name: 'speech.say', turn: answer.turn, text: sentence, ...(language === undefined ? {} : { language }) })
          }
        }
      }
      return true
    },

    thread(id) {
      const thread = registry.get(id)
      if (!thread) return undefined
      const exchanges = transcript.filter((line) => line.thread === id)
      const turns = new Set(exchanges.map((line) => line.turn))
      const steps: Step[] = []
      for (const record of records.read([STEP])) {
        const read = stepSchema.safeParse(record.payload)
        if (read.success && (read.data.thread === id || turns.has(read.data.turn))) steps.push(read.data)
      }
      // Calls still running belong too.
      for (const turn of [current, deciding, ...[...runtimes.values()].map((runtime) => runtime.answering)]) {
        if (turn && turns.has(turn.exchange.turn)) for (const open of turn.steps.values()) if (!steps.some((one) => one.call === open.call)) steps.push(open)
      }
      return { thread, exchanges, steps, views: screen.history(id) }
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

/** A scope with files added that may be read: those the person handed a thread. */
function withReadable(scope: Scope, readable: readonly string[]): Scope {
  const added = readable.filter((path) => !scope.places.some((place) => place.path === path))
  return added.length === 0 ? scope : { ...scope, places: [...scope.places, ...added.map((path) => ({ path, kind: 'file' as const, write: false }))] }
}

/** Whether a scope lets a session read anything at all. */
const reads = (scope: Scope) => scope.computer !== 'off' || scope.places.length > 0

/** What the person handed over, as the transcript keeps it: names and sizes, and a file's place in the assistant's folder. */
function attachedOf(handed: Handed): NonNullable<Exchange['attached']> {
  return [
    ...handed.files.map((file) => ({ name: file.name, kind: file.image ? ('image' as const) : ('file' as const), size: file.size, path: file.path })),
    ...handed.folders.map((folder) => ({ name: folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder, kind: 'folder' as const }))
  ]
}
