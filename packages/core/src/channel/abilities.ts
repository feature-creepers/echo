import type { Persona } from '@repo/protocol'
import type { HarnessComputer, Reach } from '../ports/harness.ts'
import type { Grant, Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'

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
  told?(tools?: HarnessComputer): string | undefined
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
  hear?(said: string, spoken?: boolean): boolean
  /** A thread made or changed files on the computer, at these places, absolute: they are shown where `showing` says. */
  wrote?(showing: Showing, paths: readonly string[]): void
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
  /** What a thread is about and where it stands, as sleep last wrote it. */
  summary?(thread: string): string | undefined
}
