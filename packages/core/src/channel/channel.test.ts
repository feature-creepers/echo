import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createEngineRoom } from '../engines/engines.ts'
import { memoryRecords } from '../records/memory.ts'
import { type ScriptedHarness, scriptedHarness } from '../replay/scripted-harness.ts'
import { createUserSettings } from '../settings/settings.ts'
import { createChannel, EXCHANGE, type Remembering } from './channel.ts'

function setup({ harnesses = [scriptedHarness()] as ScriptedHarness[], records = memoryRecords(), memory = undefined as Remembering | undefined } = {}) {
  let ids = 0
  const settings = createUserSettings(records, [
    { id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' },
    { id: 'second', name: 'Grace', stance: 'critical', accent: 'red' }
  ])
  const log = { error: vi.fn<(message: string) => void>() }
  const channel = createChannel({
    engines: createEngineRoom(harnesses),
    settings,
    records,
    log,
    now: () => new Date('2026-11-17T08:00:00Z'),
    newId: () => `turn-${++ids}`,
    ...(memory ? { memory } : {})
  })
  const events: Event[] = []
  channel.onEvent((event) => events.push(event))
  const names = () => events.map((event) => event.name)
  const spoken = () => events.flatMap((event) => (event.name === 'speech.say' ? [event.text] : []))
  const ended = () => events.flatMap((event): Exchange[] => (event.name === 'turn.ended' ? [event.exchange] : []))
  return { channel, harness: harnesses[0] as ScriptedHarness, harnesses, settings, records, log, events, names, spoken, ended }
}

/** Lets what the channel started without waiting for it come to its end. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

describe('a turn', () => {
  it('opens a session as the persona in use, with the rules for speaking', async () => {
    const { channel, harness } = setup()
    channel.say('Hello')
    await settled()

    const request = harness.sessions[0]?.request
    expect(request?.role).toBe('thread')
    expect(request?.instructions).toContain('You are Ada.')
    expect(request?.instructions).toContain('spoken aloud')
    expect(harness.sessions[0]?.sent).toEqual(['Hello'])
  })

  it('says each sentence as soon as the next one starts, and the last one when the turn ends', async () => {
    const { channel, harness, names, spoken } = setup()
    channel.say('What should I cook?')
    await settled()
    const session = harness.sessions[0]

    session?.emit({ type: 'text', text: 'A risotto would' })
    session?.emit({ type: 'text', text: ' work. Forty' })
    expect(spoken()).toEqual(['A risotto would work.'])

    session?.emit({ type: 'text', text: ' minutes.' })
    session?.emit({ type: 'turn-end' })
    expect(spoken()).toEqual(['A risotto would work.', 'Forty minutes.'])
    expect(names()).toEqual(['turn.started', 'speech.say', 'speech.say', 'turn.ended'])
  })

  it('announces the language of each sentence, falling back on the one the user spoke', async () => {
    const { channel, harness, events } = setup()
    channel.say('Bonjour', 'fr')
    await settled()
    harness.sessions[0]?.reply('Bonjour, que puis-je faire pour vous ? ', 'OK. ', 'The weather is fine and it is warm.')

    expect(events.flatMap((event) => (event.name === 'speech.say' ? [event.language] : []))).toEqual(['fr', 'fr', 'en'])
  })

  it('records the line when the turn is over, and not before', async () => {
    const { channel, harness, records, ended } = setup()
    const turn = channel.say('Hello')
    await settled()
    expect(records.read([EXCHANGE])).toEqual([])

    harness.sessions[0]?.reply('Good morning.')

    const line: Exchange = { turn, at: '2026-11-17T08:00:00.000Z', persona: 'first', said: 'Hello', replied: 'Good morning.', outcome: 'done' }
    expect(ended()).toEqual([line])
    expect(records.read([EXCHANGE]).map((record) => record.payload)).toEqual([line])
    expect(channel.read(10)).toEqual([line])
  })

  it('reads aloud what a model wrote for the eye without its marks', async () => {
    const { channel, harness, spoken } = setup()
    channel.say('Hello')
    await settled()
    harness.sessions[0]?.reply('**Done.** It is _ready_.')

    expect(spoken()).toEqual(['Done.', 'It is ready.'])
  })

  it('announces the tools the session uses', async () => {
    const { channel, harness, events } = setup()
    const turn = channel.say('Show me')
    await settled()
    harness.sessions[0]?.emit({ type: 'tool', name: 'ui_render', phase: 'started' })
    harness.sessions[0]?.emit({ type: 'tool', name: 'ui_render', phase: 'ended' })

    expect(events.filter((event) => event.name === 'activity')).toEqual([
      { type: 'event', name: 'activity', turn, tool: 'ui_render', phase: 'started' },
      { type: 'event', name: 'activity', turn, tool: 'ui_render', phase: 'ended' }
    ])
  })

  it('keeps one session for the turns that follow', async () => {
    const { channel, harness } = setup()
    channel.say('One')
    await settled()
    harness.sessions[0]?.reply('First.')
    channel.say('Two')
    await settled()

    expect(harness.sessions).toHaveLength(1)
    expect(harness.sessions[0]?.sent).toEqual(['One', 'Two'])
  })
})

describe('stopping', () => {
  it('interrupts the session, says nothing more, and records the turn as stopped once the session confirms', async () => {
    const { channel, harness, spoken, ended } = setup()
    channel.say('Tell me a long story')
    await settled()
    const session = harness.sessions[0]
    session?.emit({ type: 'text', text: 'Once upon a time. ' })

    channel.stop()
    session?.emit({ type: 'text', text: 'There was a king. And a queen.' })
    expect(session?.interrupted).toBe(1)
    expect(ended()).toEqual([])

    session?.emit({ type: 'turn-end' })
    expect(spoken()).toEqual(['Once upon a time.'])
    expect(ended()).toMatchObject([{ outcome: 'stopped', replied: 'Once upon a time.' }])
  })

  it('does nothing when no turn is under way', () => {
    const { channel, events } = setup()
    channel.stop()
    expect(events).toEqual([])
  })

  it('answers what is said during an answer once that answer has stopped', async () => {
    const { channel, harness, names, ended } = setup()
    channel.say('First question')
    await settled()
    const session = harness.sessions[0]
    session?.emit({ type: 'text', text: 'Let me think. ' })

    channel.say('Never mind, second question')
    await settled()
    expect(session?.interrupted).toBe(1)
    expect(session?.sent).toEqual(['First question'])

    session?.emit({ type: 'turn-end' })
    await settled()
    expect(session?.sent).toEqual(['First question', 'Never mind, second question'])
    session?.reply('Here it is.')

    expect(ended().map((line) => [line.said, line.outcome])).toEqual([
      ['First question', 'stopped'],
      ['Never mind, second question', 'done']
    ])
    expect(names().filter((name) => name === 'turn.started')).toHaveLength(2)
  })

  it('keeps only the last of several things said during an answer', async () => {
    const { channel, harness, ended } = setup()
    channel.say('One')
    await settled()
    channel.say('Two')
    channel.say('Three')
    harness.sessions[0]?.emit({ type: 'turn-end' })
    await settled()
    harness.sessions[0]?.reply('Answer.')

    expect(harness.sessions[0]?.sent).toEqual(['One', 'Three'])
    expect(ended().map((line) => line.said)).toEqual(['One', 'Three'])
  })
})

describe('when it cannot answer', () => {
  it('says so in the transcript when no harness is ready', async () => {
    const { channel, ended } = setup({ harnesses: [scriptedHarness({ status: { installed: true, signedIn: false } })] })
    channel.say('Hello')
    await settled()

    expect(ended()).toMatchObject([{ said: 'Hello', outcome: 'failed', problem: expect.stringContaining('No AI program is ready') }])
  })

  it('records the failure of a session, and opens a new one for the next turn', async () => {
    const { channel, harness, ended, log } = setup()
    channel.say('Hello')
    await settled()
    harness.sessions[0]?.emit({ type: 'text', text: 'Good ' })
    harness.sessions[0]?.emit({ type: 'failed', reason: 'Claude Code stopped.' })

    expect(ended()).toMatchObject([{ outcome: 'failed', problem: 'Claude Code stopped.', replied: 'Good' }])
    expect(log.error).toHaveBeenCalledOnce()

    channel.say('Again')
    await settled()
    expect(harness.sessions).toHaveLength(2)
    expect(harness.sessions[1]?.sent).toEqual(['Again'])
  })
})

describe('a new session', () => {
  it('replaces the old one when the persona changes, and is told what was said so far', async () => {
    const { channel, harness, settings } = setup()
    channel.say('I have guests tonight.')
    await settled()
    harness.sessions[0]?.reply('A risotto would work.')

    settings.setPersonas({ names: [], active: 'second' })
    channel.say('Are you sure?')
    await settled()

    expect(harness.sessions).toHaveLength(2)
    expect(harness.sessions[0]?.closed).toBe(true)
    const instructions = harness.sessions[1]?.request.instructions ?? ''
    expect(instructions).toContain('You are Grace.')
    expect(instructions).toContain('ask once whether they are sure')
    expect(instructions).toContain('They said: I have guests tonight.')
    expect(instructions).toContain('You answered: A risotto would work.')
  })

  it('replaces the old one when the persona is renamed', async () => {
    const { channel, harness, settings } = setup()
    channel.say('Hello')
    await settled()
    harness.sessions[0]?.reply('Hello.')

    settings.setPersonas({ names: [{ persona: 'first', name: 'Marvin' }], active: 'first' })
    channel.say('Who are you?')
    await settled()

    expect(harness.sessions[1]?.request.instructions).toContain('You are Marvin.')
  })

  it('is told the transcript kept from an earlier run', async () => {
    const records = memoryRecords()
    const before = setup({ records })
    before.channel.say('Remember the risotto.')
    await settled()
    before.harness.sessions[0]?.reply('I will.')

    const after = setup({ records })
    expect(after.channel.read(10).map((line) => line.said)).toEqual(['Remember the risotto.'])
    after.channel.say('What did I ask?')
    await settled()

    expect(after.harness.sessions[0]?.request.instructions).toContain('They said: Remember the risotto.')
  })

  it('is closed when the channel closes', async () => {
    const { channel, harness } = setup()
    channel.say('Hello')
    await settled()
    channel.close()
    expect(harness.sessions[0]?.closed).toBe(true)
  })
})

describe('memory in the channel', () => {
  function remembering(profile?: { text: string; version?: string }) {
    const calls: string[] = []
    const memory: Remembering & { calls: string[]; profileNow: typeof profile } = {
      calls,
      profileNow: profile,
      wake: () => void calls.push('wake'),
      recall: (said, knownSince) => {
        calls.push(`recall:${said}:${knownSince}`)
        return said.includes('plumber') ? '[From your memory]\n- The plumber is Marco.' : undefined
      },
      profile: () => memory.profileNow
    }
    return memory
  }

  it('wakes the memory when something is said and when it is answered', async () => {
    const memory = remembering()
    const { channel, harness } = setup({ memory })
    channel.say('Hello')
    expect(memory.calls[0]).toBe('wake')
    await settled()
    harness.sessions[0]?.reply('Hi.')
    expect(memory.calls.filter((call) => call === 'wake')).toHaveLength(2)
  })

  it('sends what it recalls ahead of what was said, and keeps the words as said', async () => {
    const memory = remembering()
    const { channel, harness, ended } = setup({ memory })
    channel.say('Has the plumber called?')
    await settled()
    expect(harness.sessions[0]?.sent).toEqual(['[From your memory]\n- The plumber is Marco.\n\nHas the plumber called?'])
    expect(memory.calls).toContain('recall:Has the plumber called?:2026-11-17T08:00:00.000Z')
    harness.sessions[0]?.reply('Not yet.')
    expect(ended()[0]?.said).toBe('Has the plumber called?')

    channel.say('Hello')
    await settled()
    expect(harness.sessions[0]?.sent.at(-1)).toBe('Hello')
  })

  it('gives the profile to the session, and opens a new one only when sleep wrote a new profile', async () => {
    const memory = remembering({ text: 'The user keeps bees.', version: 'p1' })
    const { channel, harness } = setup({ memory })
    channel.say('One')
    await settled()
    expect(harness.sessions[0]?.request.instructions).toContain('What you know about the person, from your memory.')
    expect(harness.sessions[0]?.request.instructions).toContain('The user keeps bees.')
    harness.sessions[0]?.reply('Fine.')

    memory.profileNow = { text: 'The user keeps bees.\n\nLearned since:\n- Likes tea.', version: 'p1' }
    channel.say('Two')
    await settled()
    expect(harness.sessions).toHaveLength(1)
    harness.sessions[0]?.reply('Fine.')

    memory.profileNow = { text: 'The user keeps bees and likes tea.', version: 'p2' }
    channel.say('Three')
    await settled()
    expect(harness.sessions).toHaveLength(2)
    expect(harness.sessions[1]?.request.instructions).toContain('The user keeps bees and likes tea.')
  })
})
