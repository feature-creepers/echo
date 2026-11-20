import { CLEAR_TOOL, describeCatalog, MEDIA_TOOL, SHOW_TOOL, SHOW_TOOL_INPUT, validateView } from '@repo/catalog'
import { type Capability, type Event, MEDIA_ACTIONS, type Result } from '@repo/protocol'
import { createAccess } from './access/access.ts'
import { createAccountList } from './accounts/accounts.ts'
import { calendarBriefing } from './accounts/briefing.ts'
import { createAccountTools } from './accounts/tools.ts'
import { createAttachments } from './attachments/attachments.ts'
import { giveFolders } from './attachments/folders.ts'
import { createBrowserControl } from './browser/browser.ts'
import { createChannel } from './channel/channel.ts'
import { createInterruptionCap } from './channel/interruptions.ts'
import { createClipboardControl } from './clipboard/tools.ts'
import { createExecutor } from './commands/execute.ts'
import { createDesktopControl } from './desktop/desktop.ts'
import { createDeviceControl } from './device/device.ts'
import { type Admission, admit } from './devices/admission.ts'
import { createEngineRoom } from './engines/engines.ts'
import { createBrowsing } from './files/browse.ts'
import { createFiles } from './files/files.ts'
import { createFolderWatch } from './files/watch.ts'
import { createWrittenFiles } from './files/written.ts'
import { createLibrary } from './library/library.ts'
import { mediaControlOf } from './media/control.ts'
import { contextOf, EARLIER_FILES, type EarlierFact, type EarlierLine, HISTORY_FILE, historyOf, notesOf } from './memory/earlier.ts'
import { createMemory } from './memory/memory.ts'
import { createObjections } from './personas/objection.ts'
import type { Accounts } from './ports/accounts.ts'
import type { Blobs } from './ports/blobs.ts'
import type { Browser } from './ports/browser.ts'
import type { Clipboard } from './ports/clipboard.ts'
import type { Timers } from './ports/clock.ts'
import type { Computer } from './ports/computer.ts'
import type { Desktop } from './ports/desktop.ts'
import type { Drives } from './ports/drives.ts'
import type { Harness } from './ports/harness.ts'
import type { Log } from './ports/log.ts'
import type { Printers } from './ports/printers.ts'
import type { Records } from './ports/records.ts'
import type { Search } from './ports/search.ts'
import type { ToolHost } from './ports/tools.ts'
import type { Web } from './ports/web.ts'
import type { Workspace } from './ports/workspace.ts'
import { inFolder } from './projects/folders.ts'
import { guideText, readGuide } from './projects/guide.ts'
import { memorySearch } from './records/memory-search.ts'
import { createSchedule } from './schedule/schedule.ts'
import { readTiming } from './schedule/timing.ts'
import { SCHEDULE_INSTRUCTIONS, SCHEDULE_ROUTING, scheduleTools } from './schedule/tools.ts'
import { createUserSettings } from './settings/settings.ts'
import { createTools, type Tool } from './tools/tools.ts'
import { createFeeds } from './views/feeds.ts'
import { createMaps } from './views/maps.ts'
import { createScreen, type Showing } from './views/screen.ts'

/** The most of the proof of concept's notes or context file read, and of one day of its history, in bytes. */
const EARLIER_TEXT_LIMIT = 1_000_000
const EARLIER_DAY_LIMIT = 20_000_000
/** The most lines of its history brought in: the latest. */
const EARLIER_LINES_MAX = 200_000

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
  /** The other apps of the computer the core runs on, which the assistant sees and operates as the user allows. Left out, none. */
  desktop?: Desktop
  /** The clipboard of the computer the core runs on. Left out, the assistant has none. */
  clipboard?: Clipboard
  /** The printers of the computer the core runs on. Left out, the assistant prints nothing. */
  printers?: Printers
  /** The removable drives of the computer the core runs on. Left out, the assistant sees none. */
  drives?: Drives
  /**
   * The assistant's own folder, as the person browses it and hands files into it. Left out, nothing can be handed
   * over and there is nothing to browse.
   */
  workspace?: Workspace
  /** Where the previous versions of files the assistant changes are kept, for the person to undo. Left out, with `blobs`. */
  versions?: Blobs
  /** The person's accounts at their providers: their calendars and mail, read as they granted. Left out, none can be connected. */
  accounts?: Accounts
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
  const { computer } = options
  const settings = createUserSettings(options.records, undefined, computer?.workspace)
  const engines = createEngineRoom(
    options.harnesses,
    {
      preferred: () => settings.read().engines.preferred,
      model: (harness) => settings.read().engines.models[harness],
      effort: (harness) => settings.read().engines.efforts[harness]
    },
    // A harness that gave no answer is asked again on its own, and the clients see it come back.
    { now: () => now().getTime(), ...(options.timers ? { timers: options.timers } : {}) }
  )
  const tools = createTools(options.newId)
  let toolServer: string | undefined
  const screen = createScreen({ records: options.records, newId: options.newId, timers: options.timers, now })
  const mapsOf = createMaps(options.web)
  const feeds = createFeeds(options.web, now)

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
        // Its feeds too, so a path that finds nothing is corrected before the person sees it.
        const [maps, fed] = written.ok ? await Promise.all([mapsOf.check(written.spec), feeds.check(written.spec)]) : [{ problems: [], notes: [] }, []]
        const problems = [...maps.problems, ...fed]
        if (problems.length > 0) return { ok: false, text: `The view was not shown. Correct this and show it again:\n- ${problems.join('\n- ')}` }
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
          'Drive the media player (a radio, a podcast, a video): pause, resume or stop it; "volume" with "level" (0 to 100) or "step" (-100 to 100, such as -20 for "a bit lower"); "seek" a file "to" a position or "by" seconds (-30 to go back); "queue" a stream or file to play after the current one (url, kind, title, live), "next" to skip to it, "clear-queue". It plays on when its view is cleared or replaced, so stop it with this when the person asks.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...MEDIA_ACTIONS] },
            level: { type: 'number', description: 'For volume: 0 to 100.' },
            step: { type: 'number', description: 'For volume: a change, -100 to 100.' },
            to: { type: 'number', description: 'For seek: the position, in seconds.' },
            by: { type: 'number', description: 'For seek: seconds from where it is, forward or back.' },
            url: { type: 'string', description: 'For queue: the stream or file itself.' },
            kind: { type: 'string', enum: ['audio', 'video'] },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            live: { type: 'boolean' }
          },
          required: ['action']
        }
      },
      run: (input) => {
        const control = mediaControlOf(input)
        if (typeof control === 'string') return { ok: false, text: control }
        emit({ type: 'event', name: 'media.control', ...control })
        return { ok: true, text: 'Done.' }
      }
    }
  ]

  const library = createLibrary({ records: options.records, screen, now, newId: options.newId })

  /** What the orchestrator is told of the folders a project's thread may work in. */
  const projectsStanding = () => {
    const folders = access.projects()
    return folders.length === 0
      ? undefined
      : `Projects\n\nThe folders the person lets you change, where a project's thread may work:\n${folders.map((folder) => `- ${folder}`).join('\n')}`
  }
  const access = createAccess({
    settings,
    screen,
    computer,
    timers: options.timers,
    records: options.records,
    versions: options.versions ?? options.blobs,
    now,
    newId: options.newId
  })
  access.onEvent(emit)
  const accounts = createAccountList({ port: options.accounts, records: options.records, newId: options.newId, now, log: options.log })
  const browser = createBrowserControl({
    browser: options.browser,
    settings,
    ask: access.ask,
    records: options.records,
    uses: access,
    computer
  })
  const desktop = createDesktopControl({
    desktop: options.desktop,
    settings,
    ask: access.ask,
    uses: access,
    timers: options.timers,
    mark: (control) => emit({ type: 'event', name: 'device.desktop', control })
  })
  const clipboard = options.clipboard ? createClipboardControl({ clipboard: options.clipboard, ask: access.ask, uses: access }) : undefined
  // The person's calendars and mail, read for threads while an account that gives them is ready (docs/SPEC.md, section 12.1).
  const accountTools = createAccountTools({ list: accounts, port: options.accounts, zone, uses: access })
  // What the connected devices declared they can do: a camera is used only where one said it has one.
  const declared = new Set<Capability>()
  const device = createDeviceControl({
    access,
    level: () => settings.read().access.approvals,
    computer,
    printers: options.printers,
    drives: options.drives,
    camera: {
      available: () => declared.has('camera'),
      request: (request, camera) => emit({ type: 'event', name: 'device.camera', request, ...(camera === undefined ? {} : { camera }) }),
      newId: options.newId,
      timers: options.timers,
      workspace: options.workspace,
      stamp: () => pictureStamp(now(), zone())
    }
  })
  const objections = createObjections({ records: options.records, screen, now })
  const files = createFiles({ records: options.records, blobs: options.blobs, now, newId: options.newId })

  // The person's files and the assistant's (docs/SPEC.md, section 9.7): handed over with what is said, browsed in
  // the assistant's folder, and each file a thread writes on the computer shown on a card of its turn.
  const { workspace } = options
  const workspaceChanged = (paths: string[]) => {
    if (paths.length > 0) emit({ type: 'event', name: 'workspace.changed', paths })
  }
  const attachments = createAttachments({ workspace, now, newId: options.newId, timeZone: zone, onChange: (path) => workspaceChanged([path]) })
  // What changes in the folders the person browses is told whoever changed it, a command included, where the computer
  // can watch a folder.
  const watch = computer?.watch?.bind(computer)
  const folderWatch =
    workspace && watch
      ? createFolderWatch({ watch, pathOf: (location) => workspace.pathOf(location), timers: options.timers, changed: workspaceChanged })
      : undefined
  const browsing = createBrowsing({ workspace, settings, listed: folderWatch?.follow })
  const written = workspace
    ? createWrittenFiles({
        screen,
        workspace,
        newId: options.newId,
        projectOf: (thread) => (thread === undefined ? undefined : channel.threads().threads.find((one) => one.id === thread)?.folder)
      })
    : undefined

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
    // The channel is made below; sleep, which asks for a title, never runs before it is.
    titleOf: (thread) => channel.threads().threads.find((one) => one.id === thread)?.title,
    // Lines erased while the app is open leave the transcript too; those erased as memory is made were never read.
    erased: (turns) => channel.forgetLines(turns),
    ...(options.timers ? { timers: options.timers } : {})
  })
  memory.onEvent(emit)

  // How often the assistant speaks up by itself, whatever makes it (docs/SPEC.md, section 7.10): reminders, scheduled
  // tasks, answers finished out of sight. Past the cap the person set, what it would say is shown and not said.
  const interruptions = createInterruptionCap({ now: () => now().getTime(), perHour: () => settings.read().interruptions.perHour })
  // Reminders and scheduled tasks (section 7.10) ring as turns the assistant starts itself, through the channel made
  // below: nothing rings before a client has sent a command, by which time the channel is there. A job may also ring
  // when files arrive in a folder the person granted, where the computer can watch one.
  const fileAt = computer?.fileAt?.bind(computer)
  // Mail arriving in a connected account, where there are accounts.
  const accountPort = options.accounts
  const schedule = createSchedule({
    records: options.records,
    now,
    zone,
    timers: options.timers,
    newId: options.newId,
    proactive: {
      busy: () => channel.busy(),
      mayInterrupt: () => interruptions.take(),
      remind: (reminder) => void channel.remind(reminder),
      run: (task) => void channel.task(task),
      notify: (notification) => emit({ type: 'event', name: 'device.notify', notification })
    },
    files: watch && fileAt ? { watch, fileAt, reaches: (folder) => access.reaches(folder) } : undefined,
    mail: accountPort && {
      accounts: () => accounts.ready('mail').map((account) => ({ id: account.id, address: account.address })),
      arrived: (account, cursor, signal) => accountPort.arrived(account, cursor, signal),
      signInAgain: (account) => accounts.signInAgain(account)
    },
    log: options.log
  })
  const timeTools = scheduleTools({
    schedule,
    now,
    zone,
    mail: { addresses: () => accounts.ready('mail').map((account) => account.address) },
    ...(computer && watch
      ? {
          folders: {
            locate: async (path: string) => {
              const found = await computer.locate(path)
              return found?.kind === 'folder' ? found.path : undefined
            },
            reaches: (path: string) => access.reaches(path)
          }
        }
      : {})
  })

  const channel = createChannel({
    engines,
    settings,
    records: options.records,
    screen,
    log: options.log,
    now,
    newId: options.newId,
    timeZone: zone,
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
        ...desktop.tools(showing),
        ...(clipboard?.tools(showing) ?? []),
        ...accountTools.tools(showing),
        ...device.tools(showing),
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
          ...(role === 'thread'
            ? [browser.standing(), desktop.standing(), accountTools.standing()]
            : [`${SCHEDULE_INSTRUCTIONS}\n${SCHEDULE_ROUTING}`, projectsStanding()])
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
      // The person's files and commands, within what they granted (docs/SPEC.md, section 12.2). What a thread may do is
      // told to it apart, so a session kept open hears when it changes.
      told: (tools) => access.standing(tools),
      reach: (showing) => access.reach(showing),
      // Projects (docs/SPEC.md, section 7.11): a thread works in a folder the person lets it change, follows the
      // project's own instructions, and is reminded of what it did there when a new session carries on.
      workIn: async (path, showing) => {
        const granted = await access.grant({ path, write: true, purpose: 'work' }, showing)
        return granted.ok ? { ok: true, folder: granted.path } : granted
      },
      guide: async (folder) => {
        // Read only while the folder is still within reach: the person may have taken it back since the thread began.
        if (!computer || !access.reaches(folder)) return undefined
        const guide = await readGuide(computer, folder).catch(() => undefined)
        return guide && guideText(guide)
      },
      worked: (thread, folder) => access.worked(thread, folder),
      version: () => `${access.version()} ${browser.version()} ${desktop.version()} ${accounts.version()}`,
      hear: (said, spoken) => access.hear(said, spoken),
      briefing: () => calendarBriefing({ list: accounts, port: options.accounts, now, zone, timers: options.timers }),
      wrote: (showing, paths) => {
        written?.add(showing, paths).catch((error: unknown) => options.log.error(`The card of written files could not be shown: ${String(error)}`))
        workspaceChanged(paths.flatMap((path) => workspace?.pathOf(path) ?? []))
      }
    },
    memory,
    // A notification for what finished while the person may not be looking: only when the window is not in front of
    // them, and with no sound in the quiet hours.
    notify: (notice) => emit({ type: 'event', name: 'device.notify', notification: { ...notice, silent: schedule.quiet(), unlessFocused: true } }),
    // In the quiet hours, or past the cap on interruptions, an answer finished out of sight is left to its chip and
    // its notification.
    mayInterrupt: () => !schedule.quiet() && interruptions.take(),
    // A thread waiting for its sub-threads is told after a while which are still at work.
    timers: options.timers
  })
  currentTurn = channel.turn

  /**
   * What the proof of concept kept in its folder, read for the import (docs/SPEC.md, section 10.7): only its own
   * files, never a place never reached, and nothing changed there. The person chose the folder; it is not granted.
   */
  const readEarlier = async (
    path: string
  ): Promise<{ ok: true; folder: string; facts: EarlierFact[]; lines: EarlierLine[] } | { ok: false; code: 'failed' | 'invalid-input'; text: string }> => {
    if (!computer) return { ok: false, code: 'failed', text: 'There is no computer here to bring it in from.' }
    const found = await computer.locate(path)
    if (found?.kind !== 'folder') return { ok: false, code: 'invalid-input', text: `There is no folder at ${path}.` }
    const never = access.neverReached(found.path)
    if (never) return { ok: false, code: 'invalid-input', text: `${found.path} is among the places never reached (${never}).` }
    const text = async (file: string, limit: number) => {
      if (access.neverReached(file)) return undefined
      const bytes = await computer.read(file, limit).catch(() => undefined)
      return bytes instanceof Uint8Array ? new TextDecoder().decode(bytes).replace(/^﻿/, '') : undefined
    }
    const notes = await text(EARLIER_FILES.notes(found.path), EARLIER_TEXT_LIMIT)
    const context = await text(EARLIER_FILES.context(found.path), EARLIER_TEXT_LIMIT)
    const history = EARLIER_FILES.history(found.path)
    const days = ((await computer.list?.(history).catch(() => undefined)) ?? []).filter((name) => HISTORY_FILE.test(name)).sort()
    const lines: EarlierLine[] = []
    for (const day of days) {
      const read = await text(inFolder(history, day), EARLIER_DAY_LIMIT)
      if (read !== undefined) lines.push(...historyOf(read))
    }
    if (notes === undefined && context === undefined && days.length === 0)
      return {
        ok: false,
        code: 'invalid-input',
        text: 'This is not where the proof of concept kept its data: it holds no notes, context file or history. That folder is in the home folder of the computer it ran on, named after it.'
      }
    const facts = [...(notes ? notesOf(notes) : []), ...(context ? contextOf(context) : [])]
    return { ok: true, folder: found.path, facts, lines: lines.slice(-EARLIER_LINES_MAX) }
  }
  /** Whether the work the last run left was taken up: once, with the first command of a client. */
  let resumed = false
  // Stop everything (docs/SPEC.md, section 12.2): every turn and thread of the conversation is interrupted, and the
  // reminders and scheduled tasks are held, so nothing starts again by itself until the person resumes them on the
  // Reminders page. What else runs on its own registers here with `access.onStopEverything`.
  access.onStopEverything(() => {
    channel.stopAll()
    schedule.hold(true)
    desktop.letGo()
    clipboard?.forget()
    device.forget()
    accounts.cancel()
  })

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
  accounts.onEvent(emit)

  const execute = createExecutor(
    {
      'settings.read': () => ({ ok: true, output: { settings: settings.read() } }),
      'personas.set': (input) => {
        const change = settings.setPersonas(input)
        return change.ok ? { ok: true, output: { settings: change.settings } } : change
      },
      'utterance.send': async (input) => {
        const named = input.attachments ?? []
        const gone = attachments.missing(named)
        if (gone.length > 0) return { ok: false, error: { code: 'invalid-input', message: 'A file handed over is no longer here: hand it over again.' } }
        const folders = input.folders && input.folders.length > 0 ? await giveFolders(input.folders, { settings, computer }) : []
        const handed = { files: attachments.take(named), folders }
        return { ok: true, output: { turn: channel.say(input.text, input.language, handed, input.spoken === true, input.screen !== false) } }
      },
      'attachment.open': (input) => attachments.open(input),
      'attachment.write': (input) => attachments.write(input.attachment, input.data),
      'attachment.close': (input) => attachments.close(input.attachment),
      'attachment.discard': async (input) => {
        await attachments.discard(input.attachment)
        return { ok: true, output: {} }
      },
      'camera.picture': (input) => {
        device.pictureTaken(input)
        return { ok: true, output: {} }
      },
      'workspace.list': (input) => browsing.list(input.path),
      'workspace.read': (input) => browsing.read(input.path, input.offset, input.length),
      'assistant.greet': () => {
        const turn = channel.greet()
        return { ok: true, output: turn === undefined ? {} : { turn } }
      },
      'threads.stop': (input) => {
        if (input.thread !== undefined) return { ok: true, output: { stopped: channel.stopThread(input.thread) } }
        const stopped = channel.busy() || channel.threads().threads.some((thread) => thread.state === 'working')
        channel.stopAll()
        return { ok: true, output: { stopped } }
      },
      'turn.stop': () => {
        channel.stop()
        return { ok: true, output: {} }
      },
      'channel.read': (input) => ({ ok: true, output: { exchanges: channel.read(input.limit) } }),
      'engines.read': async () => ({ ok: true, output: { engines: await engines.read(true) } }),
      'view.read': () => {
        const view = screen.current()
        const stream = screen.stream()
        return { ok: true, output: view ? { view, stream } : { stream } }
      },
      'view.clear': (input) => {
        screen.clear(input.view)
        return { ok: true, output: {} }
      },
      // A button's act, pressed by the person: carried out at once, with no turn and no card (docs/SPEC.md, section 9.5).
      'view.act': async (input) => {
        const done = await desktop.act(input.act)
        return done.ok ? { ok: true, output: {} } : { ok: false, error: { code: 'invalid-input', message: done.problem } }
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
      'memory.import': async (input) => {
        const found = await readEarlier(input.folder)
        if (!found.ok) return { ok: false, error: { code: found.code, message: found.text } }
        const imported = memory.bringIn({ from: found.folder, facts: found.facts, lines: found.lines })
        return { ok: true, output: { memory: memory.read(), imported } }
      },
      'memory.sleep-settings.set': (input) => ({ ok: true, output: { memory: memory.setSleep(input) } }),
      'memory.retention.set': (input) => ({ ok: true, output: { memory: memory.setRetention(input.days) } }),
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
      'feed.read': async (input) => {
        const read = await feeds.read(input.url)
        return read.ok
          ? { ok: true, output: { document: read.document } }
          : { ok: false, error: { code: 'invalid-input', message: `The feed could not be read: ${read.problem}` } }
      },
      'library.read': () => ({ ok: true, output: { library: library.read() } }),
      'schedule.read': () => ({ ok: true, output: { schedule: schedule.read() } }),
      'schedule.pause': (input) => {
        const change = schedule.change(input.job, { paused: input.paused })
        return change.ok ? { ok: true, output: { schedule: schedule.read() } } : { ok: false, error: { code: 'invalid-input', message: change.problem } }
      },
      'schedule.change': (input) => {
        const { job, timing: asked, ...words } = input
        const refused = (message: string) => ({ ok: false as const, error: { code: 'invalid-input' as const, message } })
        // A folder, or an account, is checked when a job on files or mail is set, which this does not do.
        const watching = (kind: string | undefined) => kind === 'files' || kind === 'mail'
        if (asked !== undefined && (watching(asked.kind) || watching(schedule.get(job)?.timing.kind)))
          return refused('A job that rings on files or mail is changed by asking, so its folder or its account is checked.')
        const timing = asked === undefined ? undefined : readTiming(asked, now().getTime(), zone())
        if (timing && !timing.ok) return refused(timing.problem)
        const changed = schedule.change(job, { ...words, ...(timing?.ok ? { timing: timing.timing } : {}) })
        return changed.ok ? { ok: true, output: { schedule: schedule.read() } } : refused(changed.problem)
      },
      'schedule.snooze': (input) => {
        const snoozed = schedule.snooze(input.job, input.minutes)
        return snoozed.ok ? { ok: true, output: { schedule: schedule.read() } } : { ok: false, error: { code: 'invalid-input', message: snoozed.problem } }
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
        const shown = library.show(input.widget, { thread: undefined, turn: undefined, focused: true })
        return shown.ok ? { ok: true, output: {} } : { ok: false, error: { code: 'unknown-widget', message: shown.text } }
      },
      'thread.focus': (input) =>
        channel.focus(input.thread)
          ? { ok: true, output: {} }
          : { ok: false, error: { code: 'invalid-input', message: `There is no thread "${input.thread}".` } },
      'project.open': async (input) => {
        if (toolServer === undefined || !computer)
          return { ok: false, error: { code: 'failed', message: 'Projects cannot be worked on here: the assistant has no computer to work on.' } }
        // The person chose the folder in the interface: that is their consent, and no card asks them again.
        const granted = await access.grant(
          { path: input.folder, write: true, purpose: 'work', chosen: true },
          { thread: undefined, turn: undefined, focused: true }
        )
        if (!granted.ok) return { ok: false, error: { code: 'invalid-input', message: granted.text } }
        return { ok: true, output: channel.work({ folder: granted.path, request: input.request }) }
      },
      'thread.read': (input) => {
        const read = channel.thread(input.thread, input.before)
        return read ? { ok: true, output: read } : { ok: false, error: { code: 'invalid-input', message: `There is no thread "${input.thread}".` } }
      },
      'thread.step': (input) => {
        const step = channel.step(input.thread, input.call)
        return step
          ? { ok: true, output: { step } }
          : { ok: false, error: { code: 'invalid-input', message: `Thread "${input.thread}" made no call "${input.call}".` } }
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
      'access.read': () => ({ ok: true, output: access.standingRules() }),
      'access.forget': (input) =>
        access.forget(input.allowance)
          ? { ok: true, output: access.standingRules() }
          : { ok: false, error: { code: 'invalid-input', message: `Nothing "${input.allowance}" is allowed for the session.` } },
      'activity.read': (input) => ({ ok: true, output: access.activity(input.limit, input.before) }),
      'activity.check': () => ({ ok: true, output: access.check() }),
      'activity.export': () => ({ ok: true, output: access.exportActivity() }),
      'activity.undo': async (input) => {
        const undone = await access.undo(input.use, input.anyway)
        return { ok: true, output: undone.use ? { outcome: undone.outcome, use: undone.use } : { outcome: undone.outcome } }
      },
      'activity.diff': async (input) => {
        const files = await access.diff(input)
        return files ? { ok: true, output: { files } } : { ok: false, error: { code: 'invalid-input', message: 'There is no such use in the activity.' } }
      },
      'activity.changes': async (input) => ({ ok: true, output: { turns: await access.changes(input.turns) } }),
      'activity.versions': (input) => ({ ok: true, output: { versions: access.versions(input.path) } }),
      'activity.restore': async (input) => {
        const outcome = await access.restore(input.use, input.path, input.side)
        // Put back in the assistant's folder, the Files page shows it at once.
        if (outcome === 'done') workspaceChanged([workspace?.pathOf(input.path)].flatMap((path) => path ?? []))
        return { ok: true, output: { outcome, versions: access.versions(input.path) } }
      },
      'everything.stop': () => {
        access.stopEverything()
        return { ok: true, output: {} }
      },
      'languages.set': (input) => ({ ok: true, output: { settings: settings.setLanguages(input) } }),
      'interruptions.set': (input) => ({ ok: true, output: { settings: settings.setInterruptions(input) } }),
      'vocabulary.set': (input) => ({ ok: true, output: { settings: settings.setVocabulary(input.words) } }),
      'browser.read': async () => ({ ok: true, output: { browser: await browser.state() } }),
      'desktop.read': async () => ({ ok: true, output: { desktop: await desktop.state() } }),
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
      'engines.effort.set': async (input) => {
        const harness = (await engines.read()).harnesses.find((known) => known.id === input.harness)
        if (!harness) return { ok: false, error: { code: 'unknown-harness', message: `There is no harness "${input.harness}".` } }
        const model = harness.models.find((one) => one.id === harness.model)
        if (input.effort !== null && !(model?.efforts ?? []).some((effort) => effort.id === input.effort)) {
          return { ok: false, error: { code: 'unknown-effort', message: `${model?.name ?? harness.name} does not offer the level "${input.effort}".` } }
        }
        // The model's default is kept as no choice at all, so it follows the default of whichever model answers.
        const effort = input.effort === model?.defaultEffort ? null : input.effort
        return { ok: true, output: { settings: settings.chooseEffort(input.harness, effort) } }
      },
      'accounts.read': async () => ({ ok: true, output: { accounts: await accounts.read() } }),
      'accounts.connect': async (input) => {
        const connected = await accounts.connect(input)
        return connected.ok ? { ok: true, output: { accounts: connected.view, account: connected.account } } : connected
      },
      'accounts.cancel': async () => {
        accounts.cancel()
        return { ok: true, output: { accounts: await accounts.read() } }
      },
      'accounts.disconnect': async (input) => {
        const change = await accounts.disconnect(input.account)
        return change.ok ? { ok: true, output: { accounts: change.view } } : change
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
    admit(message) {
      const admission = admit(message, { coreVersion: options.version, acceptsCredential: options.acceptsCredential })
      if (admission.admitted) for (const capability of admission.hello.capabilities) declared.add(capability)
      return admission
    },
    execute(message) {
      // A client that sends commands is there to hear what rings: from then on, reminders and tasks ring, and the work
      // the last run of the app left is taken up again.
      schedule.listen()
      if (!resumed) {
        resumed = true
        channel.resume()
      }
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
      folderWatch?.close()
      schedule.close()
      channel.close()
      memory.close()
      engines.close()
      void browser.close()
      void desktop.close()
    }
  }
}

/** A moment as the person's clock reads it, for the name of a file: "2026-11-18 23.52.10". */
function pictureStamp(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((one) => one.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}.${part('minute')}.${part('second')}`
}
