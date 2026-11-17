import { EXAMPLE_VIEW } from '@repo/catalog'
import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createEngineRoom } from '../engines/engines.ts'
import { memoryRecords } from '../records/memory.ts'
import { type ScriptedHarness, scriptedHarness } from '../replay/scripted-harness.ts'
import { createUserSettings } from '../settings/settings.ts'
import { createTools } from '../tools/tools.ts'
import { createScreen } from '../views/screen.ts'
import { type Abilities, createChannel, EXCHANGE } from './channel.ts'

interface Setup {
  harness?: ScriptedHarness
  records?: ReturnType<typeof memoryRecords>
  /** Whether a tool server runs: with none, one session answers everything. */
  server?: boolean
  /** More of what sessions can do: the computer. */
  more?: Partial<Abilities>
}

function setup({ harness = scriptedHarness(), records = memoryRecords(), server = true, more = {} }: Setup = {}) {
  let ids = 0
  const newId = () => `id-${++ids}`
  const settings = createUserSettings(records, [
    { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' },
    { id: 'second', name: 'Grace', stance: 'critical', accent: 'red' }
  ])
  const log = { error: vi.fn<(message: string) => void>() }
  const tools = createTools(newId)
  const screen = createScreen({ records, newId })
  const channel = createChannel({
    engines: createEngineRoom([harness]),
    settings,
    records,
    screen,
    log,
    now: () => new Date('2026-11-17T08:00:00Z'),
    newId,
    timeZone: 'Europe/Paris',
    abilities: {
      server: () => (server ? 'http://127.0.0.1:1/mcp' : undefined),
      grant: (granted) => tools.grant(granted),
      threadTools: (showing, stance) => [
        ...(stance === 'critical'
          ? [{ definition: { name: 'raise_concern', description: '', inputSchema: {} }, run: () => ({ ok: true, text: 'Shown.' }) }]
          : []),
        { definition: { name: 'ui_render', description: '', inputSchema: {} }, run: (input) => screen.show(input, showing()) }
      ],
      instructions: 'THE SCREEN',
      ...more
    }
  })
  const events: Event[] = []
  channel.onEvent((event) => events.push(event))
  screen.onEvent((event) => events.push(event))
  const spoken = () => events.flatMap((event) => (event.name === 'speech.say' ? [event.text] : []))
  const ended = () => events.flatMap((event): Exchange[] => (event.name === 'turn.ended' ? [event.exchange] : []))
  /** Call a tool the way the session holding `index`'s token would. */
  const call = (index: number, name: string, input: unknown) => tools.host.call(harness.sessions[index]?.request.tools?.token ?? '', name, input)
  return { channel, harness, settings, records, screen, log, events, spoken, ended, call }
}

/** Lets what the channel started without waiting for it come to its end. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()
}

describe('the orchestrator', () => {
  it('hears each turn with the list of threads, as the persona in use', async () => {
    const { channel, harness } = setup()
    channel.say('Hello')
    await settled()

    const orchestrator = harness.sessions[0]
    expect(orchestrator?.request.role).toBe('orchestrator')
    expect(orchestrator?.request.instructions).toContain('You are Ada.')
    expect(orchestrator?.request.instructions).toContain('thread_open')
    expect(orchestrator?.sent).toEqual([
      '(Now: Tuesday, 17 November 2026, 09:00 (Europe/Paris))\nThreads:\nThere are no threads yet.\n\nThe person says: Hello'
    ])
  })

  it('answers small things itself, sentence by sentence', async () => {
    const { channel, harness, spoken, ended } = setup()
    channel.say('Hello')
    await settled()
    harness.sessions[0]?.reply('Good morning. ', 'How can I help?')

    expect(spoken()).toEqual(['Good morning.', 'How can I help?'])
    expect(ended()).toMatchObject([{ said: 'Hello', replied: 'Good morning. How can I help?', outcome: 'done' }])
    expect(ended()[0]?.thread).toBeUndefined()
    expect(harness.sessions).toHaveLength(1)
  })
})

describe('threads', () => {
  it('opens a thread for a topic, which answers aloud and shows its view on the stage', async () => {
    const { channel, harness, spoken, ended, call, screen, events } = setup()
    channel.say('What should I cook tonight?')
    await settled()

    const opened = await call(0, 'thread_open', { title: 'Dinner tonight', kind: 'topic' })
    expect(opened.ok).toBe(true)
    harness.sessions[0]?.emit({ type: 'text', text: 'This is never said.' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()

    const thread = harness.sessions[1]
    expect(thread?.request.role).toBe('thread')
    expect(thread?.request.web).toBe(true)
    expect(harness.sessions[0]?.request.web).toBeUndefined()
    expect(thread?.request.instructions).toContain('"Dinner tonight"')
    expect(thread?.request.instructions).toContain('THE SCREEN')
    expect(thread?.sent).toEqual(['(Now: Tuesday, 17 November 2026, 09:00 (Europe/Paris))\nWhat should I cook tonight?'])

    expect((await call(1, 'ui_render', { title: 'Risotto', view: EXAMPLE_VIEW })).ok).toBe(true)
    thread?.reply('A risotto would work.')

    expect(spoken()).toEqual(['A risotto would work.'])
    expect(ended()).toMatchObject([{ outcome: 'done', replied: 'A risotto would work.' }])
    const threadId = ended()[0]?.thread
    expect(threadId).toBeDefined()
    expect(channel.threads()).toMatchObject({ focus: threadId, threads: [{ id: threadId, title: 'Dinner tonight', kind: 'topic', state: 'parked' }] })
    expect(screen.current()?.title).toBe('Risotto')
    expect(events.some((event) => event.name === 'threads.changed')).toBe(true)
  })

  it('sends a later turn to the same thread, which remembers', async () => {
    const { channel, harness, call } = setup()
    channel.say('What should I cook?')
    await settled()
    await call(0, 'thread_open', { title: 'Dinner' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    harness.sessions[1]?.reply('A risotto.')
    const thread = channel.threads().threads[0]?.id as string

    channel.say('Can I use white wine?')
    await settled()
    expect(harness.sessions[0]?.sent[1]).toContain(`${thread}: "Dinner" (topic, parked, on screen`)
    await call(0, 'thread_send', { thread })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()

    expect(harness.sessions).toHaveLength(2)
    expect(harness.sessions[1]?.sent.map((sent) => sent.split('\n')[1])).toEqual(['What should I cook?', 'Can I use white wine?'])
  })

  it('refuses a thread that does not exist, and lists those that do', async () => {
    const { channel, call } = setup()
    channel.say('Hello')
    await settled()
    const refused = await call(0, 'thread_send', { thread: 'nope' })
    expect(refused).toMatchObject({ ok: false })
    expect(refused.text).toContain('There is no such thread')
  })

  it('answers an aside in the margin, and leaves the topic on the stage', async () => {
    const { channel, harness, call, screen } = setup()
    channel.say('Plan my trip')
    await settled()
    await call(0, 'thread_open', { title: 'Trip' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    await call(1, 'ui_render', { title: 'Itinerary', view: EXAMPLE_VIEW })
    harness.sessions[1]?.reply('Here is a plan.')

    channel.say('By the way, what time is it in Montreal?')
    await settled()
    await call(0, 'thread_open', { title: 'Time in Montreal', kind: 'aside' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    expect(harness.sessions[2]?.request.instructions).toContain('side question')
    await call(2, 'ui_render', { title: 'Montreal', view: EXAMPLE_VIEW })
    harness.sessions[2]?.reply('It is two in the morning there.')

    expect(screen.current()?.title).toBe('Itinerary')
    expect(screen.margin().map((view) => view.title)).toEqual(['Montreal'])
    const trip = channel.threads().threads.find((thread) => thread.title === 'Trip')
    expect(channel.threads().focus).toBe(trip?.id)
  })

  it('brings back an earlier topic, with its view', async () => {
    const { channel, harness, call, screen, spoken } = setup()
    for (const [said, title] of [
      ['Recipe please', 'Recipe'],
      ['Help with my form', 'Form']
    ] as const) {
      channel.say(said)
      await settled()
      await call(0, 'thread_open', { title })
      harness.sessions[0]?.emit({ type: 'turn-end' })
      await settled()
      const session = harness.sessions.at(-1)
      await call(harness.sessions.length - 1, 'ui_render', { title, view: EXAMPLE_VIEW })
      session?.reply(`${title} done.`)
    }
    expect(screen.current()?.title).toBe('Form')

    channel.say('Back to the recipe')
    await settled()
    const recipe = channel.threads().threads.find((thread) => thread.title === 'Recipe')?.id
    expect((await call(0, 'thread_focus', { thread: recipe })).ok).toBe(true)
    harness.sessions[0]?.reply('The recipe is back.')

    expect(screen.current()?.title).toBe('Recipe')
    expect(channel.threads().focus).toBe(recipe)
    expect(spoken().at(-1)).toBe('The recipe is back.')
  })

  it('lets a thread finish in the background when the user moves on, and marks its answer ready', async () => {
    const { channel, harness, call, spoken, screen } = setup()
    channel.say('Find me a recipe')
    await settled()
    await call(0, 'thread_open', { title: 'Recipe' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    const recipe = harness.sessions[1]
    recipe?.emit({ type: 'text', text: 'Let me look. ' })

    channel.say('Hello there')
    await settled()
    harness.sessions[0]?.reply('Hello!')
    await call(1, 'ui_render', { title: 'Risotto', view: EXAMPLE_VIEW })
    recipe?.reply('A risotto would do.')

    expect(spoken()).toEqual(['Let me look.', 'Hello!'])
    const thread = channel.threads().threads.find((candidate) => candidate.title === 'Recipe')
    expect(thread?.state).toBe('ready')
    expect(channel.read(10).find((line) => line.said === 'Find me a recipe')).toMatchObject({ outcome: 'done', replied: 'Let me look. A risotto would do.' })

    expect(channel.focus(thread?.id as string)).toBe(true)
    expect(spoken().slice(2)).toEqual(['Let me look.', 'A risotto would do.'])
    expect(screen.current()?.title).toBe('Risotto')
    expect(channel.threads().threads.find((candidate) => candidate.id === thread?.id)?.state).toBe('parked')
  })
})

describe('stopping', () => {
  it('interrupts the orchestrator answering, says nothing more, and records the turn as stopped', async () => {
    const { channel, harness, spoken, ended } = setup()
    channel.say('Tell me a story')
    await settled()
    const orchestrator = harness.sessions[0]
    orchestrator?.emit({ type: 'text', text: 'Once upon a time. ' })

    channel.stop()
    orchestrator?.emit({ type: 'text', text: 'There was a king.' })
    expect(orchestrator?.interrupted).toBe(1)
    orchestrator?.emit({ type: 'turn-end' })

    expect(spoken()).toEqual(['Once upon a time.'])
    expect(ended()).toMatchObject([{ outcome: 'stopped', replied: 'Once upon a time.' }])
  })

  it('interrupts the thread answering', async () => {
    const { channel, harness, call, ended } = setup()
    channel.say('Plan a trip')
    await settled()
    await call(0, 'thread_open', { title: 'Trip' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()

    channel.stop()
    expect(harness.sessions[1]?.interrupted).toBe(1)
    harness.sessions[1]?.emit({ type: 'turn-end' })
    expect(ended()).toMatchObject([{ outcome: 'stopped' }])
  })

  it('decides about what is said during a direct answer once that answer has stopped', async () => {
    const { channel, harness, ended } = setup()
    channel.say('First question')
    await settled()
    const orchestrator = harness.sessions[0]
    channel.say('Never mind, second question')
    await settled()
    expect(orchestrator?.interrupted).toBe(1)
    expect(orchestrator?.sent).toHaveLength(1)

    orchestrator?.emit({ type: 'turn-end' })
    await settled()
    expect(orchestrator?.sent[1]).toContain('The person says: Never mind, second question')
    orchestrator?.reply('Here it is.')
    expect(ended().map((line) => [line.said, line.outcome])).toEqual([
      ['First question', 'stopped'],
      ['Never mind, second question', 'done']
    ])
  })
})

describe('when it cannot answer', () => {
  it('says so in the transcript when no harness is ready', async () => {
    const { channel, ended } = setup({ harness: scriptedHarness({ status: { installed: true, signedIn: false } }) })
    channel.say('Hello')
    await settled()
    expect(ended()).toMatchObject([{ said: 'Hello', outcome: 'failed', problem: expect.stringContaining('No AI program is ready') }])
  })

  it('records the failure of the orchestrator, and opens a new one for the next turn', async () => {
    const { channel, harness, ended, log } = setup()
    channel.say('Hello')
    await settled()
    harness.sessions[0]?.emit({ type: 'failed', reason: 'Claude Code stopped.' })
    expect(ended()).toMatchObject([{ outcome: 'failed', problem: 'Claude Code stopped.' }])
    expect(log.error).toHaveBeenCalledOnce()

    channel.say('Again')
    await settled()
    expect(harness.sessions).toHaveLength(2)
    expect(harness.sessions[1]?.request.role).toBe('orchestrator')
  })

  it('answers with one session, and no threads, while no tool server runs', async () => {
    const { channel, harness, spoken } = setup({ server: false })
    channel.say('Hello')
    await settled()
    expect(harness.sessions[0]?.request.tools).toBeUndefined()
    expect(harness.sessions[0]?.sent).toEqual(['(Now: Tuesday, 17 November 2026, 09:00 (Europe/Paris))\nHello'])
    harness.sessions[0]?.reply('Hi.')
    expect(spoken()).toEqual(['Hi.'])
  })
})

describe('new sessions', () => {
  it('give a thread of the critical stance the tools to object with, and an accommodating one none', async () => {
    const { channel, harness, settings, call } = setup()
    const tools = (index: number) => harness.sessions[index]?.request.tools?.token
    channel.say('Send the letter')
    await settled()
    await call(0, 'thread_open', { title: 'Letter' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    harness.sessions[1]?.reply('Sent.')
    expect(tools(1)).toBeDefined()

    settings.setPersonas({ names: [], active: 'second' })
    channel.say('Send the other letter')
    await settled()
    const orchestrator = harness.sessions.length - 1
    await call(orchestrator, 'thread_open', { title: 'Other letter' })
    harness.sessions[orchestrator]?.emit({ type: 'turn-end' })
    await settled()
    const critical = harness.sessions.at(-1)
    expect(critical?.request.instructions).toContain('raise_concern')
    expect((await call(harness.sessions.length - 1, 'raise_concern', {})).ok).toBe(true)
    expect((await call(1, 'raise_concern', {})).ok).toBe(false)
  })

  it('replace the old ones when the persona changes, and are told what was said', async () => {
    const { channel, harness, settings } = setup()
    channel.say('I have guests tonight.')
    await settled()
    harness.sessions[0]?.reply('Lovely.')

    settings.setPersonas({ names: [], active: 'second' })
    channel.say('Are you sure?')
    await settled()

    expect(harness.sessions[0]?.closed).toBe(true)
    const instructions = harness.sessions[1]?.request.instructions ?? ''
    expect(instructions).toContain('You are Grace.')
    expect(instructions).toContain('Your tone is calm, direct and exacting.')
    expect(instructions).toContain('They said: I have guests tonight.')
  })

  it('carry on from the transcript and the threads kept by an earlier run', async () => {
    const records = memoryRecords()
    const before = setup({ records })
    before.channel.say('Remember the risotto.')
    await settled()
    await before.call(0, 'thread_open', { title: 'Risotto' })
    before.harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    before.harness.sessions[1]?.reply('I will.')

    const after = setup({ records })
    expect(after.channel.read(10).map((line) => line.said)).toEqual(['Remember the risotto.'])
    expect(after.channel.threads().threads.map((thread) => thread.title)).toEqual(['Risotto'])
    after.channel.say('What did I ask?')
    await settled()
    expect(after.harness.sessions[0]?.sent[0]).toContain('"Risotto"')
    expect(after.records.read([EXCHANGE])).toHaveLength(1)
  })

  it('are all closed when the channel closes', async () => {
    const { channel, harness, call } = setup()
    channel.say('Plan a trip')
    await settled()
    await call(0, 'thread_open', { title: 'Trip' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    channel.close()
    expect(harness.sessions.every((session) => session.closed)).toBe(true)
  })
})

describe('the greeting', () => {
  it('starts a turn of its own that asks for a short briefing, shown as such in the transcript', async () => {
    const { channel, harness, ended } = setup()
    const turn = channel.greet()
    await settled()
    expect(turn).toBeDefined()
    expect(harness.sessions[0]?.sent[0]).toContain('The person has just opened the app')
    harness.sessions[0]?.reply('Good morning. It is Tuesday.')
    expect(ended()).toMatchObject([{ turn, said: '', trigger: 'greeting', replied: 'Good morning. It is Tuesday.', outcome: 'done' }])
  })

  it('does not greet again a little while later, nor while a turn is under way', async () => {
    const { channel, harness } = setup()
    channel.say('Hello')
    await settled()
    expect(channel.greet()).toBeUndefined()
    harness.sessions[0]?.reply('Hi.')
    expect(channel.greet()).toBeDefined()
    await settled()
    harness.sessions[0]?.reply('Good morning.')
    expect(channel.greet()).toBeUndefined()
  })
})

describe('the computer', () => {
  const reach = { scope: () => ({ places: [], computer: 'off' as const }), approve: async () => ({ allow: true as const }) }

  it('is given to a thread, whose session opens again when what it may reach changes', async () => {
    let version = 'one'
    const { channel, harness, call } = setup({ more: { reach: () => reach, version: () => version } })
    channel.say('Look at my notes')
    await settled()
    await call(0, 'thread_open', { title: 'Notes', kind: 'topic' })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    expect(harness.sessions[1]?.request.computer).toBe(reach)
    harness.sessions[1]?.reply('Done.')

    version = 'two'
    const thread = channel.threads().threads[0]?.id ?? ''
    channel.say('And again')
    await settled()
    await call(0, 'thread_send', { thread })
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    expect(harness.sessions[1]?.closed).toBe(true)
    expect(harness.sessions[2]?.request).toMatchObject({ role: 'thread', computer: reach })
  })

  it('takes an answer to a question on screen, and starts no turn for it', async () => {
    const heard: string[] = []
    const { channel, harness, events } = setup({ more: { hear: (said) => heard.push(said) > 0 && said === 'Allow' } })
    channel.say('Allow')
    await settled()
    expect(heard).toEqual(['Allow'])
    expect(harness.sessions).toHaveLength(0)
    expect(events.some((event) => event.name === 'turn.started')).toBe(false)

    channel.say('Something else')
    await settled()
    expect(harness.sessions).toHaveLength(1)
  })
})
