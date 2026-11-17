import { COMMANDS, type CommandInput, type CommandName, type CommandOutput, type Event, PROTOCOL_VERSION } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createCore } from './core.ts'
import { memoryRecords } from './records/memory.ts'
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

    const { settings } = await run(core, 'personas.set', { names: [{ persona: second.id, name: 'Marvin' }], active: second.id })

    expect(settings.personas).toMatchObject({ active: second.id, confirmed: true })
    expect(settings.personas.available.map((persona) => persona.name)).toEqual([first.name, 'Marvin'])
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
    const { settings: left } = await run(before, 'personas.set', { names: [{ persona: asked.personas.active, name: 'Alan' }], active: asked.personas.active })

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
      harnesses: [{ id: 'scripted', name: 'Scripted', installed: true, signedIn: true, version: '1.0.0' }],
      active: 'scripted'
    })
    const events: Event[] = []
    core.onEvent((event) => events.push(event))

    harness.stand({ installed: true, signedIn: false })
    const { engines } = await run(core, 'engines.read', {})

    expect(engines.active).toBeUndefined()
    expect(events).toEqual([{ type: 'event', name: 'engines.changed', engines }])
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
    expect(core.toolHost.list(routing)?.map((tool) => tool.name)).toEqual(['thread_open', 'thread_send', 'thread_focus'])

    await core.toolHost.call(routing, 'thread_open', { title: 'The week' })
    orchestrator?.emit({ type: 'turn-end' })
    await settled()
    const thread = harness.sessions[2]
    const token = thread?.request.tools?.token ?? ''
    expect(thread?.request.instructions).toContain('ui_render')
    expect(core.toolHost.list(token)?.map((tool) => tool.name)).toEqual(['ui_render', 'ui_clear', 'file_write', 'file_read'])

    const { EXAMPLE_VIEW } = await import('@repo/catalog')
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
