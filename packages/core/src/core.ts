import type { Event, Result } from '@repo/protocol'
import { createChannel } from './channel/channel.ts'
import { createExecutor } from './commands/execute.ts'
import { type Admission, admit } from './devices/admission.ts'
import { createEngineRoom } from './engines/engines.ts'
import type { Harness } from './ports/harness.ts'
import type { Log } from './ports/log.ts'
import type { Records } from './ports/records.ts'
import { createUserSettings } from './settings/settings.ts'

/** What a core is given by the program that hosts it. */
export interface CoreOptions {
  /** The version of this core, told to clients for diagnostics. */
  version: string
  /** Whether a credential is one this core accepts. How it is checked depends on where the core runs. */
  acceptsCredential: (credential: string) => boolean
  records: Records
  log: Log
  /** The harnesses the assistant can run on, in order of preference. */
  harnesses: readonly Harness[]
  /** A new identifier, unique for good. */
  newId: () => string
  /** The time now. Left out, the machine's clock. */
  now?: () => Date
}

/** The core as the listeners see it. */
export interface Core {
  /** Decide whether a client may connect, from the first message it sent. */
  admit(message: unknown): Admission
  /** Carry out a command from an admitted client. Resolves with nothing for a message that is not a command. */
  execute(message: unknown): Promise<Result | undefined>
  /** Be told each event, to pass it on to every admitted client. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
  /** End the sessions the core holds. Called once, when the process stops. */
  close(): void
}

export function createCore(options: CoreOptions): Core {
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  const settings = createUserSettings(options.records)
  const engines = createEngineRoom(options.harnesses)
  const channel = createChannel({
    engines,
    settings,
    records: options.records,
    log: options.log,
    now: options.now ?? (() => new Date()),
    newId: options.newId
  })

  settings.onChange((changed) => emit({ type: 'event', name: 'settings.changed', settings: changed }))
  engines.onChange((changed) => emit({ type: 'event', name: 'engines.changed', engines: changed }))
  channel.onEvent(emit)

  const execute = createExecutor(
    {
      'settings.read': () => ({ ok: true, output: { settings: settings.read() } }),
      'personas.set': (input) => {
        const change = settings.setPersonas(input)
        return change.ok ? { ok: true, output: { settings: change.settings } } : change
      },
      'utterance.send': (input) => ({ ok: true, output: { turn: channel.say(input.text, input.language) } }),
      'turn.stop': () => {
        channel.stop()
        return { ok: true, output: {} }
      },
      'channel.read': (input) => ({ ok: true, output: { exchanges: channel.read(input.limit) } }),
      'engines.read': async () => ({ ok: true, output: { engines: await engines.read(true) } }),
      'engines.sign-in': async (input) => {
        const known = (await engines.read()).harnesses.some((harness) => harness.id === input.harness)
        if (!known) return { ok: false, error: { code: 'unknown-harness', message: `There is no harness "${input.harness}".` } }
        await engines.signIn(input.harness)
        return { ok: true, output: {} }
      }
    },
    options.log
  )

  return {
    admit: (message) => admit(message, { coreVersion: options.version, acceptsCredential: options.acceptsCredential }),
    execute,
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => channel.close()
  }
}
