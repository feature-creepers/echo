/**
 * What the core needs from an AI agent program such as Claude Code or Codex.
 *
 * A harness is an engine. The core gives it instructions, the address of its own tool server and what the
 * user said; it takes back reply text and the fact that tools were used. Everything a harness would add by
 * itself is switched off by its adapter: its memory, the user's settings and project files, the user's own
 * tool servers, its own tools, slash commands, plugins and sub-agents.
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
}

/** The core's tool server, as a session reaches it: MCP over HTTP on the loopback address. */
export interface ToolServer {
  url: string
  /** Sent by the harness as a bearer token with every call. It tells the core which session is calling. */
  token: string
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
}

export type SessionEvent =
  /** A piece of the reply, as it is written. Pieces arrive in order; put end to end they are the reply. */
  | { type: 'text'; text: string }
  /** A tool of the core started or ended. `name` is the tool's name as the core serves it. */
  | { type: 'tool'; name: string; phase: 'started' | 'ended' }
  /** The turn is over. Nothing more comes until the next `send`. */
  | { type: 'turn-end' }
  /** The session cannot go on, and why, in words for the user. It is closed. */
  | { type: 'failed'; reason: string }

/** A live conversation with a harness. It keeps what was said, turn after turn, until it is closed. */
export interface Session {
  /** Say something. Accepted while a turn is running: it then steers that turn or follows it. */
  send(text: string): void
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
}

/** A model the user can choose for the assistant, described for someone who does not follow AI news. */
export interface HarnessModel {
  /** What the harness's program is given to run on it. */
  id: string
  name: string
  /** What it is good for, in a few plain words. */
  description: string
}

/** The models a harness offers for the assistant's answers, and the one it uses unless told otherwise. */
export interface HarnessModels {
  models: HarnessModel[]
  /** The `id` of the one used when the user has not chosen. It is among `models`. */
  default: string
}

export interface Harness {
  /** Identifies the harness in settings and records: 'claude-code', 'codex'. */
  id: string
  /** Its name, as the user knows it. */
  name: string
  status(): Promise<HarnessStatus>
  /** Open the vendor's own sign-in, in a terminal. The core never sees the credentials. */
  signIn(): Promise<void>
  /** The models the user can choose from for the assistant's answers (the `thread` role). Never rejects. */
  models(): Promise<HarnessModels>
  open(request: SessionRequest): Session
  /** Resolves with the answer. Rejects with an error whose message is written for the user. */
  complete(request: OneShot): Promise<string>
}
