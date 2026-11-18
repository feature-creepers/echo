/**
 * A voice's spectrum, as the core shows it: a few bands from its low notes to its high ones, each from 0 to 1.
 * The bands are spaced as the ear hears, closer in the low notes, from the lowest of a voice to the hiss of its
 * consonants, and the high ones are lifted, since a voice has far less energy there and would otherwise not show.
 */

/** The lowest and highest notes the bands cover, in hertz. */
export const LOWEST = 90
export const HIGHEST = 7000

/** The quietest a band shows, and how much louder fills it, in decibels. */
const FLOOR = -88
const RANGE = 52

/** How much each band up is lifted, in decibels: the high notes of a voice are much quieter than its low ones. */
const TILT = 1.6

/**
 * The bands of a spectrum given in decibels, one value per bin of an analyser, as `AnalyserNode.getFloatFrequencyData`
 * gives it. Each band takes the loudest bin it covers, so a vowel's formant shows whole.
 */
export function bandsOf(decibels: ArrayLike<number>, sampleRate: number, into: Float32Array): Float32Array {
  const bins = decibels.length
  const binWidth = sampleRate / 2 / Math.max(1, bins)
  const count = into.length
  for (let band = 0; band < count; band++) {
    const low = LOWEST * (HIGHEST / LOWEST) ** (band / count)
    const high = LOWEST * (HIGHEST / LOWEST) ** ((band + 1) / count)
    // A bin belongs to the band its middle falls in; a band narrower than a bin, low down, reads the bin nearest it.
    let first = Math.max(0, Math.ceil(low / binWidth))
    let last = Math.min(bins - 1, Math.ceil(high / binWidth) - 1)
    if (first > last) {
      first = Math.min(bins - 1, Math.round(Math.sqrt(low * high) / binWidth))
      last = first
    }
    let loudest = Number.NEGATIVE_INFINITY
    for (let bin = first; bin <= last; bin++) loudest = Math.max(loudest, decibels[bin] ?? Number.NEGATIVE_INFINITY)
    const lifted = loudest + band * TILT
    into[band] = Number.isFinite(lifted) ? Math.min(1, Math.max(0, (lifted - FLOOR) / RANGE)) : 0
  }
  return into
}

/** Reads an analyser's spectrum now into bands, through a buffer of its own size. */
export function readBands(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>, into: Float32Array): Float32Array {
  analyser.getFloatFrequencyData(buffer)
  return bandsOf(buffer, analyser.context.sampleRate, into)
}
