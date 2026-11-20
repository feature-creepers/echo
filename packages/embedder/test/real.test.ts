import { MEANING_FLOOR } from '@repo/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEmbedder, type LocalEmbedder } from '../src/index.ts'
import { SAME, UNRELATED } from './pairs.ts'

/**
 * The real model, run by transformers.js on ONNX Runtime in its worker. It runs where the model is, or is to be
 * downloaded (135 MB), into a folder of the tester's choosing:
 *
 *   EMBEDDER_MODELS=<folder> pnpm --filter @repo/embedder test
 */
const folder = process.env.EMBEDDER_MODELS ?? ''
const never = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined }

const dot = (one: Float32Array, other: Float32Array) => one.reduce((sum, value, index) => sum + value * (other[index] ?? 0), 0)

describe.runIf(folder !== '')('the real model', () => {
  let embedder: LocalEmbedder
  beforeAll(async () => {
    embedder = createEmbedder({ folder, log: { error: () => undefined } })
    if (embedder.state().state !== 'ready') await embedder.install(() => undefined, never)
  }, 900_000)
  afterAll(() => embedder.close())

  /** How alike what the person says is to what memory keeps, for each pair, as recall compares them. */
  const similarities = async (pairs: ReadonlyArray<[string, string]>) => {
    const queries = await embedder.embed(
      pairs.map(([query]) => query),
      'query'
    )
    const passages = await embedder.embed(
      pairs.map(([, passage]) => passage),
      'passage'
    )
    return pairs.map(([query], index) => ({ query, similarity: dot(queries[index] as Float32Array, passages[index] as Float32Array) }))
  }

  it('makes vectors of 384 numbers, of length one', async () => {
    const [vector] = await embedder.embed(['La voiture est garée au niveau trois.'], 'passage')
    expect(vector).toHaveLength(384)
    expect(Math.sqrt(dot(vector as Float32Array, vector as Float32Array))).toBeCloseTo(1, 4)
  })

  it('finds a sentence in the other language above the floor, and leaves an unrelated one under it', async () => {
    for (const { query, similarity } of await similarities(SAME)) expect(similarity, query).toBeGreaterThanOrEqual(MEANING_FLOOR)
    for (const { query, similarity } of await similarities(UNRELATED)) expect(similarity, query).toBeLessThan(MEANING_FLOOR)
  })
})
