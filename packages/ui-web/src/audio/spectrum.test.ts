import { describe, expect, it } from 'vitest'
import { bandsOf, HIGHEST, LOWEST } from './spectrum.ts'

/** An analyser's spectrum at 48 kHz with 512 bins, silent but for a tone at each frequency given, as loud as given. */
function spectrumWith(tones: { hertz: number; decibels: number }[]): Float32Array {
  const bins = new Float32Array(512).fill(-140)
  const width = 48_000 / 2 / bins.length
  for (const { hertz, decibels } of tones) bins[Math.round(hertz / width)] = decibels
  return bins
}

const bandOf = (hertz: number, count: number) => Math.floor((Math.log(hertz / LOWEST) / Math.log(HIGHEST / LOWEST)) * count)

describe("a voice's spectrum in bands", () => {
  it.each([
    { case: 'a low vowel', hertz: 180 },
    { case: 'a formant', hertz: 900 },
    { case: 'a hiss', hertz: 5200 }
  ])('$case lights its own band', ({ hertz }) => {
    const bands = bandsOf(spectrumWith([{ hertz, decibels: -40 }]), 48_000, new Float32Array(16))
    const loudest = bands.indexOf(Math.max(...bands))
    expect(loudest).toBe(bandOf(hertz, 16))
    expect(bands[loudest]).toBeGreaterThan(0.8)
  })

  it('is silent in silence, and full when loud, never past either end', () => {
    expect(bandsOf(new Float32Array(512).fill(-140), 48_000, new Float32Array(16)).every((band) => band === 0)).toBe(true)
    const loud = bandsOf(new Float32Array(512).fill(0), 48_000, new Float32Array(16))
    expect(loud.every((band) => band === 1)).toBe(true)
  })

  it('lifts the high notes, which a voice says far more quietly', () => {
    const even = bandsOf(
      spectrumWith([
        { hertz: 150, decibels: -60 },
        { hertz: 6000, decibels: -60 }
      ]),
      48_000,
      new Float32Array(16)
    )
    expect(even[bandOf(6000, 16)] ?? 0).toBeGreaterThan(even[bandOf(150, 16)] ?? 0)
  })
})
