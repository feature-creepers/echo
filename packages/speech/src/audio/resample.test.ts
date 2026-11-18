import { describe, expect, it } from 'vitest'
import type { Sound } from '../ports.ts'
import { SpeechError } from '../speech-error.ts'
import { atHearingRate, checkSound, createPieceResampler, HEARING_RATE } from './resample.ts'

const tone = (sampleRate: number, seconds: number): Sound => ({
  sampleRate,
  samples: Float32Array.from({ length: sampleRate * seconds }, (_, index) => Math.sin((2 * Math.PI * 220 * index) / sampleRate))
})

describe('bringing sound to the rate engines hear at', () => {
  it('leaves alone a sound already at that rate, and an empty one', () => {
    const already = tone(HEARING_RATE, 1)
    expect(atHearingRate(already)).toBe(already.samples)

    const empty: Sound = { sampleRate: 44_100, samples: new Float32Array(0) }
    expect(atHearingRate(empty)).toBe(empty.samples)
  })

  it.each([8_000, 22_050, 44_100, 48_000, 96_000])('converts a sound at %i samples per second', (rate) => {
    const converted = atHearingRate(tone(rate, 2))

    expect(Math.abs(converted.length - 2 * HEARING_RATE)).toBeLessThanOrEqual(2)
    expect(converted.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 1.2)).toBe(true)
  })

  it('converts a sound that comes in pieces into the same samples as the whole', () => {
    const whole = tone(44_100, 1)
    const pieces = createPieceResampler(44_100)
    expect(pieces.from).toBe(44_100)

    const parts: Float32Array[] = []
    for (let at = 0; at < whole.samples.length; at += 4_410) parts.push(pieces.next(whole.samples.subarray(at, at + 4_410)))
    parts.push(pieces.last())
    const joined = parts.flatMap((part) => Array.from(part))

    const atOnce = Array.from(atHearingRate(whole))
    expect(joined.length).toBe(atOnce.length)
    expect(joined.every((sample, index) => Math.abs(sample - (atOnce[index] as number)) < 1e-4)).toBe(true)

    // Ready for another sound once the first is over.
    expect(Math.abs(pieces.next(whole.samples).length + pieces.last().length - HEARING_RATE)).toBeLessThanOrEqual(2)
  })

  it('passes pieces through untouched when they are at the right rate', () => {
    const pieces = createPieceResampler(HEARING_RATE)
    const piece = new Float32Array([0.1, 0.2])

    expect(pieces.next(piece)).toBe(piece)
    expect(pieces.last().length).toBe(0)
  })

  it('refuses what is not a sound, in words', () => {
    expect(() => checkSound({ sampleRate: 0, samples: new Float32Array(1) })).toThrow(SpeechError)
    expect(() => checkSound({ sampleRate: 44_100.5, samples: new Float32Array(1) })).toThrow(
      'A sound must have a whole number of samples per second: 44100.5 is not one.'
    )
    expect(() => checkSound({ sampleRate: 16_000, samples: [0, 1] as unknown as Float32Array })).toThrow(
      'A sound must hold its samples as 32-bit floating-point numbers.'
    )
    const good: Sound = { sampleRate: 16_000, samples: new Float32Array(1) }
    expect(checkSound(good)).toBe(good)
  })
})
