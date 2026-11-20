import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { Embedder, EmbedderState, EmbeddingUse, Log, Signal } from '@repo/core'
import { bytesOf, detectTier, E5_SMALL, installModelSet, isInstalled, type ModelSet, removeModelSet } from '@repo/models'
import type { FromWorker, ToWorker, WorkerSetup } from './messages.ts'

/** The name kept with every vector: the model, and the weights it runs with. */
const MODEL = 'multilingual-e5-small-q8'
const DIMENSIONS = 384

/** How long the worker, with the model it holds, stays with nothing to do. */
const IDLE_MS = 5 * 60_000

/** What e5 was trained to read before a text: what is looked for, and what is looked in. */
const PREFIXES: Record<EmbeddingUse, string> = { query: 'query: ', passage: 'passage: ' }

export interface EmbedderOptions {
  /** The core's model folder, in its data folder: `<data>/models`. */
  folder: string
  log: Log
  /** How long the worker stays with nothing to do. Left out, five minutes. */
  idleMs?: number
  /** The worker's script. Left out, the one beside this module. */
  worker?: URL
  /** The model's files. Left out, multilingual-e5-small's. */
  set?: ModelSet
}

/** The adapter, and what only its host calls: stopping the worker when the core stops. */
export interface LocalEmbedder extends Embedder {
  close(): Promise<void>
}

/** The worker, while it runs. */
interface Running {
  worker: Worker
  /** Resolves once it can take texts; rejects with why it cannot. */
  ready: Promise<void>
  waiting: Map<number, { resolve: (vectors: Float32Array) => void; reject: (error: Error) => void }>
}

/**
 * multilingual-e5-small, run by transformers.js on ONNX Runtime in a worker thread of the core's process
 * (docs/SPEC.md, section 10.4). The model is downloaded into the core's model folder when the person asks, and the
 * worker is started when there are texts and closed once idle. One processor thread on the light tier, two otherwise,
 * so it never takes the processors speech needs.
 */
export function createEmbedder({ folder, log, idleMs = IDLE_MS, worker: script = workerScript(), set = E5_SMALL }: EmbedderOptions): LocalEmbedder {
  let state: EmbedderState = isInstalled(folder, set) ? { state: 'ready' } : { state: 'absent' }
  let running: Running | undefined
  let requests = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  const threads = detectTier() === 'light' ? 1 : 2

  const stop = async () => {
    clearTimeout(idle)
    const was = running
    running = undefined
    await was?.worker.terminate()
  }

  /** Start the worker: to load the model, or only to see that its runtime loads here. */
  const start = (probe: boolean): Running => {
    const setup: WorkerSetup = { folder, model: set.id, threads, probe }
    const worker = new Worker(script, { workerData: setup })
    // The worker never keeps the core's process alive on its own.
    worker.unref()
    const waiting: Running['waiting'] = new Map()
    let settle: { resolve: () => void; reject: (error: Error) => void } = { resolve: () => undefined, reject: () => undefined }
    const ready = new Promise<void>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // The caller may have stopped waiting before the worker fails: that failure must not go unhandled in the core.
    ready.catch(() => undefined)
    const run: Running = { worker, ready, waiting }

    const fail = (error: Error) => {
      settle.reject(error)
      for (const { reject } of waiting.values()) reject(error)
      waiting.clear()
      if (running === run) running = undefined
    }
    worker.on('message', (message: FromWorker) => {
      if (message.type === 'loaded' && probe) settle.resolve()
      else if (message.type === 'ready') settle.resolve()
      else if (message.type === 'embedded') {
        waiting.get(message.id)?.resolve(message.vectors)
        waiting.delete(message.id)
      } else if (message.type === 'failed') {
        const error = new Error(message.message)
        if (message.id === undefined) {
          fail(error)
          void worker.terminate()
        } else {
          waiting.get(message.id)?.reject(error)
          waiting.delete(message.id)
        }
      }
    })
    worker.on('error', fail)
    worker.on('exit', () => fail(new Error('The worker of search by meaning stopped.')))
    return run
  }

  /** The worker could not start: what it needs does not run on this computer. */
  const unavailable = (error: unknown) => {
    const why = `its runtime could not be started (${error instanceof Error ? error.message : String(error)})`
    state = { state: 'unavailable', why }
    log.error(`Search by meaning is not available: ${why}`)
  }

  const armIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(() => void stop(), idleMs)
    idle.unref()
  }

  return {
    model: MODEL,
    dimensions: DIMENSIONS,
    about: { name: 'multilingual-e5-small', bytes: bytesOf(set), source: 'Hugging Face', licence: set.licence },
    state: () => state,

    async install(onProgress, signal) {
      if (state.state === 'unavailable') throw new Error(state.why)
      if (state.state !== 'absent') return
      // A model that cannot run here is not downloaded: the runtime is loaded once first.
      const probe = start(true)
      try {
        await whenStopped(probe.ready, signal)
      } catch (error) {
        if (!signal.aborted) unavailable(error)
        throw error
      } finally {
        await probe.worker.terminate()
      }
      state = { state: 'downloading', received: 0, total: bytesOf(set) }
      onProgress(state)
      const controller = new AbortController()
      const abort = () => controller.abort(new Error('The download was stopped.'))
      signal.addEventListener('abort', abort, { once: true })
      try {
        await installModelSet(folder, set, {
          signal: controller.signal,
          onProgress: ({ received, total }) => {
            state = { state: 'downloading', received, total }
            onProgress(state)
          }
        })
        state = { state: 'ready' }
        onProgress(state)
      } catch (error) {
        state = { state: 'absent' }
        throw error
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },

    async remove() {
      await stop()
      await removeModelSet(folder, set)
      if (state.state !== 'unavailable') state = { state: 'absent' }
    },

    async embed(texts, use, signal) {
      if (state.state !== 'ready') throw new Error('The model for search by meaning is not ready.')
      if (texts.length === 0) return []
      const starting = !running
      const run = running ?? start(false)
      running = run
      clearTimeout(idle)
      try {
        await whenStopped(run.ready, signal)
      } catch (error) {
        if (starting && !signal?.aborted) unavailable(error)
        if (signal?.aborted) armIdle()
        throw error
      }
      const id = ++requests
      const answer = new Promise<Float32Array>((resolve, reject) => run.waiting.set(id, { resolve, reject }))
      run.worker.postMessage({ type: 'embed', id, texts: texts.map((text) => PREFIXES[use] + text) } satisfies ToWorker)
      try {
        const vectors = await whenStopped(answer, signal)
        if (vectors.length !== texts.length * DIMENSIONS) throw new Error(`The model gave ${vectors.length} numbers for ${texts.length} texts.`)
        return texts.map((_, index) => vectors.slice(index * DIMENSIONS, (index + 1) * DIMENSIONS))
      } catch (error) {
        // Not waited for any more: skipped if its turn has not come.
        if (signal?.aborted && run.waiting.delete(id)) run.worker.postMessage({ type: 'drop', id } satisfies ToWorker)
        throw error
      } finally {
        if (running === run && run.waiting.size === 0) armIdle()
      }
    },

    close: stop
  }
}

/** Wait for `work`, or reject as soon as `signal` stops it. */
function whenStopped<Value>(work: Promise<Value>, signal: Signal | undefined): Promise<Value> {
  if (!signal) return work
  if (signal.aborted) return Promise.reject(new Error('Stopped.'))
  return new Promise<Value>((resolve, reject) => {
    const stopped = () => reject(new Error('Stopped.'))
    signal.addEventListener('abort', stopped, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stopped))
  })
}

/**
 * The worker's script. The desktop app builds it beside the bundled core as `embedder-worker.js`
 * (electron.vite.config.ts); run from the sources, it is `worker.ts` beside this file.
 */
function workerScript(): URL {
  const built = new URL('./embedder-worker.js', import.meta.url)
  return existsSync(built) ? built : new URL('./worker.ts', import.meta.url)
}
