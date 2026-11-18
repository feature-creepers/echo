import { describe, expect, it } from 'vitest'
import { loadSherpa } from './sherpa.ts'

/**
 * The native library is built separately for each system and processor. These tests need no model: they
 * check that the build for the system they run on is installed, loads, and computes.
 */
describe('the native speech library', () => {
  it('loads on this system', () => {
    const sherpa = loadSherpa()

    expect(sherpa.version).toMatch(/^2\.\d+\.\d+$/)
    expect(loadSherpa()).toBe(sherpa)
    for (const part of ['OfflineRecognizer', 'OfflineTts', 'Vad', 'LinearResampler'] as const) expect(sherpa[part], part).toBeTypeOf('function')
    expect(sherpa.OfflineRecognizer.createAsync).toBeTypeOf('function')
    expect(sherpa.OfflineTts.createAsync).toBeTypeOf('function')
  })

  it('runs native code: one second of sound at 48 kHz becomes one second at 16 kHz', () => {
    const { LinearResampler } = loadSherpa()
    const tone = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin((2 * Math.PI * 440 * index) / 48_000))

    const converted = new LinearResampler(48_000, 16_000).flush(tone)

    expect(converted).toBeInstanceOf(Float32Array)
    expect(Math.abs(converted.length - 16_000)).toBeLessThanOrEqual(1)
    // Still the same tone: as loud, and crossing zero as often.
    const loudest = converted.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0)
    expect(loudest).toBeGreaterThan(0.9)
    expect(loudest).toBeLessThan(1.1)
    let crossings = 0
    for (let index = 1; index < converted.length; index++) if ((converted[index - 1] as number) < 0 !== (converted[index] as number) < 0) crossings++
    expect(Math.abs(crossings - 880)).toBeLessThanOrEqual(4)
  })
})
