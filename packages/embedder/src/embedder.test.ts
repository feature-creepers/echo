import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmbedderState, Signal } from '@repo/core'
import { E5_SMALL, type ModelSet, modelSetFolder } from '@repo/models'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmbedder, type EmbedderOptions, type LocalEmbedder } from './embedder.ts'

const ECHO = new URL('../test/echo-worker.ts', import.meta.url)
const BROKEN = new URL('../test/broken-worker.ts', import.meta.url)

/** A set shaped as the model's, whose one small file is served from its own address, with no network. */
const CONFIG = Buffer.from('{"model_type":"bert"}')
const SET: ModelSet = {
  ...E5_SMALL,
  id: 'test-model',
  files: [
    {
      path: 'config.json',
      url: `data:application/json;base64,${CONFIG.toString('base64')}`,
      bytes: CONFIG.length,
      sha256: createHash('sha256').update(CONFIG).digest('hex')
    }
  ]
}

const folders: string[] = []
const made: LocalEmbedder[] = []
afterEach(async () => {
  for (const embedder of made.splice(0)) await embedder.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
})

function embedder(options: Partial<EmbedderOptions> = {}): LocalEmbedder {
  const folder = mkdtempSync(join(tmpdir(), 'embedder-test-'))
  folders.push(folder)
  const created = createEmbedder({ folder, log: { error: () => undefined }, worker: ECHO, set: SET, ...options })
  made.push(created)
  return created
}

/** A signal a test stops by hand, of the kind the core makes. */
function stoppable() {
  const listeners = new Set<() => void>()
  let aborted = false
  const signal: Signal = {
    get aborted() {
      return aborted
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener)
  }
  return {
    signal,
    stop() {
      aborted = true
      for (const listener of [...listeners]) listener()
    }
  }
}

async function installed(options: Partial<EmbedderOptions> = {}): Promise<LocalEmbedder> {
  const ready = embedder(options)
  await ready.install(() => undefined, stoppable().signal)
  return ready
}

/** What the echo worker read: the characters it was sent. */
const textOf = (vector: Float32Array | undefined) => String.fromCharCode(...(vector ?? []).slice(0, 383).filter((code) => code !== 0))

describe('the embedder', () => {
  it('names the model and its vectors, and what the person is told of it', () => {
    const model = createEmbedder({ folder: tmpdir(), log: { error: () => undefined } })
    expect(model).toMatchObject({
      model: 'multilingual-e5-small-q8',
      dimensions: 384,
      about: { name: 'multilingual-e5-small', bytes: 135_392_183, source: 'Hugging Face', licence: 'MIT' }
    })
  })

  it('downloads the model once its runtime is seen to start here, and says how far it has got', async () => {
    const model = embedder()
    const steps: EmbedderState[] = []
    expect(model.state()).toEqual({ state: 'absent' })

    await model.install((step) => steps.push(step), stoppable().signal)

    expect(steps[0]).toEqual({ state: 'downloading', received: 0, total: CONFIG.length })
    expect(steps.at(-1)).toEqual({ state: 'ready' })
    expect(model.state()).toEqual({ state: 'ready' })
  })

  it('is unavailable where its runtime cannot start, and downloads nothing there', async () => {
    const model = embedder({ worker: BROKEN })

    await expect(model.install(() => undefined, stoppable().signal)).rejects.toThrow('no build for this system')

    expect(model.state()).toEqual({ state: 'unavailable', why: 'its runtime could not be started (onnxruntime-node has no build for this system)' })
    await expect(model.install(() => undefined, stoppable().signal)).rejects.toThrow('could not be started')
  })

  it('stops a download when told, and is absent again', async () => {
    const model = embedder()
    const stop = stoppable()

    await expect(
      model.install((step) => {
        if (step.state === 'downloading') stop.stop()
      }, stop.signal)
    ).rejects.toThrow()

    expect(model.state()).toEqual({ state: 'absent' })
  })

  it('removes the model, with its folder', async () => {
    const model = await installed()
    const folder = folders.at(-1) as string
    expect(existsSync(modelSetFolder(folder, SET))).toBe(true)

    await model.remove()

    expect(model.state()).toEqual({ state: 'absent' })
    expect(existsSync(modelSetFolder(folder, SET))).toBe(false)
    await expect(model.embed(['anything'], 'query')).rejects.toThrow('not ready')
  })

  it('reads what the person said as a query, and a record’s text as a passage, as e5 was trained to', async () => {
    const model = await installed()
    const cases = [
      { use: 'query', text: 'Où est garée la voiture ?', sent: 'query: Où est garée la voiture ?' },
      { use: 'passage', text: 'I parked the car on level three.', sent: 'passage: I parked the car on level three.' }
    ] as const
    for (const { use, text, sent } of cases) {
      const [vector] = await model.embed([text], use)
      expect(textOf(vector), use).toBe(sent)
      expect(vector).toHaveLength(384)
    }
    const both = await model.embed(['one', 'two'], 'passage')
    expect(both.map(textOf)).toEqual(['passage: one', 'passage: two'])
  })

  it('gives up a request no longer waited for, and answers the next', async () => {
    const model = await installed()
    const stop = stoppable()
    stop.stop()

    await expect(model.embed(['dropped'], 'query', stop.signal)).rejects.toThrow('Stopped')
    expect((await model.embed(['next'], 'query')).map(textOf)).toEqual(['query: next'])
  })

  it('closes its worker once idle, and starts it again for the next texts', async () => {
    const model = await installed({ idleMs: 50 })
    const thread = async () => (await model.embed(['x'], 'query'))[0]?.[383]

    const first = await thread()
    expect(await thread()).toBe(first)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await thread()).not.toBe(first)
  })
})
