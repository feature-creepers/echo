import { SHOW_TOOL } from '@repo/catalog'
import {
  type Event,
  type Exchange,
  exchangeSchema,
  inConversation,
  LANGUAGE_CODES,
  languageName,
  type Persona,
  PLAN_STEP_MAX_LENGTH,
  PLAN_STEPS_MAX,
  type PlanStep,
  type Step,
  stepSchema,
  type Thread,
  type Threads,
  type TurnId
} from '@repo/protocol'
import { attachmentsFor, type Handed, handedAny, NOTHING_HANDED, noteForOrchestrator, noteForThread } from '../attachments/framing.ts'
import type { EngineRoom } from '../engines/engines.ts'
import type { Timers } from '../ports/clock.ts'
import type { Harness, Reach, Scope, Session, SessionEvent } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import type { Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'
import { folderName, partsFrom } from '../projects/folders.ts'
import type { UserSettings } from '../settings/settings.ts'
import { languageOf } from '../speech/language.ts'
import { createSentenceCutter, speakable } from '../speech/sentences.ts'
import { cutText, shorten } from '../text.ts'
import { fitThread, stepWhole, type ThreadPage } from '../threads/fit.ts'
import { createThreadRegistry } from '../threads/registry.ts'
import { ASIDE_STAYS_MS, type Checked, type Screen, type Showing } from '../views/screen.ts'
import type { Abilities, Remembering } from './abilities.ts'
import { DELEGATED_FIRST, instructionsFor, orchestratorInstructions, SIDE_QUESTION, SPEAK_FIRST, threadInstructions, WORK_FIRST } from './instructions.ts'
import { readySentence } from './ready.ts'
import { lastRequest, RESUMED, RESUMES_WITHOUT_THE_PERSON, type Resumption, readResumptions, resumesInARow, WORK, wakeRequest } from './resume.ts'
import { routingTools } from './routing.ts'
import { createSubthreads } from './subthreads.ts'
import { isThanks } from './thanks.ts'
import { createThreadTools, SPOKEN_FIRST } from './tools.ts'
import { type Live, newRuntime, newTurn, type Runtime, type Turn } from './turn.ts'

/** The records of work to take up after a restart, which the retention period erases with the channel's own. */
export { RESUME, RESUMED, WORK } from './resume.ts'

/** The type of the record written when a turn is over: one line of the channel log, word for word. */
export const EXCHANGE = 'channel.exchange'

/** The type of the record written each time the assistant greets the user. */
const GREETING = 'channel.greeting'

/** The type of the record written when a tool call ends: what went in and what came out, for the side sheet. */
export const STEP = 'channel.step'

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

/** How much of what a working thread answers the orchestrator is told, in characters. */
const DOING_LENGTH = 120

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
  /** The person's time zone, as an IANA name. Left out, the machine's. */
  timeZone?: () => string
  /** What the assistant remembers. Left out, it knows only the latest lines of the transcript. */
  memory?: Remembering
  /**
   * Tell the person something finished while they may not be looking: a scheduled task's answer, a long answer, an
   * answer finished in the background (docs/SPEC.md, section 7.4). Left out, nothing is told.
   */
  notify?(notice: { title: string; body: string }): void
  /**
   * Whether the assistant may speak up by itself now: not in the quiet hours, nor past the cap the person set on how
   * often (section 7.10). Asked only when it would, so a yes counts as one. When it may not, an answer finished out
   * of sight is left to its chip and its notification. Left out, it always may.
   */
  mayInterrupt?(): boolean
  /** Time passing, for a thread waiting for its sub-threads to be told which are still at work. Left out, it waits until they are done. */
  timers?: Timers | undefined
}

/** A moment as a person says it, with its time zone: "Tuesday, 17 November 2026, 14:13 (Europe/Paris)". */
function moment(at: Date, timeZone?: string): string {
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

/** Where a plan stands, in a few words: "step 3 of 7: Run the checks", or that every step is done. */
export function planProgress(plan: readonly PlanStep[]): string | undefined {
  if (plan.length === 0) return undefined
  const at = plan.findIndex((one) => one.state === 'current')
  const step = at >= 0 ? at : plan.findIndex((one) => one.state === 'todo')
  if (step < 0) return `all ${plan.length} steps done`
  return `step ${step + 1} of ${plan.length}: ${shorten(plan[step]?.text ?? '', DOING_LENGTH)}`
}

/** A line of the transcript without a plan: the session dropped its to-do list. */
const withoutPlan = ({ plan: _plan, ...exchange }: Exchange): Exchange => exchange

/** The single conversation: it takes what the user says, one turn at a time, and announces the answer as it comes. */
export interface Channel {
  /**
   * The user said something, and may have handed over files and folders with it. The answer follows as events.
   * Said during an answer, it takes the answer's place.
   */
  say(text: string, language?: string, handed?: Handed, spoken?: boolean): TurnId
  /**
   * The person asked for work on a project from the interface (docs/SPEC.md, section 7.11), in a folder already
   * theirs to change: a turn of their own that takes the stage, passed straight to the project's thread, since they
   * said where it goes. The thread already working in that folder carries on when it is free; at work, or with none,
   * a new one opens there, named after the folder.
   */
  work(asked: { folder: string; request: string }, language?: string): { thread: string; turn: TurnId }
  /** Greet the user and brief them, unless it was done a little while ago or a turn is under way. */
  greet(): TurnId | undefined
  /**
   * Say a reminder whose time has come: a turn of its own, started by the assistant, with nothing to work out, so no
   * model is asked. Its card goes on top of the stream. Silent, it is shown and kept, and not said.
   */
  remind(reminder: { sentence: string; language: string | undefined; card: Checked; silent: boolean }): TurnId
  /** Carry out a task the person scheduled, as if they had just asked it. Silent, its answer is shown and not said. */
  task(task: { title: string; request: string; language: string | undefined; silent: boolean }): TurnId
  /**
   * Take up what the last run of the app left: each request a thread was answering when it stopped, and what a
   * thread asked to be woken with, each run by its thread out of sight, as if just asked. Once only.
   */
  resume(): TurnId[]
  /**
   * Whether the person is being answered: a turn on the stage, or one waiting to be. Work in the background does not
   * count, nor a project's thread at work on the stage, which says nothing until it is done.
   */
  busy(): boolean
  /**
   * Stop the answer on the stage, if there is one, and put the side questions' cards away. A project's thread at work
   * is left to work: stopping a long piece of work is done on purpose, with `stopThread` or `stopAll`, never by
   * quieting the voice.
   */
  stop(): void
  /** Stop one thread: the request it is answering and those waiting for it. False when it has nothing to stop. */
  stopThread(thread: string): boolean
  /**
   * Stop everything: every turn, the one on the stage, those waiting and every thread's, is recorded as stopped, and
   * every session ends with what it still runs. The next thing said opens new ones.
   */
  stopAll(): void
  /** The latest lines of the transcript, oldest first. */
  read(limit: number): Exchange[]
  /** Lines the retention period erased from the log: they leave the transcript too, and no session is told them again. */
  forgetLines(turns: ReadonlySet<string>): void
  /** The threads, and the one in focus. */
  threads(): Threads
  /** The turn on the stage, if any. */
  turn(): TurnId | undefined
  /**
   * Bring a thread back: a topic to the stage, an aside's card beside it, with what of its last answer was not
   * heard yet. False when there is no such thread.
   */
  focus(thread: string): boolean
  /**
   * A page of one thread, for the side sheet: its latest requests, or those before `before`, as many as fit one
   * message, with their steps previewed and their views named. Undefined when there is no such thread.
   */
  thread(id: string, before?: TurnId): ({ thread: Thread } & ThreadPage) | undefined
  /** One step of a thread, whole, as the side sheet opens it. Undefined when the thread made no such call. */
  step(thread: string, call: string): Step | undefined
  /** Be told each event of the conversation. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** End every session. The next thing said opens new ones. */
  close(): void
}

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
  /** The thread whose work a thread does: a sub-thread's is the thread that opened it. */
  const ownerOf = (id: string): string => {
    const thread = registry.get(id)
    return thread?.kind === 'subthread' ? (thread.parent ?? id) : id
  }

  /** What the last run of the app left to do: taken up once, by `resume`, when a client is there. */
  const resumptions: Resumption[] = readResumptions(records, transcript, now(), (thread) => registry.get(thread) !== undefined)
  /**
   * Sentences of an answer written while another turn was on the stage, by turn: what is said when its thread is
   * brought back. Only what was not heard, so nothing is ever said twice.
   */
  const unheard = new Map<TurnId, string[]>()
  /**
   * Threads whose answer finished out of sight, still to be mentioned or said at the next pause (docs/SPEC.md,
   * section 7.4). One the person brings back first, from its chip or by asking, is not told again.
   */
  const toTell = new Set<string>()

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
    // A sub-thread's words are for the thread that opened it: kept with its line, never heard.
    if (turn.delegated !== undefined) return
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
    const input = event.input ?? known?.input
    const next: Step = {
      call,
      turn: turn.exchange.turn,
      ...(thread === undefined ? {} : { thread }),
      tool: event.name,
      at: known?.at ?? at,
      ...(input === undefined ? {} : { input })
    }
    if (event.phase === 'ended') {
      for (const file of event.wrote ?? []) turn.touched.add(file)
      if (event.output !== undefined) next.output = cutText(event.output, OUTPUT_KEPT)
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
    // What the assistant says by itself with nothing to work out, or works out for itself in a sub-thread, does not wake
    // it asleep at its work: nobody spoke to it.
    if (turn.exchange.trigger !== 'reminder' && turn.exchange.trigger !== 'ready' && turn.delegated === undefined) memory?.wake()
    for (const sentence of turn.cutter.flush()) say(turn, sentence)
    // A call cut short has no end of its own: it is recorded as it stood.
    for (const open of [...turn.steps.values()]) step(turn, open.thread, { type: 'tool', name: open.tool, phase: 'ended', call: open.call })
    turn.exchange = problem === undefined ? { ...turn.exchange, outcome } : { ...turn.exchange, outcome, problem }
    replace(turn.exchange)
    records.append([{ type: EXCHANGE, payload: turn.exchange }])
    // A scheduled task's answer, or one that took long, is told in a notification too: the person may have turned away.
    // A sub-thread's result goes to the thread that opened it, which tells the person.
    const long = now().getTime() - new Date(turn.exchange.at).getTime() > LONG_ANSWER_MS
    if (turn.delegated !== undefined && turn.exchange.thread !== undefined) subthreads.finished(turn.exchange.thread)
    else if (turn.exchange.outcome === 'done' && (turn.exchange.trigger === 'task' || long)) notice(turn)
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
    // A turn ending may be the pause an answer finished out of sight waits for.
    atPause()
  }

  /** Whether the person is being answered. A project's thread at work on the stage says nothing until it is done. */
  const busy = () => (current !== undefined && current.exchange.outcome === 'running' && !current.working) || deciding !== undefined || pending !== undefined

  /**
   * Look for the pause once what is under way has settled: a turn that ends as the next one starts, in the same
   * moment, leaves none.
   */
  const atPause = () => {
    if (toTell.size > 0) void Promise.resolve().then(tellReady)
  }

  /**
   * At a pause, tell what finished out of sight, as the person set it (docs/SPEC.md, section 7.4): a sentence saying
   * it is ready, the answer itself with its view, or nothing beyond its chip. During the quiet hours, and past the cap
   * on interruptions, the chip and the notification say it, and nothing is said.
   */
  const tellReady = () => {
    if (toTell.size === 0 || busy()) return
    const ready = [...toTell].flatMap((id) => {
      const thread = registry.get(id)
      return thread?.state === 'ready' ? [thread] : []
    })
    toTell.clear()
    const { results } = settings.read().interruptions
    if (ready.length === 0 || results === 'chip' || options.mayInterrupt?.() === false) return
    if (results === 'mention') {
      const language = answerLanguage() ?? conversationLanguage
      const titles = ready.map((thread) => thread.title)
      byItself('ready', [readySentence(titles, language)], language)
      return
    }
    for (const thread of ready) {
      const missed = bringBack(thread)
      if (missed && missed.sentences.length > 0) byItself('ready', missed.sentences, undefined)
    }
  }

  /**
   * A turn the assistant starts by itself with nothing to work out, so no model is asked: its sentences are said
   * whole, through the same voice and caption as any answer, and it ends at once. `showing` shows what goes with
   * it, such as a reminder's card, while it is heard. Silent, it is kept and not said.
   */
  const byItself = (
    trigger: 'reminder' | 'ready',
    sentences: readonly string[],
    language: string | undefined,
    silent = false,
    showing?: (turn: TurnId) => void
  ): TurnId => {
    const exchange: Exchange = { turn: newId(), at: now().toISOString(), persona: activePersona().id, said: '', trigger, replied: '', outcome: 'running' }
    const turn = newTurn(exchange, language, NOTHING_HANDED, silent)
    transcript.push(exchange)
    emit({ type: 'event', name: 'turn.started', exchange })
    for (const sentence of sentences) {
      const spoken = speakable(sentence)
      if (spoken === '') continue
      turn.exchange = { ...turn.exchange, replied: turn.exchange.replied ? `${turn.exchange.replied} ${spoken}` : spoken }
      voice(turn, spoken)
    }
    showing?.(exchange.turn)
    finish(turn, 'done')
    return exchange.turn
  }

  /**
   * Bring a topic back: it takes the focus and its view the stage. A side question that showed only aside cards comes
   * back in passing: its card on top of the stream, and the topic on the stage stays. One answered in words alone has
   * nothing to show in passing: asked for again, it is the topic it is. When its answer was waiting, marked ready,
   * gives back what of it was not heard yet, to be said now, and its turn.
   */
  const bringBack = (thread: Thread): { turn: TurnId; sentences: string[] } | undefined => {
    if (thread.kind === 'topic') {
      const shown = thread.beside === undefined ? [] : screen.history(thread.id)
      if (shown.length > 0 && shown.every((view) => view.aside === true)) screen.recall(thread.id)
      else {
        registry.focus(thread.id)
        screen.focus(thread.id)
      }
    }
    toTell.delete(thread.id)
    if (thread.state !== 'ready') return undefined
    registry.setState(thread.id, 'parked')
    const answer = transcript.findLast((line) => line.thread === thread.id && line.outcome === 'done')
    if (!answer) return undefined
    const missed = unheard.get(answer.turn)
    unheard.delete(answer.turn)
    // After a restart nothing is known of what was heard: the answer is said whole.
    const cutter = createSentenceCutter()
    return { turn: answer.turn, sentences: missed ?? [...cutter.push(answer.replied), ...cutter.flush()] }
  }

  /**
   * The side questions' cards leave the stream (docs/SPEC.md, section 7.5): the person said thanks, or pressed Escape.
   * Each is only put away: it comes back when its topic is brought back.
   */
  const putAsidesAway = () => {
    for (const card of screen.asides()) screen.clear(card.id)
  }

  /** Tell the person, in a notification, that an answer is there: once per turn, and only for an answer with words. */
  const notice = (turn: Turn) => {
    const body = shorten(turn.exchange.replied, NOTICE_LENGTH)
    if (turn.noticed || turn.stopped || body === '' || !options.notify) return
    turn.noticed = true
    const thread = turn.exchange.thread === undefined ? undefined : registry.get(turn.exchange.thread)
    options.notify({ title: turn.title ?? thread?.title ?? activePersona().name, body })
  }

  /** The latest lines a new session is told: a thread's own, or the conversation's, which leaves out sub-threads' work. */
  const recapFor = (thread: string | undefined) =>
    transcript.filter((line) => line.outcome !== 'running' && (thread === undefined ? inConversation(line) : line.thread === thread)).slice(-RECAP_EXCHANGES)

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
      runtime = newRuntime(thread)
      runtimes.set(thread, runtime)
    }
    return runtime
  }

  /** What a thread is answering now, in the words it was given, and where its plan stands, for the others. */
  const doing = (thread: string): string | undefined => {
    const exchange = runtimes.get(thread)?.answering?.exchange
    if (exchange === undefined) return undefined
    const asked = shorten(exchange.said, DOING_LENGTH)
    if (asked === '') return undefined
    const where = exchange.plan ? planProgress(exchange.plan) : undefined
    return where === undefined ? asked : `${asked} (${where})`
  }

  /** What a thread is about, from the summary sleep wrote, for the index the orchestrator reads. */
  const summaryOf = (thread: string) => memory?.summary?.(thread)

  /**
   * Hand a sub-thread part of a thread's work: a line of its own, which no one hears, answered as soon as it is free.
   * Files the person handed the thread may be read by its sub-threads too.
   */
  const handTo = (runtime: Runtime, thread: Thread, request: string) => {
    const exchange: Exchange = {
      turn: newId(),
      at: now().toISOString(),
      persona: activePersona().id,
      thread: thread.id,
      said: request,
      trigger: 'delegated',
      replied: '',
      outcome: 'running'
    }
    const turn = newTurn(exchange, runtime.answering?.language, NOTHING_HANDED, true, thread.title)
    turn.delegated = runtime.thread
    const sub = runtimeFor(thread.id)
    turn.routed = sub
    for (const file of runtime.readable) if (!sub.readable.includes(file)) sub.readable.push(file)
    transcript.push(exchange)
    emit({ type: 'event', name: 'turn.started', exchange })
    sub.queue.push({ turn, text: request })
    void next(sub)
  }

  const subthreads = createSubthreads({
    registry,
    transcript,
    timers: options.timers,
    workIn: abilities?.workIn?.bind(abilities),
    handTo,
    // Resolves once a thread has nothing left to answer.
    idle: (thread) =>
      new Promise<void>((resolve) => {
        const runtime = runtimeFor(thread)
        if (!runtime.answering && runtime.queue.length === 0) return resolve()
        runtime.idle.push(resolve)
      })
  })

  const threadTools = createThreadTools({
    registry,
    records,
    newId,
    transcript,
    subthreads,
    ownerOf,
    doing,
    touched: (thread) => [...(runtimes.get(thread)?.answering?.touched ?? [])],
    written: (turn, text) => {
      turn.exchange = { ...turn.exchange, written: text }
      replace(turn.exchange)
      emit({ type: 'event', name: 'answer.written', exchange: turn.exchange })
    }
  })

  const threadSession = async (runtime: Runtime, engine: Harness, server: string): Promise<Session> => {
    const thread = registry.get(runtime.thread)
    const folder = thread?.folder
    const persona = activePersona()
    const profile = memory?.profile()
    const granted = abilities?.reach?.(() => showing())
    // Files handed to the thread are readable by it, whatever else it may reach: the person gave them.
    const computer: Reach | undefined = granted && { ...granted, scope: () => withReadable(granted.scope(), runtime.readable) }
    // A change of program, model, level of reasoning or persona opens a new session for the next question, told what was said before.
    const key = JSON.stringify([
      engine.id,
      engines.chosenModel(engine.id) ?? null,
      engines.chosenEffort(engine.id) ?? null,
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
    const told = abilities?.told?.(await engine.computer?.())
    // A project's thread is given what the project tells those who work in it, and what it did there so far.
    const project = folder ? { folder, guide: await abilities?.guide?.(folder), worked: abilities?.worked?.(runtime.thread, folder) } : undefined
    // A sub-thread works for the thread that opened it: what it must ask the person (an approval) is shown while that
    // thread's topic is on the stage.
    const parent = kind === 'subthread' && thread?.parent !== undefined ? registry.get(thread.parent) : undefined
    const showing = (): Showing => ({
      thread: runtime.thread,
      turn: runtime.answering?.exchange.turn,
      focused: registry.focused()?.id === (parent?.id ?? runtime.thread),
      aside: runtime.answering?.aside === true
    })
    runtime.showing = showing
    const grant = abilities?.grant(threadTools.toolsOf(runtime, kind, abilities.threadTools(showing, persona.stance)))
    const earlier = recapFor(runtime.thread)
    const instructions = threadInstructions({
      persona,
      earlier,
      profile: profile?.text,
      summary: memory?.summary?.(runtime.thread),
      title: thread?.title ?? 'A topic',
      kind,
      project,
      ...(parent ? { parent: parent.title } : {}),
      ...(abilities
        ? {
            abilities: [kind === 'subthread' ? undefined : abilities.instructions, abilities.standing?.('thread'), told].filter(Boolean).join('\n\n')
          }
        : {})
    })
    // A thread may search the web and read pages with the harness's own tools, and hand parts of its work to the
    // harness's own sub-agents. A project's works in its folder.
    const session = engine.open({
      role: 'thread',
      instructions,
      web: true,
      agents: true,
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
          // Its work begins with its first call that is not the report or a view: a quick answer has none. Saying
          // nothing until it is done, it leaves a pause. A sub-thread is heard by no one: all it writes is kept.
          if (project && turn.delegated === undefined && !turn.working && !SPOKEN_FIRST.has(event.name)) {
            turn.working = true
            turn.saidBeforeWork = turn.sentences.size
            atPause()
          }
        }
        step(turn, runtime.thread, event)
        // At work on a project, a view shown on the way does not end what is said.
        if (event.phase === 'ended' && event.name === SHOW_TOOL && !event.failed && turn.sentences.size > 0 && !project) turn.shown = true
        if (event.phase === 'ended' && !event.failed && event.wrote && event.wrote.length > 0 && runtime.showing)
          abilities?.wrote?.(runtime.showing(), event.wrote)
        return
      case 'plan': {
        if (!turn) return
        // The harness's own to-do list for the work: the person sees where it stands, and the others are told.
        const plan = event.steps.slice(0, PLAN_STEPS_MAX).flatMap((one) => {
          const text = shorten(one.text, PLAN_STEP_MAX_LENGTH)
          return text === '' ? [] : [{ text, state: one.state }]
        })
        turn.exchange = plan.length > 0 ? { ...turn.exchange, plan } : withoutPlan(turn.exchange)
        replace(turn.exchange)
        emit({ type: 'event', name: 'turn.planned', exchange: turn.exchange })
        return
      }
      case 'turn-end': {
        if (!turn) return
        // A sub-thread's result is for the thread that opened it, which reads it when it waits for it: nothing is ready
        // for the person, and nothing is told.
        if (turn.delegated !== undefined) {
          finish(turn, turn.stopped ? 'stopped' : 'done')
          runtime.answering = undefined
          registry.setState(runtime.thread, 'parked')
          return void next(runtime)
        }
        // An answer is waiting to be seen when some of it was said while another turn had the stage, or when it
        // finished out of sight before saying anything.
        const outOfSight = current !== turn && !(turn.after !== undefined && current === turn.after)
        // What a project's thread wrote after its last call is how the work went.
        for (const sentence of turn.narration.splice(0)) say(turn, sentence)
        finish(turn, turn.stopped ? 'stopped' : 'done')
        const missed = (unheard.get(turn.exchange.turn)?.length ?? 0) > 0 || (outOfSight && turn.heard === 0)
        runtime.answering = undefined
        registry.setState(runtime.thread, missed && !turn.stopped ? 'ready' : 'parked')
        // An answer finished out of sight waits, marked ready; a notification says so to a person not looking, and
        // the assistant at the next pause.
        if (missed) notice(turn)
        if (missed && !turn.stopped) {
          toTell.add(runtime.thread)
          atPause()
        }
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
        return settle(runtime)
    }
  }

  /**
   * A thread with nothing left to answer tells whoever waits for it: the thread that opened it, as its sub-thread. A
   * side question's session is kept as long as its card, for what may follow, then closed.
   */
  const settle = (runtime: Runtime) => {
    if (runtime.answering || runtime.queue.length > 0) return
    for (const resolve of runtime.idle.splice(0)) resolve()
    closeLater(runtime)
  }

  /**
   * Close a thread's session once it has had nothing to answer for as long as it is kept, so that side questions,
   * answered in passing, do not each hold a session and the machine's memory until the app quits (docs/SPEC.md,
   * sections 7.3 and 7.5). The next request opens a new one, told what came before. A topic's session is not closed:
   * it holds what a long piece of work read and did, which the recap of a new one would not.
   */
  const closeLater = (runtime: Runtime) => {
    runtime.closing?.()
    runtime.closing = undefined
    const live = runtime.live
    if (!options.timers || !live || runtime.kept === undefined) return
    runtime.closing = options.timers.after(runtime.kept, () => {
      runtime.closing = undefined
      if (runtime.live !== live || runtime.answering || runtime.queue.length > 0) return
      runtime.live = undefined
      end(live)
    })
  }

  /** Give the thread the next request that waits for it, if it is free. */
  const next = async (runtime: Runtime) => {
    if (runtime.answering) return
    const waiting = runtime.queue.shift()
    if (!waiting) return settle(runtime)
    // At work again, its session stays open; once done, a side question's is kept as long as its card. Followed up, it
    // is a topic's, kept.
    runtime.closing?.()
    runtime.closing = undefined
    runtime.kept = waiting.turn.aside ? ASIDE_STAYS_MS : undefined
    runtime.answering = waiting.turn
    registry.setState(runtime.thread, 'working')
    /** The request ends before its session hears it: the thread is free again for the next. */
    const skip = (outcome: 'failed' | 'stopped', problem?: string) => {
      runtime.answering = undefined
      finish(waiting.turn, outcome, problem)
      registry.setState(runtime.thread, 'parked')
      return void next(runtime)
    }
    const engine = await harness()
    const server = abilities?.server()
    if (typeof engine === 'string') return skip('failed', engine)
    if (server === undefined) return skip('failed', 'The tools are not running.')
    if (waiting.turn.stopped) return skip('stopped')
    const live = runtime.live
    const session = await threadSession(runtime, engine, server)
    if (waiting.turn.stopped) return skip('stopped')
    // A session kept open is told what changed of what it may do on the computer, rather than opened again.
    const told = abilities?.told?.(await engine.computer?.())
    const changed =
      runtime.live === live && live !== undefined && live.told !== told
        ? `(What you may do on the computer changed since your instructions were written. It now stands as follows, in place of what they said:)\n${told ?? 'You have no access to the computer.'}\n\n`
        : ''
    if (runtime.live) runtime.live.told = told
    const recalled = memory?.recall(waiting.text, runtime.live?.knownSince)
    const { handed } = waiting.turn
    const images = engine.capabilities?.images === true
    const note = noteForThread(handed, waiting.text, images)
    const working = registry.get(runtime.thread)
    const reminder = waiting.turn.delegated !== undefined ? DELEGATED_FIRST : working?.folder === undefined ? SPEAK_FIRST : WORK_FIRST
    // What it is asked is kept until it is answered, so a restart of the app does not lose it (`resume`). Who works
    // beside it is told now, when it starts, rather than when it was asked: others may have started meanwhile. So are
    // its own sub-threads still at work, or done since it last read them.
    records.append([{ type: WORK, payload: { thread: runtime.thread, request: waiting.text, exchange: waiting.turn.exchange } }])
    const beside = working ? `${threadTools.besideIn(working)}${subthreads.note(working.id)}` : ''
    // A side question is answered in passing; a request that follows it up is the topic's own, answered in full.
    const side = waiting.turn.aside ? `${SIDE_QUESTION}\n\n` : ''
    session.send(
      `${context()}\n${changed}${recalled ? `${recalled}\n\n` : ''}${waiting.text}${beside}\n\n${note ? `${note}\n\n` : ''}${side}${reminder}`,
      attachmentsFor(handed, images)
    )
  }

  /**
   * Pass a turn to a thread, which answers it as soon as it is free. A topic takes the focus, unless the turn is a side
   * question: the topic on the stage then stays there.
   */
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
    if (thread.kind === 'topic' && !turn.aside) {
      registry.focus(thread.id)
      screen.focus(thread.id)
    }
    runtime.queue.push({ turn, text })
    void next(runtime)
  }

  /**
   * Pass a request on. The first one passed takes the turn; a second, when the person asked two things at once,
   * becomes a turn of its own, heard once the first is answered. A third is refused: two is already a lot to hear.
   * Either may be a side question, answered beside the topic on the stage.
   */
  const passOn = (turn: Turn, thread: Thread, request: string, aside = false): ToolResult => {
    if (!turn.routed) {
      turn.aside = aside
      route(turn, thread, request)
      return { ok: true, text: `Thread ${thread.id} is answering. Write nothing more.` }
    }
    if (turn.next || turn.routed.thread === thread.id) return { ok: false, text: 'This has already been passed on. Write nothing more.' }
    const exchange: Exchange = { turn: newId(), at: now().toISOString(), persona: turn.exchange.persona, said: request, replied: '', outcome: 'running' }
    const second = newTurn(exchange, turn.language, turn.handed)
    second.aside = aside
    second.after = turn
    turn.next = second
    transcript.push(exchange)
    emit({ type: 'event', name: 'turn.started', exchange })
    route(second, thread, request)
    return { ok: true, text: `Thread ${thread.id} is answering that part. Write nothing more.` }
  }

  // ---------------------------------------------------------------- the orchestrator

  const routing = routingTools({
    registry,
    screen,
    workIn: abilities?.workIn?.bind(abilities),
    deciding: () => deciding,
    answering: (thread) => runtimes.get(thread)?.answering,
    doing,
    summaryOf,
    passOn,
    bringBack,
    say
  })

  const orchestratorSession = (engine: Harness): Session => {
    const persona = activePersona()
    const server = abilities?.server()
    const profile = memory?.profile()
    const key = JSON.stringify([engine.id, persona.id, persona.name, persona.stance, server ?? null, profile?.version ?? null])
    if (orchestrator?.key === key) return orchestrator.session
    end(orchestrator)
    const earlier = recapFor(undefined)
    const standing = abilities?.standing?.('orchestrator')
    // With no tool server there is nothing to route with: one session answers everything.
    const grant = abilities && server !== undefined ? abilities.grant([...routing, ...(abilities.orchestratorTools?.() ?? [])]) : undefined
    const session =
      grant && server !== undefined
        ? engine.open({
            role: 'orchestrator',
            instructions: orchestratorInstructions({ persona, earlier, profile: profile?.text, ...(standing ? { abilities: standing } : {}) }),
            tools: { url: server, token: grant.token }
          })
        : engine.open({ role: 'thread', instructions: instructionsFor({ persona, earlier, profile: profile?.text }) })
    const live: Live = { session, key, grant, knownSince: earlier[0]?.at ?? now().toISOString() }
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

  /** What a session reads first with each message, since a model has no clock: the moment, and the language to answer in when the user set it. */
  const context = () => {
    const language = answerLanguage()
    return `(Now: ${moment(now(), options.timeZone?.())}${language === undefined ? '' : `. Answer in ${languageName(language)}.`})`
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
    if (abilities?.server() !== undefined) return `${context()}\nThreads:\n${registry.index(doing, summaryOf)}\n\n${what(turn)}`
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

  /**
   * What the person said or asked takes the stage, as a turn of theirs. A thread that was answering finishes in the
   * background, and its answer waits, marked ready; an answer the orchestrator was still giving is stopped, and so is
   * a turn still waiting for it.
   */
  const personsTurn = (text: string, language: string | undefined, handed: Handed): Turn => {
    const attached = attachedOf(handed)
    const exchange: Exchange = {
      turn: newId(),
      at: now().toISOString(),
      persona: activePersona().id,
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
      if (!previous.routed) halt(previous)
      const second = previous.next
      if (second && second.held.length > 0) {
        unheard.set(second.exchange.turn, [...(unheard.get(second.exchange.turn) ?? []), ...second.held.splice(0)])
        if (second.exchange.outcome !== 'running' && second.routed) {
          registry.setState(second.routed.thread, 'ready')
          toTell.add(second.routed.thread)
        }
      }
    }
    if (pending) finish(pending, 'stopped')
    pending = undefined
    return turn
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
    for (const resolve of turn.stopping.splice(0)) resolve()
    if (turn.routed) {
      if (turn.routed.answering === turn) {
        turn.routed.live?.session.interrupt()
        // Its sub-threads work for it: they stop with it.
        for (const sub of subthreads.of(turn.routed.thread)) if (sub.state === 'working') stopThreadWork(sub.id)
      } else {
        turn.routed.queue = turn.routed.queue.filter((waiting) => waiting.turn !== turn)
        finish(turn, 'stopped')
        settle(turn.routed)
      }
    } else if (deciding === turn) {
      orchestrator?.session.interrupt()
    } else {
      finish(turn, 'stopped')
    }
    if (turn.next) halt(turn.next)
  }

  /** Stop one thread: the request it is answering and those waiting for it. False when it has nothing to stop. */
  const stopThreadWork = (thread: string): boolean => {
    const runtime = runtimes.get(thread)
    if (!runtime || (!runtime.answering && runtime.queue.length === 0)) return false
    for (const waiting of runtime.queue.splice(0)) {
      waiting.turn.stopped = true
      finish(waiting.turn, 'stopped')
    }
    if (runtime.answering) halt(runtime.answering)
    else settle(runtime)
    return true
  }

  /** A thread's requests, oldest first, and every call made for them: those recorded, and those still running. */
  const workOf = (id: string): { exchanges: Exchange[]; steps: Step[] } => {
    const exchanges = transcript.filter((line) => line.thread === id)
    const turns = new Set(exchanges.map((line) => line.turn))
    const steps: Step[] = []
    for (const record of records.read([STEP])) {
      const read = stepSchema.safeParse(record.payload)
      if (read.success && (read.data.thread === id || turns.has(read.data.turn))) steps.push(read.data)
    }
    for (const turn of [current, deciding, ...[...runtimes.values()].map((runtime) => runtime.answering)]) {
      if (turn && turns.has(turn.exchange.turn)) for (const open of turn.steps.values()) if (!steps.some((one) => one.call === open.call)) steps.push(open)
    }
    return { exchanges, steps }
  }

  return {
    say(text, language, handed = NOTHING_HANDED, aloud = false) {
      // A yes or a no to a question on screen answers it: the turn that asked goes on, and no new one starts. What
      // answers a question is never kept in the log: a confirmation phrase said aloud is the person's own.
      // Files handed over are something new to look at, never an answer.
      if (!handedAny(handed) && abilities?.hear?.(text, aloud)) return current?.exchange.turn ?? newId()
      memory?.wake()
      // A thank you and nothing more: the side questions are answered, and their cards leave. It is still answered.
      const names = settings.read().personas.available.map((one) => one.name)
      if (isThanks(text, names)) putAsidesAway()
      const turn = personsTurn(text, language, handed)
      if (deciding) pending = turn
      else void decide(turn)
      return turn.exchange.turn
    },

    work({ folder, request }, language) {
      memory?.wake()
      const turn = personsTurn(request, language, NOTHING_HANDED)
      // The project's thread carries on, unless it is at work: what is asked then runs beside it, as the
      // orchestrator would have it, rather than waiting behind work it may have nothing to do with.
      const same = registry
        .read()
        .threads.find((thread) => thread.kind === 'topic' && thread.folder !== undefined && partsFrom(thread.folder, folder)?.length === 0)
      const free = same && runtimes.get(same.id)?.answering === undefined ? same : undefined
      const thread = free ?? registry.open({ title: folderName(folder).slice(0, 80), kind: 'topic', folder })
      emit({ type: 'event', name: 'turn.started', exchange: turn.exchange })
      route(turn, thread, request)
      return { thread: thread.id, turn: turn.exchange.turn }
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
      // Said whole, as one turn the assistant started; the card shows what it is about while it is heard.
      const cutter = createSentenceCutter()
      return byItself('reminder', [...cutter.push(sentence), ...cutter.flush()], language, silent, (turn) =>
        screen.present(card, { thread: undefined, turn, focused: true })
      )
    },

    resume() {
      const started: TurnId[] = []
      // One turn for each thread: what it planned for after the restart, else the request the restart cut short.
      const byThread = new Map<string, Resumption[]>()
      for (const resumption of resumptions.splice(0)) byThread.set(resumption.thread, [...(byThread.get(resumption.thread) ?? []), resumption])
      // Counted before any is woken, so a thread woken now does not hold back its own sub-threads, and with the turns
      // this restart cut short, which are in the transcript only once they are closed below.
      const counted = [...transcript, ...[...byThread.values()].flat().flatMap((resumption) => (resumption.cut ? [resumption.cut] : []))]
      const held = new Set([...byThread.keys()].map(ownerOf).filter((owner) => resumesInARow(counted, owner) >= RESUMES_WITHOUT_THE_PERSON))

      for (const [id, waiting] of byThread) {
        records.append(waiting.map((resumption) => ({ type: RESUMED, payload: { id: resumption.id } })))
        const thread = registry.get(id)
        if (!thread) continue
        const owner = ownerOf(thread.id)
        // The requests cut short are closed as stopped; a thread that has carried on by itself enough waits for the person.
        const problem = held.has(owner)
          ? `The app restarted. Not carried on by itself: it already had been ${RESUMES_WITHOUT_THE_PERSON} times since you last spoke to it.`
          : 'The app restarted.'
        for (const { cut } of waiting) {
          if (!cut) continue
          const stopped: Exchange = { ...cut, outcome: 'stopped', problem }
          transcript.push(stopped)
          records.append([{ type: EXCHANGE, payload: stopped }])
        }
        if (held.has(owner)) continue

        const planned = waiting.find((resumption) => !resumption.cut)
        const cutShort = waiting.find((resumption) => resumption.cut)
        const cut = cutShort?.cut
        // A sub-thread takes up its part for the thread that opened it, out of the conversation, as before.
        const delegated = thread.kind === 'subthread' ? owner : undefined
        const exchange: Exchange = {
          turn: newId(),
          at: now().toISOString(),
          persona: cut?.persona ?? activePersona().id,
          thread: thread.id,
          said: planned?.request ?? cut?.said ?? '',
          trigger: delegated === undefined ? 'resume' : 'delegated',
          replied: '',
          outcome: 'running'
        }
        const turn = newTurn(exchange, undefined, NOTHING_HANDED, delegated !== undefined, thread.title)
        turn.delegated = delegated
        transcript.push(exchange)
        emit({ type: 'event', name: 'turn.started', exchange })
        const runtime = runtimeFor(thread.id)
        turn.routed = runtime
        const request = wakeRequest({ planned: planned?.request, cut: cutShort?.request, asked: lastRequest(transcript, owner) })
        runtime.queue.push({ turn, text: request })
        void next(runtime)
        started.push(exchange.turn)
      }
      return started
    },

    task({ title, request, language, silent }) {
      const exchange: Exchange = {
        turn: newId(),
        at: now().toISOString(),
        persona: activePersona().id,
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

    busy,

    stop() {
      // Quieting the voice quiets what was still to be told by itself too; the chips stay. The side questions' cards
      // leave with it: Escape puts away what was passing.
      toTell.clear()
      putAsidesAway()
      if (current && !current.working) halt(current)
    },

    stopThread: stopThreadWork,

    stopAll() {
      toTell.clear()
      const running = new Set<Turn>()
      for (const turn of [pending, current, deciding]) if (turn) running.add(turn)
      for (const runtime of runtimes.values()) {
        if (runtime.answering) running.add(runtime.answering)
        for (const waiting of runtime.queue.splice(0)) running.add(waiting.turn)
      }
      pending = undefined
      for (const turn of running) {
        turn.stopped = true
        for (const resolve of turn.stopping.splice(0)) resolve()
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
        settle(runtime)
      }
    },

    // The conversation: the work a thread handed to its sub-threads is in their own threads, not in it.
    read: (limit) => transcript.filter(inConversation).slice(-limit),

    forgetLines(turns) {
      for (let at = transcript.length - 1; at >= 0; at--) if (turns.has((transcript[at] as Exchange).turn)) transcript.splice(at, 1)
      for (const turn of turns) unheard.delete(turn)
    },

    threads: () => registry.read(),

    turn: () => current?.exchange.turn,

    focus(id) {
      const thread = registry.get(id)
      if (!thread) return false
      // Its answer was written while another turn was on the stage: what was not heard of it is said now.
      const missed = bringBack(thread)
      if (missed)
        for (const sentence of missed.sentences) {
          const language = answerIn(sentence, undefined)
          emit({ type: 'event', name: 'speech.say', turn: missed.turn, text: sentence, ...(language === undefined ? {} : { language }) })
        }
      return true
    },

    thread(id, before) {
      const thread = registry.get(id)
      if (!thread) return undefined
      const { exchanges, steps } = workOf(id)
      return { thread, ...fitThread(exchanges, steps, screen.history(id), before) }
    },

    step(id, call) {
      if (!registry.get(id)) return undefined
      const found = workOf(id).steps.find((one) => one.call === call)
      return found && stepWhole(found)
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    close() {
      end(orchestrator)
      orchestrator = undefined
      for (const runtime of runtimes.values()) {
        runtime.closing?.()
        end(runtime.live)
      }
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
    ...handed.folders.map((folder) => ({ name: folderName(folder), kind: 'folder' as const }))
  ]
}
