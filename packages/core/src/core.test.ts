import { COMMANDS, type CommandInput, type CommandName, type CommandOutput, type Event, encodeBase64, PROTOCOL_VERSION } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createCore } from './core.ts'
import { memoryRecords } from './records/memory.ts'
import { manualTimers } from './replay/manual-timers.ts'
import { memoryWorkspace } from './replay/memory-workspace.ts'
import { scriptedHarness } from './replay/scripted-harness.ts'

function start(records = memoryRecords(), harness = scriptedHarness()) {
  let ids = 0
  const core = createCore({
    version: '1.2.3',
    acceptsCredential: (credential) => credential === 'right',
    records,
    blobs: { put: () => 'hash', get: () => undefined },
    log: { error: vi.fn() },
    harnesses: [harness],
    newId: () => `id-${++ids}`,
    now: () => new Date('2026-11-17T08:00:00Z')
  })
  return { core, harness }
}

/** Run a command and read its output the way a client does. */
async function run<Name extends CommandName>(core: ReturnType<typeof start>['core'], name: Name, input: CommandInput<Name>): Promise<CommandOutput<Name>> {
  const result = await core.execute({ type: 'command', id: 'c1', name, input })
  if (!result?.ok) throw new Error(`"${name}" was refused: ${JSON.stringify(result)}`)
  return COMMANDS[name].output.parse(result.output) as CommandOutput<Name>
}

/** Lets what the core started without waiting for it come to its end. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

describe('a core', () => {
  it('admits a client that presents the right credential', () => {
    const hello = { type: 'hello', protocol: PROTOCOL_VERSION, client: { kind: 'desktop', version: '1', device: 'd' }, capabilities: [], credential: 'right' }
    expect(start().core.admit(hello)).toMatchObject({ admitted: true, reply: { type: 'welcome', core: { version: '1.2.3' } } })
    expect(start().core.admit({ ...hello, credential: 'wrong' })).toMatchObject({ admitted: false, reply: { reason: 'credential' } })
  })

  it('starts a new user with personas to confirm', async () => {
    const { settings } = await run(start().core, 'settings.read', {})
    expect(settings.revision).toBe(0)
    expect(settings.personas.confirmed).toBe(false)
    expect(settings.personas.active).toBe(settings.personas.available[0]?.id)
  })

  it('tells every listener when the personas are set, with the settings the command returned', async () => {
    const { core } = start()
    const events: Event[] = []
    core.onEvent((event) => events.push(event))
    const [first, second] = (await run(core, 'settings.read', {})).settings.personas.available
    if (!first || !second) throw new Error('This test needs two personas.')

    const { settings } = await run(core, 'personas.set', { names: [{ persona: second.id, name: 'MARVIN' }], active: second.id })

    expect(settings.personas).toMatchObject({ active: second.id, confirmed: true })
    expect(settings.personas.available.map((persona) => persona.name)).toEqual([first.name, 'MARVIN'])
    expect(events).toEqual([{ type: 'event', name: 'settings.changed', settings }])
  })

  it('stops telling a listener that asked to stop', async () => {
    const { core } = start()
    const heard = vi.fn()
    core.onEvent(heard)()
    const { settings } = await run(core, 'settings.read', {})

    await run(core, 'personas.set', { names: [], active: settings.personas.active })

    expect(heard).not.toHaveBeenCalled()
  })

  it('finds the settings again when it restarts on the same records', async () => {
    const records = memoryRecords()
    const before = start(records).core
    const { settings: asked } = await run(before, 'settings.read', {})
    const { settings: left } = await run(before, 'personas.set', { names: [{ persona: asked.personas.active, name: 'ALAN' }], active: asked.personas.active })

    expect((await run(start(records).core, 'settings.read', {})).settings).toEqual(left)
  })
})

describe('a conversation through the core', () => {
  it('answers what is said, sentence by sentence, and keeps it in the transcript', async () => {
    const { core, harness } = start()
    const events: Event[] = []
    core.onEvent((event) => events.push(event))

    const { turn } = await run(core, 'utterance.send', { text: '  What time is it?  ' })
    await settled()
    harness.sessions[0]?.reply('It is eight. ', 'In the morning.')

    expect(harness.sessions[0]?.sent[0]).toMatch(/^\(Now: .+\)\nWhat time is it\?$/)
    expect(events.map((event) => event.name)).toEqual(['turn.started', 'speech.say', 'speech.say', 'turn.ended'])
    expect(events.filter((event) => event.name === 'speech.say').map((event) => event.text)).toEqual(['It is eight.', 'In the morning.'])
    const { exchanges } = await run(core, 'channel.read', {})
    expect(exchanges).toEqual([
      {
        turn,
        at: '2026-11-17T08:00:00.000Z',
        persona: exchanges[0]?.persona,
        said: 'What time is it?',
        replied: 'It is eight. In the morning.',
        outcome: 'done'
      }
    ])
  })

  it('finds the transcript again when it restarts on the same records', async () => {
    const records = memoryRecords()
    const before = start(records)
    await run(before.core, 'utterance.send', { text: 'Remember the risotto.' })
    await settled()
    before.harness.sessions[0]?.reply('I will.')

    const after = start(records)
    expect((await run(after.core, 'channel.read', {})).exchanges.map((line) => [line.said, line.replied])).toEqual([['Remember the risotto.', 'I will.']])

    await run(after.core, 'utterance.send', { text: 'What did I ask?' })
    await settled()
    expect(after.harness.sessions[0]?.request.instructions).toContain('Remember the risotto.')
  })

  it('says which harnesses can be used, and looks again each time it is asked', async () => {
    const { core, harness } = start()
    expect((await run(core, 'engines.read', {})).engines).toEqual({
      harnesses: [
        {
          id: 'scripted',
          name: 'Scripted',
          installed: true,
          signedIn: true,
          version: '1.0.0',
          models: [expect.objectContaining({ id: 'quick' }), expect.objectContaining({ id: 'deep' })],
          defaultModel: 'quick',
          model: 'quick'
        }
      ],
      active: 'scripted'
    })
    const events: Event[] = []
    core.onEvent((event) => events.push(event))

    harness.stand({ installed: true, signedIn: false })
    const { engines } = await run(core, 'engines.read', {})

    expect(engines.active).toBeUndefined()
    expect(events).toEqual([{ type: 'event', name: 'engines.changed', engines }])
  })

  it('answers with the model the user chose, from the next conversation on, and tells the clients at once', async () => {
    const records = memoryRecords()
    const { core } = start(records)
    const events: Event[] = []
    core.onEvent((event) => events.push(event))

    const { settings } = await run(core, 'engines.model.set', { harness: 'scripted', model: 'deep' })
    await settled()

    expect(settings.engines.models).toEqual({ scripted: 'deep' })
    expect(events.map((event) => event.name)).toEqual(['settings.changed', 'engines.changed'])
    expect(events[1]).toMatchObject({ engines: { harnesses: [{ model: 'deep', defaultModel: 'quick' }] } })

    const after = start(records)
    await run(after.core, 'utterance.send', { text: 'Hello.' })
    await settled()
    expect(after.harness.sessions[0]?.request).toMatchObject({ role: 'thread', model: 'deep' })
  })

  it('keeps the default model as no choice, and refuses a model or a harness that does not exist', async () => {
    const { core } = start()
    await run(core, 'engines.model.set', { harness: 'scripted', model: 'deep' })
    expect((await run(core, 'engines.model.set', { harness: 'scripted', model: 'quick' })).settings.engines.models).toEqual({})

    const refused = (name: 'engines.model.set' | 'engines.prefer', input: object) => core.execute({ type: 'command', id: 'c1', name, input })
    expect(await refused('engines.model.set', { harness: 'scripted', model: 'gigantic' })).toMatchObject({ ok: false, error: { code: 'unknown-model' } })
    expect(await refused('engines.model.set', { harness: 'nobody', model: 'deep' })).toMatchObject({ ok: false, error: { code: 'unknown-harness' } })
    expect(await refused('engines.prefer', { harness: 'nobody' })).toMatchObject({ ok: false, error: { code: 'unknown-harness' } })
    expect((await run(core, 'engines.prefer', { harness: 'scripted' })).settings.engines.preferred).toBe('scripted')
  })

  it('reasons at the level the user chose for the model in use, keeps its default as no choice, and refuses another', async () => {
    const records = memoryRecords()
    const { core } = start(records)
    const refused = (input: object) => core.execute({ type: 'command', id: 'c1', name: 'engines.effort.set', input })

    // The default model offers no level to choose.
    expect(await refused({ harness: 'scripted', effort: 'hard' })).toMatchObject({ ok: false, error: { code: 'unknown-effort' } })
    await run(core, 'engines.model.set', { harness: 'scripted', model: 'deep' })
    expect((await run(core, 'engines.effort.set', { harness: 'scripted', effort: 'hard' })).settings.engines.efforts).toEqual({ scripted: 'hard' })
    expect(await refused({ harness: 'scripted', effort: 'gigantic' })).toMatchObject({ ok: false, error: { code: 'unknown-effort' } })
    expect(await refused({ harness: 'nobody', effort: 'hard' })).toMatchObject({ ok: false, error: { code: 'unknown-harness' } })

    const after = start(records)
    await run(after.core, 'utterance.send', { text: 'Hello.' })
    await settled()
    expect(after.harness.sessions[0]?.request).toMatchObject({ role: 'thread', model: 'deep', effort: 'hard' })

    expect((await run(core, 'engines.effort.set', { harness: 'scripted', effort: 'light' })).settings.engines.efforts).toEqual({})
  })

  it("opens a harness's sign-in, and refuses one it does not have", async () => {
    const { core, harness } = start()
    await run(core, 'engines.sign-in', { harness: 'scripted' })
    expect(harness.signIns).toBe(1)
    expect(await core.execute({ type: 'command', id: 'c1', name: 'engines.sign-in', input: { harness: 'nobody' } })).toMatchObject({
      ok: false,
      error: { code: 'unknown-harness' }
    })
  })
})

describe('threads and the screen through the core', () => {
  it('routes through the orchestrator once a tool server runs, and shows what a thread composes', async () => {
    const { core, harness } = start()
    const events: Event[] = []
    core.onEvent((event) => events.push(event))

    await run(core, 'utterance.send', { text: 'Before the server' })
    await settled()
    expect(harness.sessions[0]?.request.tools).toBeUndefined()
    harness.sessions[0]?.reply('Fine.')

    core.serveToolsAt('http://127.0.0.1:5000/mcp')
    await run(core, 'utterance.send', { text: 'Show me the week' })
    await settled()
    const orchestrator = harness.sessions[1]
    expect(orchestrator?.request.role).toBe('orchestrator')
    const routing = orchestrator?.request.tools?.token ?? ''
    // It passes turns on, and sets reminders itself, which need no screen.
    expect(core.toolHost.list(routing)?.map((tool) => tool.name)).toEqual([
      'thread_open',
      'thread_send',
      'thread_focus',
      'schedule_create',
      'schedule_list',
      'schedule_update',
      'schedule_cancel'
    ])

    await core.toolHost.call(routing, 'thread_open', { title: 'The week' })
    orchestrator?.emit({ type: 'turn-end' })
    await settled()
    const thread = harness.sessions[2]
    const token = thread?.request.tools?.token ?? ''
    expect(thread?.request.instructions).toContain('ui_render')
    expect(core.toolHost.list(token)?.map((tool) => tool.name)).toEqual([
      'ui_render',
      'ui_clear',
      'media_control',
      'file_write',
      'file_read',
      'memory_search',
      'memory_remember',
      'memory_forget',
      'library_search',
      'library_show',
      'library_save',
      'library_update',
      'library_delete',
      'schedule_create',
      'schedule_list',
      'schedule_update',
      'schedule_cancel',
      'answer_write'
    ])

    const { EXAMPLE_VIEW } = await import('@repo/catalog')
    thread?.emit({ type: 'text', text: 'Here is your week. ' })
    expect(await core.toolHost.call(token, 'ui_render', { title: 'The week', view: EXAMPLE_VIEW })).toEqual({ ok: true, text: 'Shown.' })
    expect(events.find((event) => event.name === 'view.shown')).toMatchObject({ view: { title: 'The week', slot: 'stage', thread: expect.any(String) } })
    expect((await run(core, 'view.read', {})).view?.title).toBe('The week')
    expect((await run(core, 'threads.read', {})).threads.map((one) => one.title)).toEqual(['The week'])

    await run(core, 'view.clear', {})
    expect((await run(core, 'view.read', {})).view).toBeUndefined()
  })

  it('ends the right to call tools when a session fails', async () => {
    const { core, harness } = start()
    core.serveToolsAt('http://127.0.0.1:5000/mcp')
    await run(core, 'utterance.send', { text: 'One' })
    await settled()
    const token = harness.sessions[0]?.request.tools?.token ?? ''
    harness.sessions[0]?.emit({ type: 'failed', reason: 'Gone.' })

    expect(core.toolHost.list(token)).toBeUndefined()
  })
})

describe('the library through the core', () => {
  /** Start a core with a tool server, say something, and open a thread for it: its session and tool token. */
  async function threadOf(core: ReturnType<typeof start>['core'], harness: ReturnType<typeof start>['harness'], said: string) {
    core.serveToolsAt('http://127.0.0.1:5000/mcp')
    await run(core, 'utterance.send', { text: said })
    await settled()
    const orchestrator = harness.sessions.at(-1)
    await core.toolHost.call(orchestrator?.request.tools?.token ?? '', 'thread_open', { title: said })
    orchestrator?.emit({ type: 'turn-end' })
    await settled()
    const thread = harness.sessions.at(-1)
    // A thread says its short answer before it shows anything.
    thread?.emit({ type: 'text', text: 'Here it is. ' })
    return { orchestrator, thread, token: thread?.request.tools?.token ?? '' }
  }

  const radio = {
    root: 'all',
    elements: {
      all: { type: 'Stack', props: {}, children: ['player'] },
      player: { type: 'Media', props: { url: 'https://streams.example.org/jazz.aac', title: 'Jazz station', live: true } }
    }
  }

  it('brings a saved widget back as it was saved, in a later session, when asked for in other words', async () => {
    const records = memoryRecords()
    const first = start(records)
    const { token } = await threadOf(first.core, first.harness, 'Play some jazz')
    await first.core.toolHost.call(token, 'ui_render', { title: 'Jazz radio', view: radio })
    const shown = (await run(first.core, 'view.read', {})).view
    if (!shown) throw new Error('The view was not shown.')
    const { widget } = await run(first.core, 'library.save', { view: shown.id, collection: 'Music' })
    expect(widget).toMatchObject({ title: 'Jazz radio', collection: 'Music', pinned: false, from: shown.id, spec: shown.spec })

    // A new core on the same records: every session is new, and is told what the library holds.
    const later = start(records)
    const events: Event[] = []
    later.core.onEvent((event) => events.push(event))
    const { orchestrator, thread, token: again } = await threadOf(later.core, later.harness, 'I want to listen to that station again')
    expect(orchestrator?.request.instructions).toContain(`[${widget.id}] "Jazz radio" in Music: plays "Jazz station" (live)`)
    expect(thread?.request.instructions).toContain('show it with library_show rather than composing a new view')

    const found = await later.core.toolHost.call(again, 'library_search', { query: 'listen to the jazz again' })
    expect(found.text).toContain(`[${widget.id}] "Jazz radio" in Music`)
    expect(await later.core.toolHost.call(again, 'library_show', { widget: widget.id })).toEqual({ ok: true, text: 'Shown.' })
    const back = events.find((event) => event.name === 'view.shown')
    expect(back).toMatchObject({ view: { title: 'Jazz radio', widget: widget.id, slot: 'stage', spec: shown.spec } })
  })

  it('saves what a thread shows when the person asks, and pins it, files it and deletes it on request', async () => {
    const { core, harness } = start()
    const events: Event[] = []
    core.onEvent((event) => events.push(event))
    const { token } = await threadOf(core, harness, 'Play some jazz')
    expect((await core.toolHost.call(token, 'library_save', {})).ok).toBe(false)
    await core.toolHost.call(token, 'ui_render', { title: 'Jazz radio', view: radio })

    const saved = await core.toolHost.call(token, 'library_save', { title: 'My jazz' })
    const id = /\[(.+)\]/.exec(saved.text)?.[1] ?? ''
    expect(saved.text).toBe(`Saved as "My jazz" [${id}].`)
    await core.toolHost.call(token, 'library_update', { widget: id, pinned: true, collection: 'Music' })
    expect((await run(core, 'library.read', {})).library.widgets).toMatchObject([{ id, title: 'My jazz', pinned: true, collection: 'Music' }])
    expect(events.filter((event) => event.name === 'library.changed')).toHaveLength(2)

    // A change of content is saved as a new version and shown at once, as the person asked for it to see it.
    const annotated = {
      ...radio,
      elements: { ...radio.elements, all: { type: 'Stack', props: {}, children: ['player', 'note'] }, note: { type: 'Text', props: { text: 'From Paris' } } }
    }
    expect(await core.toolHost.call(token, 'library_update', { widget: id, view: annotated })).toEqual({ ok: true, text: 'Saved as a new version, and shown.' })
    const changed = (await run(core, 'view.read', {})).view
    expect(changed).toMatchObject({ widget: id, spec: { elements: { note: { type: 'Text' } } } })
    expect(changed?.turn).toBeUndefined()
    expect((await core.toolHost.call(token, 'library_update', { widget: id, view: { root: 'x', elements: {} } })).ok).toBe(false)

    await core.toolHost.call(token, 'library_delete', { widget: id })
    expect((await run(core, 'library.read', {})).library.widgets).toEqual([])
  })

  it('shows a saved widget on the stage when the user brings it back from the library', async () => {
    const { core, harness } = start()
    const { token } = await threadOf(core, harness, 'Play some jazz')
    await core.toolHost.call(token, 'ui_render', { title: 'Jazz radio', view: radio })
    const { widget } = await run(core, 'library.save', { view: (await run(core, 'view.read', {})).view?.id ?? '' })
    await run(core, 'view.clear', {})

    await run(core, 'library.show', { widget: widget.id })
    expect((await run(core, 'view.read', {})).view).toMatchObject({ widget: widget.id, title: 'Jazz radio' })
    expect((await core.execute({ type: 'command', id: 'c2', name: 'library.show', input: { widget: 'nothing' } }))?.ok).toBe(false)
  })
})

describe('reminders through the core', () => {
  /** A core whose clock and timers are moved by hand, starting on Tuesday 17 November 2026, 9:00 in Paris. */
  function timed(records = memoryRecords(), harness = scriptedHarness(), from = 0) {
    const timers = manualTimers()
    let ids = 0
    const core = createCore({
      version: '1.2.3',
      acceptsCredential: () => true,
      records,
      blobs: { put: () => 'hash', get: () => undefined },
      log: { error: vi.fn() },
      harnesses: [harness],
      newId: () => `id-${from}-${++ids}`,
      now: () => new Date(Date.parse('2026-11-17T08:00:00Z') + from + timers.elapsed()),
      timeZone: () => 'Europe/Paris',
      timers
    })
    const events: Event[] = []
    core.onEvent((event) => events.push(event))
    core.serveToolsAt('http://127.0.0.1:5000/mcp')
    return { core, harness, timers, events }
  }

  it('sets a reminder the orchestrator heard, and says it at its time after a restart, with a notification', async () => {
    const records = memoryRecords()
    const first = timed(records)
    await run(first.core, 'utterance.send', { text: 'Remind me in two minutes to stretch' })
    await settled()
    const orchestrator = first.harness.sessions[0]
    expect(orchestrator?.request.instructions).toContain('do not pass them to a thread')
    const set = await first.core.toolHost.call(orchestrator?.request.tools?.token ?? '', 'schedule_create', {
      kind: 'reminder',
      title: 'Stretch',
      sentence: 'Time to stretch.',
      timing: { kind: 'once', inMinutes: 2 }
    })
    expect(set.text).toContain('today at 09:02')
    orchestrator?.reply('Okay, 9:02: stretch.')
    expect((await run(first.core, 'schedule.read', {})).schedule.jobs).toMatchObject([{ title: 'Stretch', next: '2026-11-17T08:02:00.000Z' }])
    first.core.close()

    // The app is restarted a minute later, and its window opens: the reminder rings at its time.
    const second = timed(records, scriptedHarness(), 60_000)
    await run(second.core, 'schedule.read', {})
    second.timers.advance(59_000)
    expect(second.events.filter((event) => event.name === 'speech.say')).toEqual([])
    second.timers.advance(1_000)
    const said = second.events.filter((event) => event.name === 'speech.say' || event.name === 'device.notify')
    expect(said).toMatchObject([
      { name: 'device.notify', notification: { title: 'Stretch', body: 'Time to stretch.', silent: false, unlessFocused: false } },
      { name: 'speech.say', text: 'Time to stretch.' }
    ])
    expect(second.events.some((event) => event.name === 'view.shown' && event.view.title === 'Reminder')).toBe(true)
    expect(second.harness.sessions).toHaveLength(0)
  })

  it('pauses everything and resumes on command, and keeps the quiet hours', async () => {
    const { core } = timed()
    expect((await run(core, 'schedule.hold', { held: true })).schedule.held).toBe(true)
    expect((await run(core, 'schedule.quiet.set', { from: '22:30' })).schedule.quiet).toEqual({ on: true, from: '22:30', until: '07:30' })
    expect((await run(core, 'schedule.hold', { held: false })).schedule.held).toBe(false)
  })
})

describe('files between the person and the assistant', () => {
  function withFolder() {
    let ids = 0
    const workspace = memoryWorkspace()
    const harness = scriptedHarness({ images: true })
    const core = createCore({
      version: '1',
      acceptsCredential: () => true,
      records: memoryRecords(),
      blobs: { put: () => 'hash', get: () => undefined },
      log: { error: vi.fn() },
      harnesses: [harness],
      newId: () => `id-${++ids}`,
      now: () => new Date('2026-11-17T08:00:00Z'),
      workspace,
      computer: {
        workspace: workspace.location,
        locate: async (path) => (path.startsWith('/home/ada/') ? { path, kind: 'folder' } : undefined),
        protected: [{ label: 'SSH keys', path: '/home/ada/.ssh' }],
        read: async () => undefined,
        write: async () => undefined,
        fingerprint: async () => undefined,
        trash: async (path) => path
      }
    })
    const events: Event[] = []
    core.onEvent((event) => events.push(event))
    return { core, harness, workspace, events }
  }

  it('keeps a file handed over in pieces, sends it with what is said, and lets the person browse and read it', async () => {
    const { core, harness, events } = withFolder()
    const { attachment } = await run(core, 'attachment.open', { name: 'photo.png', type: 'image/png', size: 6 })
    await run(core, 'attachment.write', { attachment, data: encodeBase64(new Uint8Array([1, 2, 3])) })
    await run(core, 'attachment.write', { attachment, data: encodeBase64(new Uint8Array([4, 5, 6])) })
    const kept = await run(core, 'attachment.close', { attachment })
    expect(kept.attachment).toMatchObject({ name: 'photo.png', path: 'inbox/2026-11-17/photo.png', image: true, size: 6 })
    expect(events).toContainEqual({ type: 'event', name: 'workspace.changed', paths: ['inbox/2026-11-17/photo.png'] })

    await run(core, 'utterance.send', { text: 'What is this?', attachments: [attachment] })
    await settled()
    // With no tool server, one session answers everything, and is given the file itself.
    expect(harness.sessions[0]?.sent[0]).toContain('- photo.png (image/png, 6 bytes), at /home/ada/workspace/inbox/2026-11-17/photo.png: shown to you')
    expect(harness.sessions[0]?.attached[0]).toEqual([
      { path: '/home/ada/workspace/inbox/2026-11-17/photo.png', name: 'photo.png', mediaType: 'image/png', image: true }
    ])
    // Gone with that turn: it cannot be sent twice.
    const again = await core.execute({ type: 'command', id: 'c2', name: 'utterance.send', input: { text: 'And this?', attachments: [attachment] } })
    expect(again).toMatchObject({ ok: false, error: { code: 'invalid-input' } })

    const top = await run(core, 'workspace.list', { path: '' })
    expect(top.entries.map((entry) => entry.path)).toEqual(['inbox'])
    const read = await run(core, 'workspace.read', { path: 'inbox/2026-11-17/photo.png' })
    expect(read).toMatchObject({ data: encodeBase64(new Uint8Array([1, 2, 3, 4, 5, 6])), size: 6 })
  })

  it('takes a file back when the person removes it before saying anything', async () => {
    const { core, workspace } = withFolder()
    const { attachment } = await run(core, 'attachment.open', { name: 'a.txt', size: 1 })
    await run(core, 'attachment.write', { attachment, data: encodeBase64(new Uint8Array([65])) })
    await run(core, 'attachment.close', { attachment })
    await run(core, 'attachment.discard', { attachment })
    expect(workspace.files.size).toBe(0)
  })

  it('grants a folder handed over, read only, and says so in the turn', async () => {
    const { core, harness } = withFolder()
    await run(core, 'utterance.send', { text: '', folders: ['/home/ada/Projects'] })
    await settled()
    const { settings } = await run(core, 'settings.read', {})
    expect(settings.access.places).toEqual([{ path: '/home/ada/Projects', kind: 'folder', write: false }])
    expect(harness.sessions[0]?.sent[0]).toContain('The folder /home/ada/Projects: yours to read from now on, read only.')
  })

  it('never grants a folder handed over inside a place never reached', async () => {
    const { core } = withFolder()
    await run(core, 'utterance.send', { text: 'Look at these', folders: ['/home/ada/.ssh/keys', '/home/ada/Projects'] })
    await settled()
    const { settings } = await run(core, 'settings.read', {})
    expect(settings.access.places).toEqual([{ path: '/home/ada/Projects', kind: 'folder', write: false }])
  })

  it('refuses something said with nothing in it', async () => {
    const { core } = withFolder()
    expect(await core.execute({ type: 'command', id: 'c1', name: 'utterance.send', input: { text: '  ' } })).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' }
    })
  })
})
