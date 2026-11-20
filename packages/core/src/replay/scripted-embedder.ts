import type { Embedder, EmbedderState, EmbeddingUse } from '../ports/embedder.ts'

export interface ScriptedEmbedderOptions {
  /** The vector of a text, as the test means it. */
  meaningOf: (text: string) => Float32Array
  /** Where it starts. Left out, ready. */
  state?: EmbedderState
  /** Waited for before each call to `embed` is answered, by its number from 1: how a test holds a call back. */
  gate?: (call: number) => Promise<void> | undefined
  /** Waited for once the download has started: how a test holds it in the middle. */
  downloading?: () => Promise<void>
  /** Makes the download fail with this message. */
  failure?: string
}

export interface ScriptedEmbedder extends Embedder {
  /** Every call to `embed`, in order. */
  calls: Array<{ texts: readonly string[]; use: EmbeddingUse }>
  /** Every call to `remove`. */
  removed: number
}

const DOWNLOAD = 1000

/** A model whose vectors the test decides, whose download takes no time unless held. For tests of the memory. */
export function scriptedEmbedder({ meaningOf, state: initial = { state: 'ready' }, gate, downloading, failure }: ScriptedEmbedderOptions): ScriptedEmbedder {
  let state = initial
  const calls: ScriptedEmbedder['calls'] = []
  const embedder: ScriptedEmbedder = {
    model: 'scripted-model',
    dimensions: 4,
    about: { name: 'scripted-model', bytes: DOWNLOAD, source: 'the test', licence: 'MIT' },
    calls,
    removed: 0,
    state: () => state,
    async install(onProgress, signal) {
      state = { state: 'downloading', received: 0, total: DOWNLOAD }
      onProgress(state)
      await downloading?.()
      if (signal.aborted || failure !== undefined) {
        state = { state: 'absent' }
        throw new Error(signal.aborted ? 'Stopped.' : failure)
      }
      state = { state: 'ready' }
      onProgress(state)
    },
    async remove() {
      embedder.removed++
      state = { state: 'absent' }
    },
    async embed(texts, use, signal) {
      if (state.state !== 'ready') throw new Error('Not ready.')
      calls.push({ texts: [...texts], use })
      await gate?.(calls.length)
      if (signal?.aborted) throw new Error('Stopped.')
      return texts.map(meaningOf)
    }
  }
  return embedder
}
