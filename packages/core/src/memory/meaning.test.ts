import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { EXCHANGE } from '../channel/channel.ts'
import type { EmbedderState } from '../ports/embedder.ts'
import type { Harness } from '../ports/harness.ts'
import type { Records } from '../ports/records.ts'
import type { VectorsAvailable } from '../ports/vectors.ts'
import { memoryRecords } from '../records/memory.ts'
import { memorySearch } from '../records/memory-search.ts'
import { memoryVectors } from '../records/memory-vectors.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { type ScriptedEmbedderOptions, scriptedEmbedder } from '../replay/scripted-embedder.ts'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import { createMemory, type Memory } from './memory.ts'

const NOW = new Date('2026-11-17T10:00:00Z')

/** What the test model reads in a text: one direction per subject, in either language. Anything else points elsewhere. */
const SUBJECTS = [
  ['car', 'voiture', 'park', 'garé'],
  ['plumber', 'plombier', 'leak', 'fuite'],
  ['tea', 'thé']
]
function meaningOf(text: string): Float32Array {
  const vector = new Float32Array(4)
  const lower = text.toLowerCase()
  for (const [index, words] of SUBJECTS.entries()) if (words.some((word) => lower.includes(word))) vector[index] = 1
  if (vector.every((value) => value === 0)) vector[3] = 1
  return vector
}

let turns = 0
function say(records: Records, said: string, at = NOW.toISOString()): Exchange {
  const exchange: Exchange = { turn: `turn-${++turns}`, at, persona: 'first', said, replied: 'Noted.', outcome: 'done' }
  records.append([{ type: EXCHANGE, payload: exchange, at }])
  return exchange
}

interface Setup {
  records?: Records
  /** Left out, no model is offered at all. */
  embedder?: Partial<ScriptedEmbedderOptions> | undefined
  vectors?: VectorsAvailable
  busy?: () => boolean
}

function setup({ records = memoryRecords({ now: () => NOW }), embedder, vectors = { ok: true }, busy }: Setup = {}) {
  const timers = manualTimers()
  let ids = 0
  const model = embedder ? scriptedEmbedder({ meaningOf, ...embedder }) : undefined
  const kept = memoryVectors(records, vectors)
  const log = { error: vi.fn<(message: string) => void>() }
  const memory = createMemory({
    records,
    search: memorySearch(records),
    embedder: model,
    vectors: kept,
    engines: { active: async () => scriptedHarness() as Harness },
    log,
    now: () => NOW,
    newId: () => `fact-${++ids}`,
    timers,
    ...(busy ? { busy } : {})
  })
  const events: Event[] = []
  memory.onEvent((event) => events.push(event))
  return { memory, records, timers, model, vectors: kept, log, events }
}

async function sleep(memory: Memory) {
  const asked = memory.sleepNow()
  if (!asked.ok) throw new Error(asked.error.message)
  await asked.done
}

const searchTool = (memory: Memory) => memory.tools.find((tool) => tool.definition.name === 'memory_search')

/** A promise and the function that settles it. */
function held() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('vectors made while asleep', () => {
  it('gives a vector to what has none at the end of each sleep, 32 at a time, the newest first', async () => {
    const records = memoryRecords({ now: () => NOW })
    const said = Array.from({ length: 40 }, (_, index) => say(records, `Line ${index}`, new Date(Date.UTC(2026, 9, 1 + index)).toISOString()))
    const { memory, model } = setup({ records, embedder: {} })

    await sleep(memory)

    const passages = model?.calls.filter((call) => call.use === 'passage') ?? []
    expect(passages.map((call) => call.texts.length)).toEqual([32, 8])
    expect(passages[0]?.texts[0]).toBe('Line 39\nNoted.')
    expect(passages[1]?.texts.at(-1)).toBe('Line 0\nNoted.')
    expect(memory.read().meaning).toMatchObject({ state: 'ready', lines: { done: 40, total: 40 }, facts: { done: 0, total: 0 } })
    expect(said).toHaveLength(40)
  })

  it('stops when the person speaks, and the next sleep goes on from where it stopped', async () => {
    const records = memoryRecords({ now: () => NOW })
    for (let index = 0; index < 40; index++) say(records, `Line ${index}`, new Date(Date.UTC(2026, 9, 1 + index)).toISOString())
    const second = held()
    const { memory, model } = setup({ records, embedder: { gate: (call) => (call === 2 ? second.promise : undefined) } })

    const asked = memory.sleepNow()
    await vi.waitFor(() => expect(model?.calls).toHaveLength(2))
    memory.wake()
    second.release()
    if (asked.ok) await asked.done
    expect(memory.read().meaning).toMatchObject({ lines: { done: 32, total: 40 } })

    await sleep(memory)
    expect(model?.calls.at(-1)?.texts).toEqual([
      'Line 7\nNoted.',
      'Line 6\nNoted.',
      'Line 5\nNoted.',
      'Line 4\nNoted.',
      'Line 3\nNoted.',
      'Line 2\nNoted.',
      'Line 1\nNoted.',
      'Line 0\nNoted.'
    ])
    expect(memory.read().meaning).toMatchObject({ lines: { done: 40, total: 40 } })
  })

  it('makes none while awake, nor during an answer', async () => {
    let answering = true
    const { memory, records, model, timers } = setup({ embedder: {}, busy: () => answering })
    say(records, 'The car is on level three.')
    memory.remember('The user drinks green tea.')
    await memory.recall('Where is the car?')
    timers.advance(60 * 60_000)
    await Promise.resolve()

    expect(model?.calls.map((call) => call.use)).toEqual(['query'])
    answering = false
    expect(memory.read().meaning).toMatchObject({ lines: { done: 0, total: 1 }, facts: { done: 0, total: 1 } })
  })
})

describe('recall and search, by keyword and by meaning', () => {
  /** A log in English, and a question in French that shares no word with it. */
  function remembered(options: Setup) {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'I parked the car on level three.', '2026-11-10T09:00:00.000Z')
    say(records, 'The plumber comes on Thursday about the leak.', '2026-11-12T09:00:00.000Z')
    // About two things at once, so near neither in meaning.
    say(records, 'The plumber parked his van in front of the car wash.', '2026-11-13T09:00:00.000Z')
    const made = setup({ ...options, records })
    made.memory.remember('The user drinks green tea.')
    return made
  }
  const ready = async (made: ReturnType<typeof setup>) => {
    await sleep(made.memory)
    return made
  }
  const questions = ['Où est garée la voiture ?', 'Has the plumber called back?', 'Quel thé je bois ?', 'plumber van']

  const keywordAlone = remembered({})
  const today = async (question: string) => ({
    recalled: await keywordAlone.memory.recall(question),
    searched: (await searchTool(keywordAlone.memory)?.run({ query: question }))?.text
  })

  const regressions: Array<{ name: string; made: () => Promise<ReturnType<typeof setup>>; late?: boolean }> = [
    { name: 'with no model downloaded', made: async () => remembered({ embedder: { state: { state: 'absent' } } }) },
    {
      name: 'with a model that cannot run here',
      made: async () => remembered({ embedder: { state: { state: 'unavailable', why: 'no runtime' } satisfies EmbedderState } })
    },
    { name: 'with nowhere to keep vectors', made: async () => remembered({ embedder: {}, vectors: { ok: false, why: 'no sqlite-vec' } }) },
    {
      name: 'with a model slower than the time it is given',
      made: async () => {
        // The first call makes the vectors while asleep; every one after it never answers.
        return ready(remembered({ embedder: { gate: (call) => (call > 1 ? new Promise<void>(() => undefined) : undefined) } }))
      },
      late: true
    }
  ]

  for (const { name, made, late } of regressions) {
    it(`gives exactly what keywords give ${name}`, async () => {
      const { memory, timers } = await made()
      for (const question of questions) {
        const recalling = memory.recall(question)
        if (late) timers.advance(150)
        const searching = searchTool(memory)?.run({ query: question })
        if (late) timers.advance(2000)
        expect({ recalled: await recalling, searched: (await searching)?.text }).toEqual(await today(question))
      }
    })
  }

  it('recalls what was said in another language, and puts first what both searches found', async () => {
    const { memory, model } = await ready(remembered({ embedder: {} }))

    const car = await memory.recall('Où est garée la voiture ?')
    expect(car).toContain('in conversation: "I parked the car on level three.')
    expect(car).not.toContain('plumber')
    expect(model?.calls.at(-1)).toEqual({ texts: ['Où est garée la voiture ?'], use: 'query' })

    const plumber = await memory.recall('Has the plumber called back?')
    const lines = plumber?.split('\n').filter((line) => line.includes('in conversation')) ?? []
    // Found by both its words and its meaning, the line about the leak comes before the more recent one found by a word alone.
    expect(lines[0]).toContain('The plumber comes on Thursday about the leak.')
    expect(lines[1]).toContain('The plumber parked his van')

    expect(await memory.recall('Quel thé je bois ?')).toContain('- The user drinks green tea.')
    expect(await memory.recall('Tell me a joke')).toBeUndefined()
  })

  it('searches by meaning when the model asks, and waits for it longer', async () => {
    const { memory } = await ready(remembered({ embedder: {} }))
    const found = await searchTool(memory)?.run({ query: 'la voiture' })
    expect(found?.text).toContain('I parked the car on level three.')
    expect((await searchTool(memory)?.run({ query: 'thé' }))?.text).toContain('The user drinks green tea.')
  })
})

describe('the Memory page’s row', () => {
  it('offers the model, downloads it when asked, and counts what can be found by meaning', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'I parked the car on level three.')
    const middle = held()
    const { memory, events } = setup({ records, embedder: { state: { state: 'absent' }, downloading: () => middle.promise } })
    expect(memory.read().meaning).toEqual({ state: 'absent', model: { name: 'scripted-model', bytes: 1000, source: 'the test', licence: 'MIT' } })

    const view = await memory.installMeaning()
    expect(view.meaning).toMatchObject({ state: 'downloading', received: 0, total: 1000 })
    middle.release()
    await vi.waitFor(() => expect(memory.read().meaning?.state).toBe('ready'))
    expect(events.at(-1)).toMatchObject({ name: 'memory.changed', memory: { meaning: { state: 'ready', lines: { done: 0, total: 1 } } } })

    await sleep(memory)
    expect(memory.read().meaning).toMatchObject({ state: 'ready', lines: { done: 1, total: 1 } })
  })

  it('stops a download when told, and says why one failed', async () => {
    const middle = held()
    const stopped = setup({ embedder: { state: { state: 'absent' }, downloading: () => middle.promise } })
    await stopped.memory.installMeaning()
    const cancelling = stopped.memory.cancelMeaning()
    middle.release()
    expect((await cancelling).meaning).toMatchObject({ state: 'absent' })
    expect((await cancelling).meaning).not.toHaveProperty('failed')

    const failing = setup({ embedder: { state: { state: 'absent' }, failure: 'The server could not be reached.' } })
    await failing.memory.installMeaning()
    await vi.waitFor(() => expect(failing.memory.read().meaning).toMatchObject({ state: 'absent', failed: 'The server could not be reached.' }))
  })

  it('removes the model and every vector', async () => {
    const records = memoryRecords({ now: () => NOW })
    say(records, 'I parked the car on level three.')
    const { memory, model, vectors } = setup({ records, embedder: {} })
    await sleep(memory)
    expect(vectors.count('scripted-model')).toEqual([{ type: EXCHANGE, total: 1, done: 1 }])

    const view = await memory.removeMeaning()

    expect(model?.removed).toBe(1)
    expect(view.meaning).toMatchObject({ state: 'absent' })
    expect(vectors.count('scripted-model')).toEqual([{ type: EXCHANGE, total: 1, done: 0 }])
  })

  it('says why it is not available, in the core’s words', () => {
    const noPlace = setup({ embedder: {}, vectors: { ok: false, why: 'sqlite-vec could not be loaded' } })
    expect(noPlace.memory.read().meaning).toMatchObject({
      state: 'unavailable',
      why: 'Search by meaning is not available on this computer: sqlite-vec could not be loaded.'
    })
    const noRuntime = setup({ embedder: { state: { state: 'unavailable', why: 'its runtime could not be started' } } })
    expect(noRuntime.memory.read().meaning).toMatchObject({ why: 'Search by meaning is not available on this computer: its runtime could not be started.' })
    expect(setup().memory.read()).not.toHaveProperty('meaning')
  })
})
