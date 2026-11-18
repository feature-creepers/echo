import { CLEAR_TOOL, describeCatalog, MEDIA_TOOL, SHOW_TOOL, SHOW_TOOL_INPUT, validateView } from '@repo/catalog'
import { type Event, MEDIA_ACTIONS, type Result } from '@repo/protocol'
import { createAccess } from './access/access.ts'
import { createBrowserControl } from './browser/browser.ts'
import { createChannel } from './channel/channel.ts'
import { createExecutor } from './commands/execute.ts'
import { type Admission, admit } from './devices/admission.ts'
import { createEngineRoom } from './engines/engines.ts'
import { createFiles } from './files/files.ts'
import { createLibrary } from './library/library.ts'
import { createMemory } from './memory/memory.ts'
import { createObjections } from './personas/objection.ts'
import type { Blobs } from './ports/blobs.ts'
import type { Browser } from './ports/browser.ts'
import type { Timers } from './ports/clock.ts'
import type { Computer } from './ports/computer.ts'
import type { Harness } from './ports/harness.ts'
import type { Log } from './ports/log.ts'
import type { Records } from './ports/records.ts'
import type { Search } from './ports/search.ts'
import type { ToolHost } from './ports/tools.ts'
import type { Web } from './ports/web.ts'
import { memorySearch } from './records/memory-search.ts'
import { createSchedule } from './schedule/schedule.ts'
import { SCHEDULE_INSTRUCTIONS, SCHEDULE_ROUTING, scheduleTools } from './schedule/tools.ts'
import { createUserSettings } from './settings/settings.ts'
import { createTools, type Tool } from './tools/tools.ts'
import { createMaps } from './views/maps.ts'
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
  /** Search over the text of the records. Left out, they are searched in memory: for tests and small logs. */
  search?: Search
  /** Timers, for the assistant to fall asleep after a quiet period. Left out, it sleeps only when told to. */
  timers?: Timers
  log: Log
  /** The harnesses the assistant can run on, in order of preference. */
  harnesses: readonly Harness[]
  /** A new identifier, unique for good. */
  newId: () => string
  /** The time now. Left out, the machine's clock. */
  now?: () => Date
  /** The person's time zone, as an IANA name: reminders ring by its clock. Left out, the zone of the machine the core runs on. */
  timeZone?: () => string
  /** Public web addresses, read by the core itself: the shapes of a map. Left out, maps are shown unchecked. */
  web?: Web
  /** The computer the core runs on, whose files the assistant may reach as the user grants. Left out, it reaches none. */
  computer?: Computer
  /** The web browser of the computer the core runs on, which the assistant drives as the user allows. Left out, it has none. */
  browser?: Browser
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
  const zone = options.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const settings = createUserSettings(options.records, undefined, options.computer?.workspace)
  const engines = createEngineRoom(options.harnesses, {
    preferred: () => settings.read().engines.preferred,
    model: (harness) => settings.read().engines.models[harness]
  })
  const tools = createTools(options.newId)
  let toolServer: string | undefined
  const screen = createScreen({ records: options.records, newId: options.newId })
  const mapsOf = createMaps(options.web)

  /** The screen's tools, for one thread: its views go where `showing` says. */
  const screenTools = (showing: () => Showing): Tool[] => [
    {
      definition: {
        name: SHOW_TOOL,
        description:
          'Show a view on the screen, composed from the blocks of the catalogue. It replaces what was shown. Answers with the problems to correct when the view is not valid. Say your short answer aloud before calling it, so the view appears while you are heard.',
        inputSchema: SHOW_TOOL_INPUT
      },
      async run(input) {
        // A map is checked against the shapes it names first, so a join that finds nothing comes back to be corrected.
        const written = validateView((input as { view?: unknown } | undefined)?.view)
        const maps = written.ok ? await mapsOf.check(written.spec) : { problems: [], notes: [] }
        if (maps.problems.length > 0) return { ok: false, text: `The view was not shown. Correct this and show it again:\n- ${maps.problems.join('\n- ')}` }
        const shown = screen.show(input, showing())
        return shown.ok && maps.notes.length > 0 ? { ...shown, text: `${shown.text} Note: ${maps.notes.join(' ')}` } : shown
      }
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
    },
    {
      definition: {
        name: MEDIA_TOOL,
        description:
          'Pause, resume or stop what the media player plays (a radio, a podcast, a video). It plays on when its view is cleared or replaced, so stop it with this when the person asks.',
        inputSchema: { type: 'object', properties: { action: { type: 'string', enum: [...MEDIA_ACTIONS] } }, required: ['action'] }
      },
      run: (input) => {
        const action = (input as { action?: unknown } | undefined)?.action
        if (!MEDIA_ACTIONS.includes(action as (typeof MEDIA_ACTIONS)[number])) return { ok: false, text: `action is one of: ${MEDIA_ACTIONS.join(', ')}.` }
        emit({ type: 'event', name: 'media.control', action: action as (typeof MEDIA_ACTIONS)[number] })
        return { ok: true, text: 'Done.' }
      }
    }
  ]

  const library = createLibrary({ records: options.records, screen, now, newId: options.newId })
  const access = createAccess({ settings, screen, computer: options.computer, timers: options.timers })
  const browser = createBrowserControl({ browser: options.browser, settings, ask: access.ask, records: options.records, computer: options.computer })
  const objections = createObjections({ records: options.records, screen, now })
  const files = createFiles({ records: options.records, blobs: options.blobs, now, newId: options.newId })

  // Memory (docs/SPEC.md, section 10): recalled into each turn, written while the assistant sleeps, and its tools.
  let currentTurn: () => string | undefined = () => undefined
  const memory = createMemory({
    records: options.records,
    search: options.search ?? memorySearch(options.records),
    engines,
    log: options.log,
    now,
    newId: options.newId,
    turn: () => currentTurn(),
    busy: () => currentTurn() !== undefined,
    ...(options.timers ? { timers: options.timers } : {})
  })
  memory.onEvent(emit)

  // Reminders and scheduled tasks (docs/SPEC.md, section 7.10): they ring as turns the assistant starts itself, through
  // the channel made below. Nothing rings before a client has sent a command, by which time the channel is there.
  const schedule = createSchedule({
    records: options.records,
    now,
    zone,
    timers: options.timers,
    newId: options.newId,
    proactive: {
      busy: () => channel.busy(),
      remind: (reminder) => void channel.remind(reminder),
      run: (task) => void channel.task(task),
      notify: (notification) => emit({ type: 'event', name: 'device.notify', notification })
    }
  })
  const timeTools = scheduleTools({ schedule, now, zone })

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
        ...memory.tools,
        ...library.tools(showing),
        ...access.tools(showing),
        ...browser.tools(showing),
        ...timeTools,
        ...(stance === 'critical' ? objections.tools(showing) : [])
      ],
      // A reminder needs no screen and no research: the orchestrator sets it itself, which answers sooner.
      orchestratorTools: () => timeTools,
      instructions: `${describeCatalog()}\n\n${library.instructions}\n\n${memory.instructions}\n\n${SCHEDULE_INSTRUCTIONS}`,
      standing: (role) =>
        [
          objections.standing(),
          library.standing(role),
          ...(role === 'thread' ? [access.standing(), browser.standing()] : [`${SCHEDULE_INSTRUCTIONS}\n${SCHEDULE_ROUTING}`])
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
      // The person's files and commands, within what they granted (docs/SPEC.md, section 12.2).
      reach: (showing) => access.reach(showing),
      version: () => `${access.version()} ${browser.version()}`,
      hear: (said) => access.hear(said)
    },
    memory,
    // A notification for what finished while the person may not be looking: only when the window is not in front of
    // them, and with no sound in the quiet hours.
    notify: (notice) => emit({ type: 'event', name: 'device.notify', notification: { ...notice, silent: schedule.quiet(), unlessFocused: true } })
  })
  currentTurn = channel.turn

  settings.onChange((changed) => {
    emit({ type: 'event', name: 'settings.changed', settings: changed })
    // The harness preferred or a model may have changed: the clients see it at once, the sessions from the next one.
    void engines.reconsider()
  })
  engines.onChange((changed) => emit({ type: 'event', name: 'engines.changed', engines: changed }))
  channel.onEvent(emit)
  screen.onEvent(emit)
  library.onEvent(emit)
  schedule.onEvent(emit)

  const execute = createExecutor(
    {
      'settings.read': () => ({ ok: true, output: { settings: settings.read() } }),
      'personas.set': (input) => {
        const change = settings.setPersonas(input)
        return change.ok ? { ok: true, output: { settings: change.settings } } : change
      },
      'utterance.send': (input) => ({ ok: true, output: { turn: channel.say(input.text, input.language) } }),
      'assistant.greet': () => {
        const turn = channel.greet()
        return { ok: true, output: turn === undefined ? {} : { turn } }
      },
      'turn.stop': () => {
        channel.stop()
        return { ok: true, output: {} }
      },
      'channel.read': (input) => ({ ok: true, output: { exchanges: channel.read(input.limit) } }),
      'engines.read': async () => ({ ok: true, output: { engines: await engines.read(true) } }),
      'view.read': () => {
        const view = screen.current()
        const shown = { margin: screen.margin(), stream: screen.stream() }
        return { ok: true, output: view ? { view, ...shown } : shown }
      },
      'view.clear': (input) => {
        screen.clear(input.view)
        return { ok: true, output: {} }
      },
      'threads.read': () => ({ ok: true, output: channel.threads() }),
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
      'file.read': (input) => {
        const file = files.read(input.file)
        return file
          ? { ok: true, output: { name: file.name, mime: file.mime, format: file.format, version: file.version, text: file.text } }
          : { ok: false, error: { code: 'invalid-input', message: `There is no file "${input.file}".` } }
      },
      'shapes.read': async (input) => {
        const read = await mapsOf.regions(input.url)
        return read.ok
          ? { ok: true, output: { shapes: read.regions } }
          : { ok: false, error: { code: 'invalid-input', message: `The map's shapes could not be read: ${read.problem}` } }
      },
      'library.read': () => ({ ok: true, output: { library: library.read() } }),
      'schedule.read': () => ({ ok: true, output: { schedule: schedule.read() } }),
      'schedule.pause': (input) => {
        const change = schedule.change(input.job, { paused: input.paused })
        return change.ok ? { ok: true, output: { schedule: schedule.read() } } : { ok: false, error: { code: 'invalid-input', message: change.problem } }
      },
      'schedule.delete': (input) => {
        const change = schedule.remove(input.jobs)
        return change.ok ? { ok: true, output: { schedule: change.schedule } } : change
      },
      'schedule.quiet.set': (input) => ({ ok: true, output: { schedule: schedule.setQuiet(input) } }),
      'schedule.hold': (input) => ({ ok: true, output: { schedule: schedule.hold(input.held) } }),
      'library.save': (input) => {
        const saved = library.save(input)
        return saved.ok ? { ok: true, output: { widget: saved.widget, library: saved.library } } : saved
      },
      'library.update': (input) => {
        const change = library.update(input)
        return change.ok ? { ok: true, output: { library: change.library } } : change
      },
      'library.arrange': (input) => {
        const change = library.arrange(input)
        return change.ok ? { ok: true, output: { library: change.library } } : change
      },
      'library.delete': (input) => {
        const change = library.remove(input.widget)
        return change.ok ? { ok: true, output: { library: change.library } } : change
      },
      'library.show': (input) => {
        // Brought back by the user, it is shown on the stage over whatever topic is there, and starts nothing by itself.
        const shown = library.show(input.widget, { thread: undefined, turn: undefined, slot: 'stage', focused: true })
        return shown.ok ? { ok: true, output: {} } : { ok: false, error: { code: 'unknown-widget', message: shown.text } }
      },
      'thread.focus': (input) =>
        channel.focus(input.thread)
          ? { ok: true, output: {} }
          : { ok: false, error: { code: 'invalid-input', message: `There is no thread "${input.thread}".` } },
      'thread.read': (input) => {
        const read = channel.thread(input.thread)
        return read ? { ok: true, output: read } : { ok: false, error: { code: 'invalid-input', message: `There is no thread "${input.thread}".` } }
      },
      'engines.prefer': async (input) => {
        if (input.harness !== null && !(await engines.read()).harnesses.some((harness) => harness.id === input.harness)) {
          return { ok: false, error: { code: 'unknown-harness', message: `There is no harness "${input.harness}".` } }
        }
        return { ok: true, output: { settings: settings.prefer(input.harness) } }
      },
      'access.set': async (input) => {
        const change = await access.set(input)
        return change.ok ? { ok: true, output: { settings: change.settings } } : change
      },
      'languages.set': (input) => ({ ok: true, output: { settings: settings.setLanguages(input) } }),
      'browser.read': async () => ({ ok: true, output: { browser: await browser.state() } }),
      'browser.show': async () => {
        const shown = await browser.show()
        return shown.ok ? { ok: true, output: { browser: shown.browser } } : shown
      },
      'engines.model.set': async (input) => {
        const harness = (await engines.read()).harnesses.find((known) => known.id === input.harness)
        if (!harness) return { ok: false, error: { code: 'unknown-harness', message: `There is no harness "${input.harness}".` } }
        if (input.model !== null && !harness.models.some((model) => model.id === input.model)) {
          return { ok: false, error: { code: 'unknown-model', message: `${harness.name} does not offer the model "${input.model}".` } }
        }
        // The default is kept as no choice at all, so a user who picks it follows the default as it changes.
        const model = input.model === harness.defaultModel ? null : input.model
        return { ok: true, output: { settings: settings.chooseModel(input.harness, model) } }
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
    execute(message) {
      // A client that sends commands is there to hear what rings: from then on, reminders and tasks ring.
      schedule.listen()
      return execute(message)
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    toolHost: tools.host,
    serveToolsAt(url) {
      toolServer = url
    },
    close() {
      schedule.close()
      channel.close()
      memory.close()
      void browser.close()
    }
  }
}
