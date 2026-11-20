import { parentPort } from 'node:worker_threads'
import type { FromWorker } from '../src/messages.ts'

/** Stands for the real worker on a system its runtime has no build for. */
parentPort?.postMessage({ type: 'failed', message: 'onnxruntime-node has no build for this system' } satisfies FromWorker)
