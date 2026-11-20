import { parentPort, threadId, workerData } from 'node:worker_threads'
import type { FromWorker, ToWorker, WorkerSetup } from '../src/messages.ts'

/**
 * Stands for the real worker, with no model: each text comes back as a vector of its own characters, the last number
 * being the thread that read it.
 */
const port = parentPort
const setup = workerData as WorkerSetup
const send = (message: FromWorker) => port?.postMessage(message)
const DIMENSIONS = 384

send({ type: 'loaded' })
if (!setup.probe) {
  send({ type: 'ready' })
  port?.on('message', (message: ToWorker) => {
    if (message.type !== 'embed') return
    const vectors = new Float32Array(message.texts.length * DIMENSIONS)
    for (const [index, text] of message.texts.entries()) {
      for (let at = 0; at < Math.min(text.length, DIMENSIONS - 1); at++) vectors[index * DIMENSIONS + at] = text.charCodeAt(at)
      vectors[(index + 1) * DIMENSIONS - 1] = threadId
    }
    send({ type: 'embedded', id: message.id, vectors })
  })
}
