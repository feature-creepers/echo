import { CLEAR_TOOL, describeCatalog, SHOW_TOOL, SHOW_TOOL_INPUT } from '@repo/catalog'
import type { Event, Result } from '@repo/protocol'
import { createChannel } from './channel/channel.ts'
import { createExecutor } from './commands/execute.ts'
import { type Admission, admit } from './devices/admission.ts'
import { createEngineRoom } from './engines/engines.ts'
import { createMemory } from './memory/memory.ts'
import type { Timers } from './ports/clock.ts'
import type { Harness } from './ports/harness.ts'
import type { Log } from './ports/log.ts'
import type { Records } from './ports/records.ts'
import type { Search } from './ports/search.ts'
import type { ToolHost } from './ports/tools.ts'
import { memorySearch } from './records/memory-search.ts'
import { createUserSettings } from './settings/settings.ts'
import { createTools, type Tool } from './tools/tools.ts'
import { createScreen } from './views/screen.ts'

/** What a core is given by the program that hosts it. */
export interface CoreOptions {
  /** The version of this core, told to clients for diagnostics. */
  version: string
  /** Whether a credential is one this core accepts. How it is checked depends on where the core runs. */
  acceptsCredential: (credential: string) => boolean
  records: Records
  /** Search over the text of the records. Left out, they are searched in memory: for tests and small logs. */
  search?: Search
  log: Log
  /** The harnesses the assistant can run on, in order of preference. */
  harnesses: readonly Harness[]
  /** A new identifier, unique for good. */
  newId: () => string
  /** The time now. Left out, the machine's clock. */
  now?: () => Date
  /** To do things later, such as falling asleep after a quiet period. Left out, the assistant sleeps only when told. */
  timers?: Timers
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
  // The screen needs the turn under way, which the channel knows; the channel needs the screen's tools.
  let currentTurn: () => string | undefined = () => undefined
  const screen = createScreen({ records: options.records, newId: options.newId, turn: () => currentTurn() })

  const screenTools: Tool[] = [
    {
      definition: {
        name: SHOW_TOOL,
        description:
          'Show a view on the screen, composed from the blocks of the catalogue. It replaces what was shown. Answers with the problems to correct when the view is not valid.',
        inputSchema: SHOW_TOOL_INPUT
      },
      run: (input) => screen.show(input)
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

  // Memory (docs/SPEC.md, section 10): recalled into each turn, written while the assistant sleeps, and its tools.
  const memory = createMemory({
    records: options.records,
    search: options.search ?? memorySearch(options.records),
    engines,
    log: options.log,
    now,
    newId: options.newId,
    turn: () => currentTurn(),
    busy: () => currentTurn() !== undefined,
    timers: options.timers
  })
  memory.onEvent(emit)

  const channel = createChannel({
    engines,
    settings,
    records: options.records,
    log: options.log,
    now,
    newId: options.newId,
    abilities: {
      server: () => toolServer,
      grant: () => tools.grant([...screenTools, ...memory.tools]),
      instructions: `${describeCatalog()}\n\n${memory.instructions}`
    },
    memory
  })
  currentTurn = channel.turn

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
        return { ok: true, output: view ? { view } : {} }
      },
      'view.clear': () => {
        screen.clear()
        return { ok: true, output: {} }
      },
      'memory.read': () => ({ ok: true, output: { memory: memory.read(), state: memory.state() } }),
      'memory.edit': (input) => {
        const change = memory.edit(input)
        return change.ok ? { ok: true, output: { memory: change.memory } } : change
      },
      'memory.forget': (input) => {
        const change = memory.forget(input.fact)
        return change.ok ? { ok: true, output: { memory: change.memory } } : change
      },
      'memory.sleep-settings.set': (input) => ({ ok: true, output: { memory: memory.setSleep(input) } }),
      'memory.sleep-now': () => {
        const asked = memory.sleepNow()
        return asked.ok ? { ok: true, output: {} } : asked
      },
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
    close() {
      channel.close()
      memory.close()
    }
  }
}
