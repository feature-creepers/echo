import type { Event, Result } from '@repo/protocol'
import { createExecutor } from './commands/execute.ts'
import { type Admission, admit } from './devices/admission.ts'
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
}

/** The core as the listeners see it: three things a connection can do. */
export interface Core {
  /** Decide whether a client may connect, from the first message it sent. */
  admit(message: unknown): Admission
  /** Carry out a command from an admitted client. Gives nothing for a message that is not a command. */
  execute(message: unknown): Result | undefined
  /** Be told each event, to pass it on to every admitted client. Returns a function that stops the telling. */
  onEvent(listener: (event: Event) => void): () => void
}

export function createCore(options: CoreOptions): Core {
  const settings = createUserSettings(options.records)
  const listeners = new Set<(event: Event) => void>()

  settings.onChange((changed) => {
    for (const listener of listeners) listener({ type: 'event', name: 'settings.changed', settings: changed })
  })

  const execute = createExecutor(
    {
      'settings.read': () => ({ ok: true, output: { settings: settings.read() } }),
      'personas.set': (input) => {
        const change = settings.setPersonas(input)
        return change.ok ? { ok: true, output: { settings: change.settings } } : change
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
    }
  }
}
