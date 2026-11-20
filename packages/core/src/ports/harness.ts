import type { PlanStep } from '@repo/protocol'

/**
 * What the core needs from an AI agent program such as Claude Code or Codex.
 *
 * A harness is an engine. The core gives it instructions, the address of its own tool server and what the
 * user said; it takes back reply text and the fact that tools were used. Everything a harness would add by
 * itself is switched off by its adapter: its memory, the user's settings and project files, the user's own
 * tool servers, its own tools, slash commands and plugins. What it keeps of its own is its to-do list for a piece of
 * work, which it reports as a plan, and for a thread its sub-agents, held to the thread's scope and kept from the
 * core's tools.
 */

/** What a session is for, which decides the model it runs on. Each adapter maps roles to its own models. */
export type Role =
  /** Hears every utterance and decides who answers. Fast. */
  | 'orchestrator'
  /** Works on one topic. Strong. */
  | 'thread'
  /** Summaries, titles, extraction of facts. The cheapest that does the job. */
  | 'utility'

/** Where a harness stands on this machine. */
export interface HarnessStatus {
  /** The program was found. */
  installed: boolean
  /** The user is signed in to it, with their own account. */
  signedIn: boolean
  version?: string
  /** The account signed in, in words for the user: an address, a plan. */
  account?: string
  /** Why it cannot be used, in words for the user. Left out when it can. */
  problem?: string
  /**
   * Its program gave no answer: it did not finish in time, could not start, or said something that could not be
   * read. Unlike "not installed" or "not signed in", a moment later it may well be ready, so it is asked again.
   */
  unanswered?: boolean
}

/** The core's tool server, as a session reaches it: MCP over HTTP on the loopback address. */
export interface ToolServer {
  url: string
  /** Sent by the harness as a bearer token with every call. It tells the core which session is calling. */
  token: string
}

/** What a session may reach on the computer the harness runs on. Read at each use: the person may grant more during a turn. */
export interface Scope {
  /** Folders and files, by absolute path, and whether each may be changed. The assistant's own folder is one, when it is on. */
  places: readonly { path: string; kind: 'folder' | 'file'; write: boolean }[]
  /** Beyond the places: nothing, reading anywhere, or reading and changing anywhere. */
  computer: 'off' | 'read' | 'write'
  /** The folder a session works in: the assistant's own folder. Left out when it is off. */
  home?: string | undefined
  /** Places never reached, whatever was granted: keys, credentials, browser profiles, the app's own data. */
  protected?: readonly ProtectedPath[] | undefined
}

/** A place never reached: a folder or a file, or every file whose name ends a certain way. */
export interface ProtectedPath {
  /** What it holds, in a few words: "SSH keys". */
  label: string
  /** An absolute folder or file. */
  path?: string | undefined
  /** Or every file whose name ends so, whatever the capitals: `.kdbx`. */
  ending?: string | undefined
  /** Folders inside it that are reached all the same: the assistant's own folder, inside the app's data. */
  except?: readonly string[] | undefined
}

/** One use of a harness's own tool on the computer, as the core is asked about it. */
export interface ComputerUse {
  /** What it does: `create` a file, `change` one, `delete` one, `run` a command, or `read`. */
  action: 'read' | 'create' | 'change' | 'delete' | 'run'
  /** The tool, as the harness names it: Read, Write, Bash. */
  tool: string
  /** What it touches, absolute. For a command, the folder it runs in. */
  paths: string[]
  /** For a command, the command line. */
  command?: string | undefined
  /** For a command, the shell that reads it. Left out, the POSIX shell, which is how Claude Code runs one. */
  shell?: 'posix' | 'powershell' | 'cmd' | undefined
  /** For a command, whether every path it names may be changed (`write`), or some may only be read. */
  reach?: 'read' | 'write' | undefined
  /**
   * For a command, the places it names outside the folder it runs in, as the adapter found them to check them:
   * where it may change files beyond its folder, looked at too to find what it changed there.
   */
  named?: readonly NamedPlace[] | undefined
  /**
   * For a file created, changed or deleted: git reads its settings, its hooks or a repository from it, so a git
   * command that only reads could run a program written there.
   */
  changesGit?: true | undefined
  /**
   * The adapter found it beyond what was granted, or reaching a place never reached: the core refuses it with
   * this reason, and keeps the refusal in the activity.
   */
  refused?: { why: 'outside' | 'protected'; reason: string } | undefined
}

/** A place a command names: real and absolute, and whether the command goes through what is inside it. */
export interface NamedPlace {
  path: string
  below: boolean
}

/** Whether a use may go ahead. Allowed, it carries the use's identifier, which the adapter reports its outcome with. */
export type Verdict = { allow: true; use?: string | undefined } | { allow: false; reason: string }

/** Told when what was asked is no longer wanted: the turn stopped. A standard AbortSignal is one. */
export interface Signal {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/**
 * The computer as a session may reach it. The harness checks every use of its own tools against the scope,
 * refusing what falls outside it, and asks the core about the rest; the core decides whether the person
 * approves it first. Nothing is left to the model (docs/SPEC.md, section 12.2).
 */
export interface Reach {
  scope(): Scope
  /** Resolves when the use may go ahead, or why not, in words the model can tell the person. Aborted when the turn stops. */
  approve(use: ComputerUse, signal: Signal): Promise<Verdict>
  /** How a use that was allowed went, once the harness says: done, or failed with a short error. */
  report?(use: string, outcome: { ok: boolean; error?: string | undefined }): void
}

export interface SessionRequest {
  role: Role
  /** The system prompt, whole. Nothing of the harness's own is added to it. */
  instructions: string
  /** The tools the session may call. Left out, the session has none and can only write text. */
  tools?: ToolServer
  /**
   * Whether the session may search the web and read pages with the harness's own tools, which come with the
   * user's subscription (docs/SPEC.md, section 6.2). They are reported as the tools `web_search` and `web_read`.
   */
  web?: boolean
  /** The model to run on, as the harness names it, in place of the one it gives the role. */
  model?: string
  /** How hard the model reasons, as the harness names the level, in place of the model's own default. */
  effort?: string
  /** The person's files and commands, within what they granted. Left out, the session reaches nothing of the computer. */
  computer?: Reach
  /**
   * The folder the session works in: a project's, which its commands run in and its relative paths start from. Left
   * out, the assistant's own folder. Either way, what it may reach is the scope's: the folder grants nothing.
   */
  folder?: string
  /**
   * Whether the session may hand parts of its work to the harness's own sub-agents (docs/SPEC.md, section 6.2). They
   * work with the harness's tools the session was given, within the same scope and approved the same way, and are
   * refused the core's tools: the voice, the screen and the person are the session's. Their calls are reported as the
   * session's, and the call that starts one as the tool `subagent`. Left out, there are none.
   */
  agents?: boolean
}

export type SessionEvent =
  /** A piece of the reply, as it is written. Pieces arrive in order; put end to end they are the reply. */
  | { type: 'text'; text: string }
  /**
   * A tool of the core, or a web tool of the harness, started or ended. `name` is the tool's name as the core
   * serves it. `call` tells the calls apart. A call can be reported started twice: as soon as the session begins
   * writing it, then again once its input is complete. Its end carries what the tool gave back, whole, and, for
   * a use of the computer that made or changed files, where they are, absolute, and for a use of the computer the
   * core allowed, the identifier `Reach.approve` gave it.
   */
  | {
      type: 'tool'
      name: string
      phase: 'started' | 'ended'
      call?: string
      input?: unknown
      output?: string
      failed?: boolean
      wrote?: string[]
      use?: string
    }
  /**
   * The plan the session keeps for the work under way, whole, as it now stands: the harness's own to-do list. Each
   * new one replaces the last.
   */
  | { type: 'plan'; steps: PlanStep[] }
  /** The turn is over. Nothing more comes until the next `send`. */
  | { type: 'turn-end' }
  /** The session cannot go on, and why, in words for the user. It is closed. */
  | { type: 'failed'; reason: string }

/**
 * A file the person handed over with what they said, kept on the computer the harness runs on. The text sent with
 * it names it; a picture is also shown to the model, when the harness can show it one.
 */
export interface Attachment {
  /** Where it is, absolute. */
  path: string
  name: string
  /** Its media type: "image/png", "application/pdf". */
  mediaType: string
  /** Shown to the model as a picture. Otherwise the model reads it with its tools, by its path. */
  image: boolean
}

/** A live conversation with a harness. It keeps what was said, turn after turn, until it is closed. */
export interface Session {
  /**
   * Say something, with files the person handed over. Accepted while a turn is running: it then steers that turn
   * or follows it.
   */
  send(text: string, attachments?: readonly Attachment[]): void
  /** Stop the turn under way. The session stays usable. */
  interrupt(): void
  /** End the session and its process. */
  close(): void
  /** Sets the one listener given every event. Events that happened before it was set are kept and delivered. */
  onEvent(listener: (event: SessionEvent) => void): void
}

/** A single question with no tools and no memory of earlier ones. */
export interface OneShot {
  role: Role
  instructions: string
  input: string
  /** Give up after this long. Left out, two minutes. */
  timeoutMs?: number
  /** The model to run on, as the harness names it, in place of the one it gives the role. */
  model?: string
  /** How hard the model reasons, as the harness names the level, in place of the model's own default. */
  effort?: string
}

/** How hard a model reasons before it answers: a level the user can choose, described in plain words. */
export interface HarnessEffort {
  /** What the harness's program is given for it: "high", "xhigh". */
  id: string
  name: string
  /** What it is good for, in a few plain words. */
  description: string
}

/** A model the user can choose for the assistant, described for someone who does not follow AI news. */
export interface HarnessModel {
  /** What the harness's program is given to run on it. */
  id: string
  name: string
  /** What it is good for, in a few plain words. */
  description: string
  /** The levels of reasoning it offers, from the lightest to the deepest. Left out, it offers no choice. */
  efforts?: HarnessEffort[]
  /** The `id` of the level it reasons at when the user has not chosen, when the harness says. */
  defaultEffort?: string
}

/** The models a harness offers for the assistant's answers, and the one it uses unless told otherwise. */
export interface HarnessModels {
  models: HarnessModel[]
  /** The `id` of the one used when the user has not chosen. It is among `models`. */
  default: string
}

/** What a harness can do beyond text. */
export interface HarnessCapabilities {
  /** Its sessions show the model the pictures sent with what is said. Without it, pictures are named by their path. */
  images: boolean
}

/**
 * How a harness's sessions work with the person's files and commands on this computer: what its instructions call
 * its tools, whether the system holds its commands to what was granted, and what it needs to reach files at all.
 */
export interface HarnessComputer {
  /** Its tools for files and commands, as the session is told them: "Read, Glob, Grep, Write, Edit and Bash". */
  tools: string
  /** How to use them, in a sentence or two the session is told. */
  use: string
  /** The tool that puts a file on the computer, as the session knows it: "Write". */
  write: string
  /**
   * The system holds each command to what was granted, whatever paths a program works out once it runs: it may
   * change only the places that may be changed, and never read a place never reached.
   */
  confines: boolean
  /**
   * What it needs to reach files: anything granted, or the whole computer to read, when it reaches files only
   * through a command line it cannot keep from reading elsewhere.
   */
  needs: 'grant' | 'computer'
}

export interface Harness {
  /** Identifies the harness in settings and records: 'claude-code', 'codex'. */
  id: string
  /** Its name, as the user knows it. */
  name: string
  /** Left out, it can do nothing beyond text. */
  capabilities?: HarnessCapabilities
  /**
   * How its sessions work with files and commands on this computer, found once (it may run its program to find out).
   * Left out, as Claude Code does without confinement: `Read`, `Write`, `Bash` and the like, reaching what is granted.
   */
  computer?(): Promise<HarnessComputer>
  status(): Promise<HarnessStatus>
  /** Open the vendor's own sign-in, in a terminal. The core never sees the credentials. */
  signIn(): Promise<void>
  /** The models the user can choose from for the assistant's answers (the `thread` role). Never rejects. */
  models(): Promise<HarnessModels>
  open(request: SessionRequest): Session
  /** Resolves with the answer. Rejects with an error whose message is written for the user. */
  complete(request: OneShot): Promise<string>
}
