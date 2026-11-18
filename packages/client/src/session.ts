import { COMMANDS, type CommandErrorCode, type CommandInput, type CommandName, type CommandOutput, type Event, eventSchema, resultSchema } from '@repo/protocol'
import type { Transport } from './transport.ts'

/** What a session needs from the link under it: a way to send, and the messages that arrive. */
export type SessionLink = Pick<Transport, 'send' | 'onMessage'>

/** Why a command gave no output: the core's reason, or one of the client's own. */
export type CommandFailure =
  | CommandErrorCode
  /** The session was closed before the result arrived. */
  | 'closed'
  /** The core answered with an output this client cannot read. */
  | 'unreadable'

export class CommandFailed extends Error {
  readonly code: CommandFailure

  constructor(command: string, code: CommandFailure, detail?: string) {
    super(`The command "${command}" failed: ${detail ?? code}`)
    this.name = 'CommandFailed'
    this.code = code
  }
}

/** The exchange with a core once admitted: commands out, results and events in. */
export interface Session {
  /** Send a command and wait for its output. Rejects with `CommandFailed` when the core refuses it, or when the session closes first. */
  run<Name extends CommandName>(name: Name, input: CommandInput<Name>): Promise<CommandOutput<Name>>
  /** Be told each event the core sends. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** Stop: commands still waiting fail, and nothing more is heard. The link under the session is left as it is. */
  close(): void
}

interface Waiting {
  name: CommandName
  resolve: (output: never) => void
  reject: (error: CommandFailed) => void
}

/**
 * Open a session on a link to a core that has admitted this client.
 *
 * A message that is neither a result this session waits for nor an event it knows is ignored: a newer
 * core may send more than this client understands.
 */
export function openSession(link: SessionLink): Session {
  // Told apart from the commands of an earlier session on the same link, whose results may still arrive.
  const tag = Math.random().toString(36).slice(2, 10)
  const waiting = new Map<string, Waiting>()
  const listeners = new Set<(event: Event) => void>()
  let sent = 0
  let closed = false

  link.onMessage((message) => {
    if (closed) return

    const result = resultSchema.safeParse(message)
    if (result.success) {
      const command = waiting.get(result.data.id)
      if (!command) return
      waiting.delete(result.data.id)
      if (!result.data.ok) return command.reject(new CommandFailed(command.name, result.data.error.code, result.data.error.message))
      const output = COMMANDS[command.name].output.safeParse(result.data.output)
      if (!output.success) return command.reject(new CommandFailed(command.name, 'unreadable'))
      return command.resolve(output.data as never)
    }

    const event = eventSchema.safeParse(message)
    if (event.success) for (const listener of listeners) listener(event.data)
  })

  return {
    run(name, input) {
      if (closed) return Promise.reject(new CommandFailed(name, 'closed'))
      const id = `${tag}-${++sent}`
      return new Promise((resolve, reject) => {
        waiting.set(id, { name, resolve, reject })
        link.send({ type: 'command', id, name, input })
      })
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    close() {
      if (closed) return
      closed = true
      link.onMessage(() => undefined)
      listeners.clear()
      for (const command of waiting.values()) command.reject(new CommandFailed(command.name, 'closed'))
      waiting.clear()
    }
  }
}
