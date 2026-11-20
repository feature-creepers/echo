import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bytesOf, E5_SMALL, PARAKEET, SILERO, SPEECH_SETS, SUPERTONIC } from './catalogue.ts'
import { installModelSet, isInstalled } from './download.ts'
import type { DownloadProgress } from './model-set.ts'

const EVERY_SET = [...SPEECH_SETS, E5_SMALL]

describe('the catalogue', () => {
  it('lists one set for each thing speech needs, and keeps the model for search by meaning apart', () => {
    expect(SPEECH_SETS.map((set) => set.purpose).sort()).toEqual(['recognition', 'speech-detection', 'voice'])
    expect(new Set(EVERY_SET.map((set) => set.id)).size).toBe(EVERY_SET.length)
  })

  it('names folders and files that every system accepts', () => {
    for (const set of EVERY_SET) {
      expect(set.id).toMatch(/^[a-z0-9][a-z0-9.-]*$/)
      expect(new Set(set.files.map((file) => file.path)).size).toBe(set.files.length)
      for (const file of set.files) expect(file.path).toMatch(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)
    }
  })

  it('records a size and a SHA-256 for every file, at an address that cannot change under them', () => {
    for (const set of EVERY_SET) {
      for (const file of set.files) {
        expect(file.bytes).toBeGreaterThan(0)
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
        // One commit of the repository, never a branch: a branch can move to other bytes.
        expect(file.url).toMatch(/^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[0-9a-f]{40}\//)
        expect(file.url.endsWith(`/${file.path}`)).toBe(true)
      }
    }
  })

  it('says how much each set weighs', () => {
    expect(bytesOf(SILERO)).toBe(2_313_101)
    expect(bytesOf(SUPERTONIC)).toBe(145_295_768)
    expect(bytesOf(PARAKEET)).toBe(670_576_784)
    expect(bytesOf(E5_SMALL)).toBe(135_392_183)
  })
})

/**
 * The real path, end to end, for the smallest set: its address in the catalogue, the host, the checks.
 * It needs the network, so it runs only when asked: MODELS_NETWORK=1 pnpm --filter @repo/models test
 */
describe.runIf(process.env.MODELS_NETWORK === '1')('downloading from the real host', () => {
  it('installs the speech detection set', { timeout: 120_000 }, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'models-network-'))
    try {
      const progress: DownloadProgress[] = []
      await installModelSet(folder, SILERO, { onProgress: (step) => progress.push(step) })

      expect(isInstalled(folder, SILERO)).toBe(true)
      expect(progress.at(-1)).toEqual({ set: SILERO.id, received: bytesOf(SILERO), total: bytesOf(SILERO) })
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})
