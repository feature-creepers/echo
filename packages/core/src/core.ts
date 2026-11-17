import { CLEAR_TOOL, describeCatalog, SHOW_TOOL, SHOW_TOOL_INPUT } from '@repo/catalog'
import type { Event, Result } from '@repo/protocol'
import { createChannel } from './channel/channel.ts'
import { createExecutor } from './commands/execute.ts'
import { type Admission, admit } from './devices/admission.ts'
import { createEngineRoom } from './engines/engines.ts'
import { createFiles } from './files/files.ts'
import { createObjections } from './personas/objection.ts'
import type { Blobs } from './ports/blobs.ts'
import type { Harness } from './ports/harness.ts'
import type { Log } from './ports/log.ts'
import type { Records } from './ports/records.ts'
import type { ToolHost } from './ports/tools.ts'
import { createUserSettings } from './settings/settings.ts'
import { createTools, type Tool } from './tools/tools.ts'
import { createScreen, type Showing } from './views/screen.ts'

/** What a core is given by the program that hosts it. */
export interface CoreOptions {
  /** The version of this core, told to clients for diagnostics. */
  version: string
  /** Whether a credential is one this core accepts. How it is checked depends on where the core runs. */
  acceptsCredential: (credential: string) => boolean
  records: Records
  /** Files' contents. */
  blobs: Blobs
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
  /** What a tool server carries calls to. */
  toolHost: ToolHost
  /**
   * Say where the tool server listens, once it does. Until then sessions can only speak; sessions opened
   * from then on can show things on the screen.
   */
  serveToolsAt(url: string | undefined): void
  /** End the sessions the core holds. Called once, when the process stops. */
  close(): void
}

export function createCore(options: CoreOptions): Core {
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  const now = options.now ?? (() => new Date())
  const settings = createUserSettings(options.records)
  const engines = createEngineRoom(options.harnesses)
  const tools = createTools(options.newId)
  let toolServer: string | undefined
  const screen = createScreen({ records: options.records, newId: options.newId })

  /** The screen's tools, for one thread: its views go where `showing` says. */
  const screenTools = (showing: () => Showing): Tool[] => [
    {
      definition: {
        name: SHOW_TOOL,
        description:
          'Show a view on the screen, composed from the blocks of the catalogue. It replaces what was shown. Answers with the problems to correct when the view is not valid.',
        inputSchema: SHOW_TOOL_INPUT
      },
      run: (input) => screen.show(input, showing())
    },
    {
      definition: {
        name: CLEAR_TOOL,
        description: 'Remove what is shown on the screen, when it no longer serves the conversation.',
        inputSchema: { type: 'object', properties: {} }
      },
      run: () => {
        screen.clear()
        return { ok: true, text: 'Cleared.' }
      }
    }
  ]

  const objections = createObjections({ records: options.records, screen, now })
  const files = createFiles({ records: options.records, blobs: options.blobs, now, newId: options.newId })

  const channel = createChannel({
    engines,
    settings,
    records: options.records,
    screen,
    log: options.log,
    now,
    newId: options.newId,
    abilities: {
      server: () => toolServer,
      grant: (granted) => tools.grant(granted),
      // A critical persona objects through a decision card; an accommodating one only mentions its concern.
      threadTools: (showing, stance) => [
        ...screenTools(showing),
        ...files.tools(() => showing().thread),
        ...(stance === 'critical' ? objections.tools(showing) : [])
      ],
      instructions: describeCatalog(),
      standing: () => objections.standing()
    }
  })

  settings.onChange((changed) => emit({ type: 'event', name: 'settings.changed', settings: changed }))
  engines.onChange((changed) => emit({ type: 'event', name: 'engines.changed', engines: changed }))
  channel.onEvent(emit)
  screen.onEvent(emit)

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
      'view.read': () => {
        const view = screen.current()
        return { ok: true, output: view ? { view, margin: screen.margin() } : { margin: screen.margin() } }
      },
      'view.clear': (input) => {
        screen.clear(input.view)
        return { ok: true, output: {} }
      },
      'threads.read': () => ({ ok: true, output: channel.threads() }),
      'file.read': (input) => {
        const file = files.read(input.file)
        return file
          ? { ok: true, output: { name: file.name, mime: file.mime, format: file.format, version: file.version, text: file.text } }
          : { ok: false, error: { code: 'invalid-input', message: `There is no file "${input.file}".` } }
      },
      'thread.focus': (input) =>
        channel.focus(input.thread)
          ? { ok: true, output: {} }
          : { ok: false, error: { code: 'invalid-input', message: `There is no topic "${input.thread}".` } },
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
    toolHost: tools.host,
    serveToolsAt(url) {
      toolServer = url
    },
    close: () => channel.close()
  }
}
