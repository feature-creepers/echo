import type { Attachment, Harness, HarnessModels, HarnessStatus, OneShot, Session, SessionEvent, SessionRequest } from '../ports/harness.ts'

/**
 * A harness that plays a script instead of running a model. For tests, and for replaying a recorded
 * conversation through the core.
 */
export interface ScriptedSession {
  request: SessionRequest
  /** Everything sent to the session, in order. */
  sent: string[]
  /** The files sent with each message, in the same order. */
  attached: (readonly Attachment[])[]
  interrupted: number
  closed: boolean
  /** Make the session produce an event, as a real one would on its own. */
  emit(event: SessionEvent): void
  /** Write a reply piece by piece and end the turn. */
  reply(...pieces: string[]): void
}

export interface ScriptedHarness extends Harness {
  /** Every session opened, in order. */
  sessions: ScriptedSession[]
  /** What one-shot questions were asked. */
  completions: OneShot[]
  /** Change what `status()` answers from now on. */
  stand(status: HarnessStatus): void
  signIns: number
}

export interface ScriptOptions {
  id?: string
  name?: string
  status?: HarnessStatus
  /** Answers one-shot questions. Left out, they are answered with an empty text. */
  complete?: (request: OneShot) => string
  /** The models it offers. Left out, a fast one by default and a strong one. */
  models?: HarnessModels
  /** Whether its sessions show the model pictures. Left out, they do not. */
  images?: boolean
}

const SCRIPTED_MODELS: HarnessModels = {
  models: [
    { id: 'quick', name: 'Quick', description: 'Fast and inexpensive.' },
    {
      id: 'deep',
      name: 'Deep',
      description: 'Slower, for harder questions.',
      efforts: [
        { id: 'light', name: 'Light', description: 'Thinks a little.' },
        { id: 'hard', name: 'Hard', description: 'Thinks hard.' }
      ],
      defaultEffort: 'light'
    }
  ],
  default: 'quick'
}

export function scriptedHarness(options: ScriptOptions = {}): ScriptedHarness {
  let status: HarnessStatus = options.status ?? { installed: true, signedIn: true, version: '1.0.0' }
  const harness: ScriptedHarness = {
    id: options.id ?? 'scripted',
    name: options.name ?? 'Scripted',
    ...(options.images ? { capabilities: { images: true } } : {}),
    sessions: [],
    completions: [],
    signIns: 0,
    stand: (next) => {
      status = next
    },
    status: async () => status,
    models: async () => options.models ?? SCRIPTED_MODELS,
    signIn: async () => {
      harness.signIns++
    },
    complete: async (request) => {
      harness.completions.push(request)
      return options.complete?.(request) ?? ''
    },
    open(request) {
      let listener: ((event: SessionEvent) => void) | undefined
      const waiting: SessionEvent[] = []
      const scripted: ScriptedSession = {
        request,
        sent: [],
        attached: [],
        interrupted: 0,
        closed: false,
        emit(event) {
          if (listener) listener(event)
          else waiting.push(event)
        },
        reply(...pieces) {
          for (const text of pieces) scripted.emit({ type: 'text', text })
          scripted.emit({ type: 'turn-end' })
        }
      }
      harness.sessions.push(scripted)
      const session: Session = {
        send: (text, attachments = []) => {
          scripted.sent.push(text)
          scripted.attached.push(attachments)
        },
        interrupt: () => {
          scripted.interrupted++
        },
        close: () => {
          scripted.closed = true
        },
        onEvent: (next) => {
          listener = next
          for (const event of waiting.splice(0)) next(event)
        }
      }
      return session
    }
  }
  return harness
}
