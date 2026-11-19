import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { EXCHANGE, STEP, WORK } from '../channel/channel.ts'
import type { Harness, OneShot } from '../ports/harness.ts'
import { ERASURE, type Records } from '../ports/records.ts'
import { memoryRecords } from '../records/memory.ts'
import { memorySearch } from '../records/memory-search.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import { VIEW_CLEARED, VIEW_SHOWN } from '../views/screen.ts'
import { EXTRACT_INSTRUCTIONS } from './extract.ts'
import { FACT } from './facts.ts'
import { createMemory } from './memory.ts'
import { PROFILE, PROFILE_INSTRUCTIONS } from './profile.ts'
import { RECONCILE_INSTRUCTIONS } from './reconcile.ts'
import { RETENTION_PASS_MS, RETENTION_SET } from './retention.ts'
import { SUMMARY_INSTRUCTIONS, THREAD_SUMMARY } from './summary.ts'

const NOW = new Date('2026-11-17T10:00:00Z')

/** A model that answers each kind of question the memory asks with what the test says. */
function model(answers: { extract?: (input: string) => object; reconcile?: (input: string) => object; profile?: string; summary?: (input: string) => string }) {
  return (request: OneShot) => {
    if (request.instructions === EXTRACT_INSTRUCTIONS) return JSON.stringify(answers.extract?.(request.input) ?? { facts: [] })
    if (request.instructions === RECONCILE_INSTRUCTIONS) return JSON.stringify(answers.reconcile?.(request.input) ?? { decisions: [] })
    if (request.instructions === PROFILE_INSTRUCTIONS) return answers.profile ?? 'A profile.'
    if (request.instructions === SUMMARY_INSTRUCTIONS) return answers.summary?.(request.input) ?? 'A summary.'
    throw new Error('An unexpected question.')
  }
}

function setup({
  records = memoryRecords({ now: () => NOW }),
  harness = scriptedHarness() as Harness,
  turn = () => undefined as string | undefined,
  erased = (_turns: ReadonlySet<string>) => undefined as void
} = {}) {
  let ids = 0
  const timers = manualTimers()
  const log = { error: vi.fn<(message: string) => void>() }
  const memory = createMemory({
    records,
    search: memorySearch(records),
    engines: { active: async () => harness },
    log,
    now: () => NOW,
    newId: () => `fact-${++ids}`,
    timers,
    turn,
    erased
  })
  const events: Event[] = []
  memory.onEvent((event) => events.push(event))
  const states = () => events.flatMap((event) => (event.name === 'assistant.state' ? [event.state] : []))
  return { memory, records, timers, log, events, states }
}

let turns = 0
function say(records: Records, said: string, replied = 'Noted.', thread?: string): Exchange {
  const exchange: Exchange = {
    turn: `turn-${++turns}`,
    at: NOW.toISOString(),
    persona: 'first',
    said,
    replied,
    outcome: 'done',
    ...(thread === undefined ? {} : { thread })
  }
  records.append([{ type: EXCHANGE, payload: exchange }])
  return exchange
}

/** What a memory made again from the same records is given: to read what a restart would. */
const setupOptions = (records: Records, harness: Harness) => ({
  records,
  search: memorySearch(records),
  engines: { active: async () => harness },
  log: { error: () => undefined },
  now: () => NOW,
  newId: () => 'unused'
})

async function sleep(memory: ReturnType<typeof setup>['memory']) {
  const asked = memory.sleepNow()
  if (!asked.ok) throw new Error(asked.error.message)
  await asked.done
}

describe('sleep', () => {
  it('makes sense of what was said, writes the facts with their sources, then the profile', async () => {
    const records = memoryRecords({ now: () => NOW })
    const bees = say(records, 'I keep bees on the roof.')
    const harness = scriptedHarness({
      complete: model({ extract: () => ({ facts: [{ text: 'The user keeps bees.', kind: 'preference', turns: [1] }] }), profile: 'The user keeps bees.' })
    })
    const { memory, states, events } = setup({ records, harness })

    await sleep(memory)

    expect(memory.facts()).toMatchObject([{ fact: 'fact-1', text: 'The user keeps bees.', kind: 'preference', origin: 'conversation', sources: [bees.turn] }])
    const view = memory.read()
    expect(view.groups[0]?.facts[0]?.sources).toEqual([{ turn: bees.turn, at: bees.at, said: 'I keep bees on the roof.' }])
    expect(view.profile).toBe('The user keeps bees.')
    expect(memory.profile()).toEqual({ text: 'The user keeps bees.', version: expect.any(String) })
    expect(states()).toEqual([
      { asleep: true, since: NOW.toISOString() },
      { asleep: true, since: NOW.toISOString(), work: { done: 0, total: 1 } },
      { asleep: true, since: NOW.toISOString(), work: { done: 1, total: 1 } },
      { asleep: true, since: NOW.toISOString(), lastSlept: NOW.toISOString() }
    ])
    expect(events.filter((event) => event.name === 'memory.changed')).toHaveLength(2)
    // A reconciliation call was not needed: nothing similar was known.
    expect(harness.completions.map((call) => call.instructions)).toEqual([EXTRACT_INSTRUCTIONS, PROFILE_INSTRUCTIONS])
  })

  it('reads only what was said since the last sleep, in batches, and resumes after a restart', async () => {
    const records = memoryRecords({ now: () => NOW })
    for (let line = 0; line < 14; line++) say(records, `Line ${line}`)
    const harness = scriptedHarness({ complete: model({}) })
    await sleep(setup({ records, harness }).memory)
    const extractions = () => harness.completions.filter((call) => call.instructions === EXTRACT_INSTRUCTIONS)
    expect(extractions().map((call) => call.input.match(/Turn \d+,/g)?.length)).toEqual([12, 2])

    say(records, 'One more thing.')
    await sleep(setup({ records, harness }).memory)
    expect(extractions()).toHaveLength(3)
    expect(extractions()[2]?.input).toContain('One more thing.')
    expect(extractions()[2]?.input).not.toContain('Line 13')
  })

  it('weighs a candidate against similar facts: a fact that is no longer true is replaced', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'I live in Paris.')
    const harness = scriptedHarness({
      complete: model({
        extract: (input) =>
          input.includes('Lyon')
            ? { facts: [{ text: 'The user lives in Lyon.', kind: 'other', turns: [1] }] }
            : { facts: [{ text: 'The user lives in Paris.', kind: 'other', turns: [1] }] },
        reconcile: (input) => {
          expect(input).toContain('k1: The user lives in Paris.')
          return { decisions: [{ candidate: 1, action: 'replace', fact: 'k1', text: 'The user lives in Lyon.' }] }
        }
      })
    })
    const { memory } = setup({ records, harness })
    await sleep(memory)
    memory.wake()
    say(records, 'I moved: I live in Lyon now.')
    await sleep(memory)

    expect(memory.facts().map((fact) => [fact.text, fact.replaces])).toEqual([['The user lives in Lyon.', 'fact-1']])
  })

  it('stops at once when woken, and makes sense of the interrupted batch at the next sleep', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'I keep bees.')
    const asked: Array<(answer: string) => void> = []
    const harness: Harness = { ...scriptedHarness(), complete: () => new Promise<string>((resolve) => asked.push(resolve)) }
    const { memory, states } = setup({ records, harness })

    const first = memory.sleepNow()
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    memory.wake()
    expect(memory.state()).toEqual({ asleep: false })
    asked[0]?.(JSON.stringify({ facts: [{ text: 'The user keeps bees.', kind: 'preference', turns: [1] }] }))
    if (first.ok) await first.done
    expect(memory.facts()).toEqual([])
    expect(states().at(-1)).toEqual({ asleep: false })

    const second = memory.sleepNow()
    await vi.waitFor(() => expect(asked).toHaveLength(2))
    expect(asked).toHaveLength(2)
    asked[1]?.(JSON.stringify({ facts: [{ text: 'The user keeps bees.', kind: 'preference', turns: [1] }] }))
    await vi.waitFor(() => expect(asked).toHaveLength(3))
    asked[2]?.('The user keeps bees.')
    if (second.ok) await second.done
    expect(memory.facts().map((fact) => fact.text)).toEqual(['The user keeps bees.'])
  })

  it('asks again once when the answer cannot be read, then passes the batch over', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'Something.')
    let calls = 0
    const harness = scriptedHarness({
      complete: (request) => {
        calls++
        return request.instructions === EXTRACT_INSTRUCTIONS ? 'Sorry, I cannot.' : 'Profile.'
      }
    })
    const { memory, log } = setup({ records, harness })
    await sleep(memory)
    expect(calls).toBe(2)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('passed over 1 exchanges'))

    await sleep(setup({ records, harness }).memory)
    expect(calls).toBe(2)
  })

  it('keeps the batch for later when the harness cannot be reached', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'Something.')
    const failing: Harness = { ...scriptedHarness(), complete: () => Promise.reject(new Error('Offline.')) }
    const { memory, log } = setup({ records, harness: failing })
    await sleep(memory)
    expect(log.error).toHaveBeenCalledWith('Sleep stopped: Offline.')

    const harness = scriptedHarness({ complete: model({}) })
    await sleep(setup({ records, harness }).memory)
    expect(harness.completions[0]?.input).toContain('Something.')
  })

  it('writes the summary of each thread used since, from its last summary and what was said after it', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'Plan the trip to Lisbon.', 'Three days, flights booked.', 'trip')
    say(records, 'What is the weather?', 'Sunny.')
    const inputs: string[] = []
    const harness = scriptedHarness({
      complete: model({
        summary: (input) => {
          inputs.push(input)
          return inputs.length === 1 ? 'Planning a three-day trip to Lisbon; flights are booked.' : 'Lisbon trip planned; the hotel is now booked too.'
        }
      })
    })
    const { memory } = setup({ records, harness })

    await sleep(memory)
    expect(memory.summary('trip')).toBe('Planning a three-day trip to Lisbon; flights are booked.')
    expect(inputs[0]).toContain('The summary so far: (none yet)')
    expect(inputs[0]).toContain('The person: Plan the trip to Lisbon.')

    // Nothing new in the thread: no call. Something new: the summary so far and the new lines only.
    memory.wake()
    await sleep(memory)
    expect(inputs).toHaveLength(1)
    say(records, 'Book the hotel.', 'Booked.', 'trip')
    memory.wake()
    await sleep(memory)
    expect(inputs[1]).toContain('The summary so far: Planning a three-day trip to Lisbon')
    expect(inputs[1]).not.toContain('Plan the trip to Lisbon.')
    expect(createMemory({ ...setupOptions(records, harness) }).summary('trip')).toBe('Lisbon trip planned; the hotel is now booked too.')
  })

  it('falls asleep after the quiet period, and is woken by what is said', async () => {
    const { memory, timers, states } = setup()
    timers.advance(10 * 60_000)
    expect(memory.state().asleep).toBe(true)
    memory.wake()
    expect(states().at(-1)).toEqual({ asleep: false })
    timers.advance(9 * 60_000)
    expect(memory.state().asleep).toBe(false)
  })

  it('keeps the sleep setting, and refuses to sleep when told never to', () => {
    const records = memoryRecords({ now: () => NOW })
    const { memory, timers } = setup({ records })
    expect(memory.setSleep({ when: 'never' }).sleep).toEqual({ when: 'never', quietMinutes: 10, time: '03:00' })
    expect(memory.sleepNow()).toMatchObject({ ok: false, error: { code: 'sleep-off' } })
    timers.advance(60 * 60_000)
    expect(memory.state().asleep).toBe(false)
    expect(setup({ records }).memory.read().sleep.when).toBe('never')
  })
})

describe('remembering, correcting and forgetting', () => {
  it('remembers on request at once, from the turn under way, and only once', () => {
    const { memory } = setup({ turn: () => 'turn-now' })
    const fact = memory.remember('The user parks on level 3.', 'other')
    expect(fact).toMatchObject({ origin: 'told', sources: ['turn-now'] })
    expect(memory.remember('the user parks on level 3.').fact).toBe(fact.fact)
    expect(memory.facts()).toHaveLength(1)
    expect(memory.profile()).toEqual({ text: '- The user parks on level 3.' })
  })

  it('keeps a correction as a new version of the same fact', () => {
    const { memory, records } = setup()
    const fact = memory.remember('The user parks on level 3.')
    const change = memory.edit({ fact: fact.fact, text: 'The user parks on level 4.', kind: 'preference' })
    expect(change).toMatchObject({ ok: true, memory: { groups: [{ kind: 'preference', facts: [{ id: fact.fact, origin: 'edited' }] }] } })
    expect(records.read([FACT])).toHaveLength(2)
    expect(memory.edit({ fact: 'nope', text: 'x' })).toMatchObject({ ok: false, error: { code: 'unknown-fact' } })
  })

  it('erases a forgotten fact, its earlier versions and the profile that may say it', async () => {
    const records = memoryRecords({ now: () => NOW })
    const harness = scriptedHarness({ complete: model({ profile: 'The user parks on level 4.' }) })
    const { memory } = setup({ records, harness })
    const fact = memory.remember('The user parks on level 3.')
    memory.edit({ fact: fact.fact, text: 'The user parks on level 4.' })
    await sleep(memory)
    expect(memory.read().profile).toBe('The user parks on level 4.')

    expect(memory.forget(fact.fact)).toMatchObject({ ok: true, memory: { groups: [] } })
    expect(records.read([FACT, PROFILE]).map((record) => record.payload)).toEqual([null, null, null])
    expect(records.read([ERASURE])).toHaveLength(1)
    expect(memory.profile()).toBeUndefined()
    expect(memory.recall('where do I park')).toBeUndefined()
    expect(setup({ records }).memory.facts()).toEqual([])
  })
})

describe('forgetting the words a fact came from', () => {
  it('erases the lines it was learned from, their calls and the views closed since, and leaves the others', () => {
    const records = memoryRecords({ now: () => NOW })
    const kept = say(records, 'What is the weather?', 'Sunny.')
    const learned = say(records, 'My locker code is 4521.', 'Noted.', 'gym')
    records.append([
      { type: STEP, payload: { call: 'c1', turn: learned.turn, tool: 'memory_remember', at: NOW.toISOString(), input: { text: 'locker 4521' } } },
      { type: WORK, payload: { thread: 'gym', request: 'My locker code is 4521.', exchange: learned } },
      { type: VIEW_SHOWN, payload: { id: 'view-closed', turn: learned.turn, title: 'Locker' } },
      { type: VIEW_CLEARED, payload: { view: 'view-closed' } },
      { type: VIEW_SHOWN, payload: { id: 'view-open', turn: learned.turn, title: 'Locker' } }
    ])
    const told: string[][] = []
    const { memory } = setup({ records, turn: () => learned.turn, erased: (turns) => void told.push([...turns]) })
    const fact = memory.remember('The user’s locker code is 4521.')
    expect(memory.read().groups[0]?.facts[0]?.sources).toEqual([{ turn: learned.turn, at: NOW.toISOString(), said: 'My locker code is 4521.' }])

    memory.forget(fact.fact)
    const payloads = (type: string) => records.read([type]).map((record) => record.payload)
    expect(payloads(EXCHANGE)).toEqual([kept, null])
    expect(payloads(STEP)).toEqual([null])
    expect(payloads(WORK)).toEqual([null])
    expect(payloads(VIEW_SHOWN)).toEqual([null, { id: 'view-open', turn: learned.turn, title: 'Locker' }])
    expect(payloads(VIEW_CLEARED)).toEqual([{ view: 'view-closed' }])
    expect(told).toEqual([[learned.turn]])
    expect(memory.recall('locker code')).toBeUndefined()
    expect(memorySearch(records).search({ text: 'weather', types: [EXCHANGE], limit: 5 })).toHaveLength(1)
    expect(memorySearch(records).search({ text: 'locker', types: [EXCHANGE], limit: 5 })).toEqual([])
  })

  it('erases the lines of every version, and of the facts it replaced', () => {
    const records = memoryRecords({ now: () => NOW })
    const first = say(records, 'I park on level 3.')
    const second = say(records, 'Actually I park on level 4 now.')
    let turn = first.turn
    const { memory } = setup({ records, turn: () => turn })
    const fact = memory.remember('The user parks on level 3.')
    turn = second.turn
    records.append([
      {
        type: FACT,
        payload: {
          fact: 'fact-new',
          text: 'The user parks on level 4.',
          kind: 'other',
          origin: 'conversation',
          sources: [second.turn],
          since: NOW.toISOString(),
          replaces: fact.fact
        }
      }
    ])
    const again = setup({ records })
    again.memory.forget('fact-new')
    expect(records.read([EXCHANGE]).map((record) => record.payload)).toEqual([null, null])
  })
})

describe('forgetting and summaries', () => {
  it('erases the summaries too, which may say what is forgotten, and writes them again at the next sleep', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'My sister Ana lives in Porto.', 'Noted.', 'family')
    const harness = scriptedHarness({ complete: model({ summary: () => 'About Ana, the sister, in Porto.' }) })
    const { memory } = setup({ records, harness })
    const fact = memory.remember('The user has a sister, Ana.')
    await sleep(memory)
    expect(memory.summary('family')).toBe('About Ana, the sister, in Porto.')

    memory.forget(fact.fact)
    expect(memory.summary('family')).toBeUndefined()
    expect(records.read([THREAD_SUMMARY]).map((record) => record.payload)).toEqual([null])
    memory.wake()
    await sleep(memory)
    expect(memory.summary('family')).toBe('About Ana, the sister, in Porto.')
  })
})

describe('keeping the conversation for a period', () => {
  const DAY = 24 * 60 * 60_000

  it('erases the words older than the period at once, keeps what was learned from them, and keeps the period', () => {
    let clock = new Date('2026-09-01T10:00:00Z')
    const records = memoryRecords({ now: () => clock })
    const old = say(records, 'My locker code is pineapple.')
    records.append([
      { type: VIEW_SHOWN, payload: { id: 'closed', root: 'r', elements: {} } },
      { type: VIEW_CLEARED, payload: { view: 'closed' } },
      { type: VIEW_SHOWN, payload: { id: 'open', root: 'r', elements: {} } }
    ])
    clock = NOW
    const recent = say(records, 'Pineapple juice is on the list.')
    const { memory } = setup({ records, turn: () => old.turn })
    const fact = memory.remember('The user has a locker.')
    expect(memory.read().groups[0]?.facts[0]?.sources[0]?.said).toBe('My locker code is pineapple.')
    const erased: string[][] = []
    const opened = createMemory({ ...setupOptions(records, scriptedHarness()), erased: (turns) => void erased.push([...turns]) })

    expect(opened.setRetention(30).retentionDays).toBe(30)
    expect(records.read([EXCHANGE]).map((record) => (record.payload as Exchange | null)?.turn ?? null)).toEqual([null, recent.turn])
    expect(records.read([VIEW_SHOWN]).map((record) => (record.payload as { id: string } | null)?.id ?? null)).toEqual([null, 'open'])
    expect(erased).toEqual([[old.turn]])
    expect(opened.recall('pineapple') ?? '').not.toContain('locker code')
    expect(opened.read().groups[0]?.facts[0]).toMatchObject({ id: fact.fact, sources: [{ turn: old.turn }] })
    expect(opened.read().groups[0]?.facts[0]?.sources[0]?.said).toBeUndefined()
    expect(createMemory(setupOptions(records, scriptedHarness())).read().retentionDays).toBe(30)
  })

  it('applies the period as the memory is made, and twice a day while the app stays open', () => {
    const records = memoryRecords({ now: () => NOW })
    const timers = manualTimers()
    const now = () => new Date(NOW.getTime() + timers.elapsed())
    const line = say(records, 'Something said today.')
    const erased: string[][] = []
    const memory = createMemory({ ...setupOptions(records, scriptedHarness()), now, timers, erased: (turns) => void erased.push([...turns]) })
    memory.setRetention(30)
    expect(erased).toEqual([])

    timers.advance(30 * DAY)
    expect(erased).toEqual([])
    timers.advance(RETENTION_PASS_MS)
    expect(erased).toEqual([[line.turn]])
    expect(records.read([EXCHANGE]).map((record) => record.payload)).toEqual([null])
    memory.close()

    // Made again later, as after a restart: what is older is erased before anything reads the log, and no one is told.
    const later = memoryRecords({ now: () => new Date('2026-09-01T10:00:00Z') })
    say(later, 'An old line.')
    later.append([{ type: RETENTION_SET, payload: { days: 30 } }])
    const told: string[][] = []
    createMemory({ ...setupOptions(later, scriptedHarness()), erased: (turns) => void told.push([...turns]) })
    expect(later.read([EXCHANGE]).map((record) => record.payload)).toEqual([null])
    expect(told).toEqual([])
  })

  it('keeps everything for good by default, and again once the period is taken away', () => {
    const records = memoryRecords({ now: () => new Date('2020-01-01T00:00:00Z') })
    say(records, 'A line from long ago.')
    const memory = createMemory(setupOptions(records, scriptedHarness()))
    expect(memory.read().retentionDays).toBeNull()
    expect(memory.setRetention(null).retentionDays).toBeNull()
    expect(records.read([EXCHANGE]).map((record) => record.payload)).not.toEqual([null])
  })
})

describe('recall', () => {
  it('brings the facts and the words that bear on what was said', () => {
    const records = memoryRecords({ now: () => new Date('2026-10-01T09:00:00Z') })
    say(records, 'The plumber comes on Thursday about the leak.', 'I will remind you.')
    const { memory } = setup({ records })
    memory.remember('The user’s plumber is called Marco.', 'person')

    const block = memory.recall('Has the plumber called back?')
    expect(block).toContain('[From your memory')
    expect(block).toContain('- The user’s plumber is called Marco. (known since 2026-11-17)')
    expect(block).toContain('- On 2026-10-01, in conversation: "The plumber comes on Thursday about the leak.')
    expect(memory.recall('What is the weather like?')).toBeUndefined()
  })

  it('leaves out the lines the session already knows', () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'The plumber comes on Thursday.')
    const { memory } = setup({ records })
    expect(memory.recall('plumber', NOW.toISOString())).toBeUndefined()
    expect(memory.recall('plumber', '2026-11-18T00:00:00Z')).toContain('plumber comes')
  })
})

describe('the memory tools', () => {
  const tool = (memory: ReturnType<typeof setup>['memory'], name: string) => {
    const found = memory.tools.find((candidate) => candidate.definition.name === name)
    if (!found) throw new Error(`No tool ${name}.`)
    return found
  }

  it('search the facts and the log', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'We decided the trip to Porto is in March.')
    const { memory } = setup({ records })
    const fact = memory.remember('The user goes to Porto in 2027-03.', 'date')

    const found = await tool(memory, 'memory_search').run({ query: 'Porto trip' })
    expect(found.ok).toBe(true)
    expect(found.text).toContain(`[${fact.fact}] The user goes to Porto in 2027-03. (date, since 2026-11-17)`)
    expect(found.text).toContain('2026-11-17: "We decided the trip to Porto is in March.')
    expect(await tool(memory, 'memory_search').run({ query: 'volcano' })).toEqual({ ok: true, text: 'Nothing in memory matches that.' })
    expect((await tool(memory, 'memory_search').run({})).ok).toBe(false)
  })

  it('remember what they are told, once', async () => {
    const { memory } = setup()
    expect(await tool(memory, 'memory_remember').run({ text: 'The user is allergic to cats.' })).toEqual({
      ok: true,
      text: 'Remembered: The user is allergic to cats.'
    })
    expect(await tool(memory, 'memory_remember').run({ text: 'The user is allergic to cats.' })).toMatchObject({
      text: 'Already known: The user is allergic to cats.'
    })
  })

  it('forget by id or by description, and ask which one when several could be meant', async () => {
    const { memory } = setup()
    const cats = memory.remember('The user is allergic to cats.')
    memory.remember('The user feeds the neighbour’s cats.')
    memory.remember('The user drinks tea.')
    const forget = tool(memory, 'memory_forget')

    const ambiguous = await forget.run({ description: 'cats' })
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.text).toContain(`[${cats.fact}]`)
    expect(memory.facts()).toHaveLength(3)

    expect(await forget.run({ description: 'drinks tea' })).toEqual({ ok: true, text: 'Forgotten: The user drinks tea.' })
    expect(await forget.run({ fact: cats.fact })).toEqual({ ok: true, text: 'Forgotten.' })
    expect((await forget.run({ fact: cats.fact })).ok).toBe(false)
    expect((await forget.run({})).ok).toBe(false)
    expect(memory.facts().map((fact) => fact.text)).toEqual(['The user feeds the neighbour’s cats.'])
  })
})
