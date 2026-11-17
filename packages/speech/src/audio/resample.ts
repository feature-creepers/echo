import { loadSherpa, type NativeResampler } from '../native/sherpa.ts'
import type { Sound } from '../ports.ts'
import { SpeechError } from '../speech-error.ts'

/** The rate the recogniser and the speech detector hear at, in samples per second. Sound at any other rate is converted first. */
export const HEARING_RATE = 16_000

/** Refuse what is not a sound, with a message that says why, before it reaches native code. */
export function checkSound(sound: Sound): Sound {
  if (!(sound.samples instanceof Float32Array)) throw new SpeechError('invalid', 'A sound must hold its samples as 32-bit floating-point numbers.')
  if (!Number.isInteger(sound.sampleRate) || sound.sampleRate < 1) {
    throw new SpeechError('invalid', `A sound must have a whole number of samples per second: ${sound.sampleRate} is not one.`)
  }
  return sound
}

/** The samples of a whole sound, at the rate engines hear at. */
export function atHearingRate(sound: Sound): Float32Array {
  if (sound.sampleRate === HEARING_RATE || sound.samples.length === 0) return sound.samples
  return new (loadSherpa().LinearResampler)(sound.sampleRate, HEARING_RATE).flush(sound.samples)
}

/** Converts a sound that arrives in pieces, keeping between pieces what the next one needs to join without a click. */
export interface PieceResampler {
  /** The rate of the pieces it takes. */
  readonly from: number
  next(samples: Float32Array): Float32Array
  /** The sound is over: what was held back. Ready for another sound afterwards. */
  last(): Float32Array
}

const NOTHING = new Float32Array(0)

export function createPieceResampler(from: number): PieceResampler {
  if (from === HEARING_RATE) return { from, next: (samples) => samples, last: () => NOTHING }
  const native: NativeResampler = new (loadSherpa().LinearResampler)(from, HEARING_RATE)
  return {
    from,
    next: (samples) => native.resample(samples),
    last: () => {
      const held = native.flush(NOTHING)
      native.reset()
      return held
    }
  }
}
