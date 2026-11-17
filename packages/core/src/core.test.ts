import { COMMANDS, type CommandInput, type CommandName, type CommandOutput, type Event, PROTOCOL_VERSION } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createCore } from './core.ts'
import type { OneShot } from './ports/harness.ts'
import { memoryRecords } from './records/memory.ts'
import { scriptedHarness } from './replay/scripted-harness.ts'

function start(records = memoryRecords(), harness = scriptedHarness()) {
  let ids = 0
  const core = createCore({
    version: '1.2.3',
    acceptsCredential: (credential) => credential === 'right',
    records,
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

    expect(harness.sessions[0]?.sent).toEqual(['What time is it?'])
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

describe('the screen through the core', () => {
  it('gives sessions the screen tools once a tool server is running, and shows what they compose', async () => {
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
    const session = harness.sessions[1]
    const token = session?.request.tools?.token ?? ''
    expect(session?.request.tools?.url).toBe('http://127.0.0.1:5000/mcp')
    expect(session?.request.instructions).toContain('ui_render')
    expect(core.toolHost.list(token)?.map((tool) => tool.name)).toEqual(['ui_render', 'ui_clear', 'memory_search', 'memory_remember', 'memory_forget'])
    expect(session?.request.instructions).toContain('memory_remember')

    const { EXAMPLE_VIEW } = await import('@repo/catalog')
    expect(await core.toolHost.call(token, 'ui_render', { title: 'The week', view: EXAMPLE_VIEW })).toEqual({ ok: true, text: 'Shown.' })
    const shown = events.find((event) => event.name === 'view.shown')
    expect(shown).toMatchObject({ view: { title: 'The week', turn: expect.any(String) } })
    expect((await run(core, 'view.read', {})).view?.title).toBe('The week')

    await run(core, 'view.clear', {})
    expect((await run(core, 'view.read', {})).view).toBeUndefined()
  })

  it('ends the right to call tools when the session is replaced', async () => {
    const { core, harness } = start()
    core.serveToolsAt('http://127.0.0.1:5000/mcp')
    await run(core, 'utterance.send', { text: 'One' })
    await settled()
    const token = harness.sessions[0]?.request.tools?.token ?? ''
    harness.sessions[0]?.emit({ type: 'failed', reason: 'Gone.' })

    expect(core.toolHost.list(token)).toBeUndefined()
  })
})

describe('the memory through the core', () => {
  const extraction = (request: OneShot) => {
    if (request.instructions.includes('pick out what is worth remembering')) {
      return JSON.stringify({ facts: [{ text: 'The user keeps bees on the roof.', kind: 'preference', turns: [1] }] })
    }
    return 'The user keeps bees on the roof of their building.'
  }

  it('learns while asleep, tells every client, and recalls it into a later turn', async () => {
    const harness = scriptedHarness({ complete: extraction })
    const { core } = start(memoryRecords(), harness)
    const events: Event[] = []
    core.onEvent((event) => events.push(event))

    await run(core, 'utterance.send', { text: 'I keep bees on the roof.' })
    await settled()
    harness.sessions[0]?.reply('Lovely.')
    await run(core, 'memory.sleep-now', {})
    await vi.waitFor(() => expect(events.some((event) => event.name === 'assistant.state' && event.state.asleep && event.state.lastSlept)).toBe(true))

    const { memory, state } = await run(core, 'memory.read', {})
    expect(state.asleep).toBe(true)
    const fact = memory.groups[0]?.facts[0]
    expect(memory.groups.map((group) => group.kind)).toEqual(['preference'])
    expect(fact).toMatchObject({ text: 'The user keeps bees on the roof.', origin: 'conversation', sources: [{ said: 'I keep bees on the roof.' }] })
    expect(memory.profile).toBe('The user keeps bees on the roof of their building.')
    expect(events.some((event) => event.name === 'memory.changed')).toBe(true)

    // Speaking wakes it, and what it learned comes with the question.
    await run(core, 'utterance.send', { text: 'How are the bees doing?' })
    await settled()
    expect(events.at(-2)).toMatchObject({ name: 'assistant.state', state: { asleep: false } })
    const session = harness.sessions.at(-1)
    expect(session?.sent.at(-1)).toContain('The user keeps bees on the roof.')
    expect(session?.sent.at(-1)).toMatch(/How are the bees doing\?$/)
    expect(session?.request.instructions).toContain('of their building')
  })

  it('remembers on request through its tool, then corrects and forgets the fact', async () => {
    const { core, harness } = start()
    core.serveToolsAt('http://127.0.0.1:5000/mcp')
    await run(core, 'utterance.send', { text: 'Remember that my locker code is 4512' })
    await settled()
    const token = harness.sessions[0]?.request.tools?.token ?? ''
    const turn = (await run(core, 'channel.read', { limit: 1 })).exchanges[0]?.turn

    expect(await core.toolHost.call(token, 'memory_remember', { text: "The user's locker code is 4512.", kind: 'other' })).toEqual({
      ok: true,
      text: "Remembered: The user's locker code is 4512."
    })
    const fact = (await run(core, 'memory.read', {})).memory.groups[0]?.facts[0]
    expect(fact).toMatchObject({ kind: 'other', origin: 'told', sources: [{ turn }] })

    const edited = await run(core, 'memory.edit', { fact: fact?.id ?? '', text: "The user's locker code is 4521.", kind: 'project' })
    expect(edited.memory.groups).toMatchObject([{ kind: 'project', facts: [{ id: fact?.id, text: "The user's locker code is 4521.", origin: 'edited' }] }])

    expect((await run(core, 'memory.forget', { fact: fact?.id ?? '' })).memory.groups).toEqual([])
    const again = await core.execute({ type: 'command', id: 'c2', name: 'memory.forget', input: { fact: fact?.id } })
    expect(again).toMatchObject({ ok: false, error: { code: 'unknown-fact' } })
  })

  it('keeps the sleep setting, and refuses to sleep when told never to', async () => {
    const records = memoryRecords()
    const { core } = start(records)
    const { memory } = await run(core, 'memory.sleep-settings.set', { when: 'never' })
    expect(memory.sleep).toEqual({ when: 'never', quietMinutes: 10, time: '03:00' })

    const refused = await core.execute({ type: 'command', id: 'c3', name: 'memory.sleep-now', input: {} })
    expect(refused).toMatchObject({ ok: false, error: { code: 'sleep-off' } })
    expect((await run(start(records).core, 'memory.read', {})).memory.sleep.when).toBe('never')
  })
})
