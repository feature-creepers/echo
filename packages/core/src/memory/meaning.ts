import type { Meaning } from '@repo/protocol'
import { EXCHANGE } from '../channel/channel.ts'
import type { Timers } from '../ports/clock.ts'
import type { Embedder } from '../ports/embedder.ts'
import type { Signal } from '../ports/harness.ts'
import type { Log } from '../ports/log.ts'
import type { SearchHit } from '../ports/search.ts'
import type { NearestQuery, Vectors } from '../ports/vectors.ts'
import { EARLIER_LINE } from './earlier.ts'
import { FACT } from './facts.ts'

/**
 * Search by meaning (docs/SPEC.md, sections 10.4 to 10.7): the model, where the vectors are kept, and what the memory
 * asks of both. Whatever is missing, a model not ready, no place for vectors, a vector that comes too late, makes
 * nothing here: recall and search then answer by keyword alone.
 */

/** How many records' texts are given to the model at once while asleep. */
const BATCH = 32
/** How often a download's progress is announced. */
const PROGRESS_MS = 500

/** A signal the core makes and stops itself: it runs where AbortController may not exist. */
export interface Stopper {
  signal: Signal
  stop(): void
}

export function stopper(): Stopper {
  const listeners = new Set<() => void>()
  let aborted = false
  return {
    signal: {
      get aborted() {
        return aborted
      },
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener)
    },
    stop() {
      if (aborted) return
      aborted = true
      for (const listener of [...listeners]) listener()
    }
  }
}

interface MeaningOptions {
  embedder?: Embedder | undefined
  vectors?: Vectors | undefined
  /** Left out, nothing waits for a vector: there is no way to keep to a budget. */
  timers?: Timers | undefined
  log: Log
  now: () => Date
  /** What the Memory page shows of it changed. */
  changed(): void
}

export interface MeaningSearch {
  /** What the Memory page shows. Nothing when the core has no model to offer. */
  view(): Meaning | undefined
  /** Start the model's download. Resolves once it has started, or could not. */
  install(): Promise<void>
  /** Stop the download, and wait until it has stopped. */
  cancel(): Promise<void>
  /** Delete the model and every vector. */
  remove(): Promise<void>
  /** The vector of what was said, made within `waitMs`. Nothing past it, or when search by meaning cannot be used. */
  vectorOf(text: string, waitMs: number): Promise<Float32Array | undefined>
  /** The records nearest in meaning to a vector of `vectorOf`, their score the similarity. Nothing when they cannot be read. */
  nearest(vector: Float32Array, query: Omit<NearestQuery, 'model' | 'vector'>): SearchHit[]
  /** Give a vector to each record that has none, the newest first, until `signal` stops it. */
  embedMissing(signal: Signal): Promise<void>
}

export function createMeaningSearch({ embedder, vectors, timers, log, now, changed }: MeaningOptions): MeaningSearch {
  let downloading: { stop: Stopper; done: Promise<void> } | undefined
  let failed: string | undefined

  const usable = (): boolean => embedder?.state().state === 'ready' && vectors?.available().ok === true
  const problem = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const notHere = (why: string) => `Search by meaning is not available on this computer: ${why}.`

  const counted = (model: string) => {
    const lines = { done: 0, total: 0 }
    const facts = { done: 0, total: 0 }
    for (const { type, done, total } of vectors?.count(model) ?? []) {
      const kind = type === FACT ? facts : type === EXCHANGE || type === EARLIER_LINE ? lines : undefined
      if (!kind) continue
      kind.done += done
      kind.total += total
    }
    return { lines, facts }
  }

  return {
    view() {
      if (!embedder) return undefined
      const model = embedder.about
      const place = vectors?.available() ?? { ok: false, why: 'there is nowhere to keep vectors' }
      if (!place.ok) return { state: 'unavailable', model, why: notHere(place.why) }
      const stands = embedder.state()
      switch (stands.state) {
        case 'unavailable':
          return { state: 'unavailable', model, why: notHere(stands.why) }
        case 'downloading':
          return { state: 'downloading', model, received: stands.received, total: stands.total }
        case 'ready':
          return { state: 'ready', model, ...counted(embedder.model) }
        case 'absent':
          return { state: 'absent', model, ...(failed === undefined ? {} : { failed }) }
      }
    },

    install() {
      const kept = vectors
      if (!embedder || !kept?.available().ok || downloading || embedder.state().state !== 'absent') return Promise.resolve()
      const stop = stopper()
      failed = undefined
      let started = () => {}
      const begun = new Promise<void>((resolve) => {
        started = resolve
      })
      let shown = 0
      const done = embedder
        .install((state) => {
          started()
          const at = now().getTime()
          if (state.state === 'downloading' && at - shown < PROGRESS_MS) return
          shown = at
          changed()
        }, stop.signal)
        .then(
          // Vectors of a model used before this one are of no use with it.
          () => kept.keepOnly(embedder.model),
          (error: unknown) => {
            if (stop.signal.aborted) return
            failed = problem(error)
            log.error(`The model of search by meaning could not be downloaded: ${failed}`)
          }
        )
        .finally(() => {
          if (downloading?.stop === stop) downloading = undefined
          started()
          changed()
        })
      downloading = { stop, done }
      return begun
    },

    async cancel() {
      const was = downloading
      was?.stop.stop()
      await was?.done
    },

    async remove() {
      if (!embedder) return
      const was = downloading
      was?.stop.stop()
      await was?.done
      await embedder.remove()
      vectors?.clear()
      failed = undefined
      changed()
    },

    async vectorOf(text, waitMs) {
      if (!embedder || !timers || !usable()) return undefined
      const stop = stopper()
      let cancel = () => {}
      const late = new Promise<undefined>((resolve) => {
        cancel = timers.after(waitMs, () => {
          stop.stop()
          resolve(undefined)
        })
      })
      const made = embedder.embed([text], 'query', stop.signal).then(
        ([vector]) => vector,
        (error: unknown) => {
          if (stop.signal.aborted) return undefined
          log.error(`What was said could not be searched by meaning: ${problem(error)}`)
          // The model may have turned out unable to run here: the Memory page says so.
          if (embedder.state().state !== 'ready') changed()
          return undefined
        }
      )
      const vector = await Promise.race([made, late])
      cancel()
      return vector
    },

    nearest(vector, query) {
      if (!embedder || !vectors) return []
      try {
        return vectors.nearest({ ...query, model: embedder.model, vector })
      } catch (error) {
        log.error(`Memory could not be searched by meaning: ${problem(error)}`)
        return []
      }
    },

    async embedMissing(signal) {
      if (!embedder || !vectors || !usable()) return
      vectors.keepOnly(embedder.model)
      while (!signal.aborted) {
        const batch = vectors.missing(embedder.model, BATCH)
        if (batch.length === 0) return
        let made: Float32Array[]
        try {
          made = await embedder.embed(
            batch.map(({ text }) => text),
            'passage',
            signal
          )
        } catch (error) {
          if (signal.aborted) return
          // What is left waits for the next sleep.
          log.error(`Sleep stopped making vectors: ${problem(error)}`)
          changed()
          return
        }
        if (signal.aborted) return
        vectors.put(
          embedder.model,
          batch.map(({ record }, index) => ({ record, vector: made[index] as Float32Array }))
        )
        changed()
      }
    }
  }
}
