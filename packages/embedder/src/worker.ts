import { parentPort, workerData } from 'node:worker_threads'
import type { FromWorker, ToWorker, WorkerSetup } from './messages.ts'

/**
 * The worker that runs the model, so the core's own thread never waits for it: ONNX Runtime blocks the thread that
 * runs a model until it is done. Requests are answered one at a time, in order; one dropped before its turn is skipped.
 */

const port = parentPort
if (!port) throw new Error('This script runs as a worker thread.')
const setup = workerData as WorkerSetup
const send = (message: FromWorker) => port.postMessage(message)
const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

try {
  // Loaded here only, never in the core's thread.
  const { env, pipeline } = await import('@huggingface/transformers')
  send({ type: 'loaded' })
  if (!setup.probe) {
    // Only what is in the model folder: transformers.js fetches nothing by itself.
    env.allowRemoteModels = false
    env.localModelPath = setup.folder
    env.cacheDir = setup.folder
    const extract = await pipeline('feature-extraction', setup.model, { dtype: 'q8', session_options: { intraOpNumThreads: setup.threads } })
    send({ type: 'ready' })

    const queue: Array<{ id: number; texts: string[] }> = []
    let busy = false
    const work = async () => {
      if (busy) return
      busy = true
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const output = await extract(next.texts, { pooling: 'mean', normalize: true })
          send({ type: 'embedded', id: next.id, vectors: output.data as Float32Array })
        } catch (error) {
          send({ type: 'failed', id: next.id, message: failure(error) })
        }
      }
      busy = false
    }
    port.on('message', (message: ToWorker) => {
      if (message.type === 'drop') {
        const at = queue.findIndex((request) => request.id === message.id)
        if (at >= 0) queue.splice(at, 1)
        return
      }
      queue.push({ id: message.id, texts: message.texts })
      void work()
    })
  }
} catch (error) {
  send({ type: 'failed', message: failure(error) })
}
