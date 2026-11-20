/** What the adapter and its worker say to each other. */

/** What the worker is started with. */
export interface WorkerSetup {
  /** The model folder, where the set's folder is. */
  folder: string
  /** The set's folder in it, which transformers.js reads as the model's name. */
  model: string
  /** How many processor threads ONNX Runtime may use. */
  threads: number
  /** Only load the library and say so: whether the runtime runs on this computer. */
  probe: boolean
}

export type ToWorker = { type: 'embed'; id: number; texts: string[] } | { type: 'drop'; id: number }

export type FromWorker =
  /** transformers.js and ONNX Runtime loaded. */
  | { type: 'loaded' }
  /** The model loaded: texts can be sent. */
  | { type: 'ready' }
  /** The vectors of a request, one after the other in one array. */
  | { type: 'embedded'; id: number; vectors: Float32Array }
  /** A request failed, or, with no request, the worker could not start. */
  | { type: 'failed'; id?: number; message: string }
