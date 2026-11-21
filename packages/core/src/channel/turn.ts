import type { Exchange, Step } from '@repo/protocol'
import { type Handed, NOTHING_HANDED } from '../attachments/framing.ts'
import type { Session } from '../ports/harness.ts'
import { createSentenceCutter, type SentenceCutter } from '../speech/sentences.ts'
import type { Grant } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'

/** A request under way: what the person said, or the assistant started on, and how its answer goes. */
export interface Turn {
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
   * A side question (docs/SPEC.md, section 7.5): passed on without moving the focus, and answered in passing, briefly,
   * by a thread whose session is not kept for long.
   */
  aside: boolean
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
  /**
   * What set a scheduled task off, the files or mails that arrived: sent with its request, never kept in the
   * transcript, since others may have written it.
   */
  arrived: string | undefined
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
  /** The files its calls changed so far, for the other threads working beside it. */
  touched: Set<string>
  /**
   * For part of a thread's work handed to a sub-thread: the thread that handed it. Nothing of it is said or shown, and
   * its result goes back to that thread.
   */
  delegated: string | undefined
  /** Told when it is stopped: a wait of its thread for its sub-threads ends with it. */
  stopping: (() => void)[]
  /**
   * The person sees a screen while it is answered. False when they said it to a device that shows no views now, as
   * the desktop's Mini window: whoever answers is told to say a little more.
   */
  screen: boolean
  /** What the orchestrator is told of the view the person had in front of them when they said it, if it was one. */
  inFront: string | undefined
}

/** A live session, and what it was opened for. When any of that changes, the session is replaced. */
export interface Live {
  session: Session
  key: string
  grant: Grant | undefined
  /** The date of the oldest line the session was told about: recall leaves out what it already has. */
  knownSince: string
  /** What it was last told of what it may do on the computer. */
  told?: string | undefined
}

/** A thread at work: its session, the turn it answers, and what waits for it. */
export interface Runtime {
  thread: string
  live: Live | undefined
  answering: Turn | undefined
  queue: { turn: Turn; text: string }[]
  /** Files the person handed this thread, by where they are: it may read them, whatever else it may reach. */
  readable: string[]
  /** Where its views go, once its session is open. */
  showing: (() => Showing) | undefined
  /** Told once it has nothing left to answer: the thread that opened it, waiting for its result. */
  idle: (() => void)[]
  /**
   * How long its session stays open once it has nothing to answer, after its latest request: a side question's, as long
   * as its card. Left out, it stays open until the app quits, as a topic's does.
   */
  kept: number | undefined
  /** Cancels the closing of its session, due once it was kept long enough with nothing to answer. */
  closing: (() => void) | undefined
}

export const newTurn = (exchange: Exchange, language: string | undefined, handed: Handed = NOTHING_HANDED, silent = false, title?: string): Turn => ({
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
  aside: false,
  next: undefined,
  after: undefined,
  held: [],
  shown: false,
  silent,
  title,
  arrived: undefined,
  noticed: false,
  working: false,
  narration: [],
  saidBeforeWork: 0,
  touched: new Set(),
  delegated: undefined,
  stopping: [],
  screen: true,
  inFront: undefined
})

export const newRuntime = (thread: string): Runtime => ({
  thread,
  live: undefined,
  answering: undefined,
  queue: [],
  readable: [],
  showing: undefined,
  idle: [],
  kept: undefined,
  closing: undefined
})
