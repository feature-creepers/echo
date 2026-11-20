import type { Signal } from './harness.ts'

/**
 * What the core needs to search by meaning: a model that turns a text into a vector, so that texts that mean the
 * same thing, in any of the languages it reads, lie close together (docs/SPEC.md, section 10.4). The model is
 * downloaded once, when the person asks, and runs where it cannot delay the core.
 */

export type EmbedderState =
  | { state: 'absent' }
  /** Bytes received of the total. */
  | { state: 'downloading'; received: number; total: number }
  | { state: 'ready' }
  /** It cannot run on this computer, and why, in words for the person. */
  | { state: 'unavailable'; why: string }

/**
 * What a text is to the model: what the person said, looked for (`query`), or a record's text, looked in
 * (`passage`). Some models, such as e5, read the two differently.
 */
export type EmbeddingUse = 'query' | 'passage'

export interface Embedder {
  /** The name kept with every vector it makes. Vectors of another name are never compared with its own. */
  model: string
  /** How many numbers each vector has. */
  dimensions: number
  /** What the person is told before downloading it. */
  about: { name: string; bytes: number; source: string; licence: string }
  state(): EmbedderState
  /**
   * Download it, continuing what an earlier download left. Told of each step. Resolves once it is ready; rejects with
   * a message for the person, or when `signal` stops it.
   */
  install(onProgress: (state: EmbedderState) => void, signal: Signal): Promise<void>
  /** Delete it, with whatever was received of it. */
  remove(): Promise<void>
  /**
   * One vector for each text, normalised, in the same order. Rejects when it is not ready, when it cannot run, or
   * when `signal` stops it.
   */
  embed(texts: readonly string[], use: EmbeddingUse, signal?: Signal): Promise<Float32Array[]>
}
