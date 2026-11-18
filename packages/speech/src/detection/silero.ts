import { SILERO } from '@repo/models'
import { checkSound, createPieceResampler, HEARING_RATE, type PieceResampler } from '../audio/resample.ts'
import { installedFiles } from '../model-files.ts'
import { loadSherpa, type NativeDetector } from '../native/sherpa.ts'
import type { Listening, SpeechDetector, SpeechEvent } from '../ports.ts'
import { SpeechError } from '../speech-error.ts'

/**
 * Detection of the start and end of speech with Silero VAD, on the processor. It costs next to nothing:
 * the model is small and looks at 32 milliseconds of sound at a time.
 */

export interface DetectorOptions extends Listening {
  /** Where model sets are installed. */
  folder: string
}

/** A pause this long ends what was being said, unless told otherwise. Shorter cuts people off while they think. */
const SILENCE_SECONDS = 1

/** Sound must stay speech this long to count: a click or a cough is shorter. */
const SHORTEST_SPEECH_SECONDS = 0.25

/** How sure the model must be that a window holds speech, from 0 to 1. Its authors' default. */
const THRESHOLD = 0.5

/** Speech with no pause is ended at this length, at the next breath. It bounds the memory one utterance takes. */
const LONGEST_SPEECH_SECONDS = 120

/** What the model looks at in one go, in samples. Fixed by the model. */
const WINDOW = 512

/** The library dates the start of speech this long before it becomes sure of it, to keep the first syllable. */
const LEAD = 2 * WINDOW + SHORTEST_SPEECH_SECONDS * HEARING_RATE

export async function openSpeechDetector({ folder, silence = SILENCE_SECONDS }: DetectorOptions): Promise<SpeechDetector> {
  if (!Number.isFinite(silence) || silence <= 0) throw new SpeechError('invalid', `${silence} seconds is not a length of silence to wait for.`)
  const file = installedFiles(folder, SILERO)
  const { Vad } = loadSherpa()
  let native: NativeDetector | undefined = new Vad(
    {
      sileroVad: {
        model: file('silero_vad_v5.onnx'),
        threshold: THRESHOLD,
        minSpeechDuration: SHORTEST_SPEECH_SECONDS,
        minSilenceDuration: silence,
        maxSpeechDuration: LONGEST_SPEECH_SECONDS,
        windowSize: WINDOW
      },
      sampleRate: HEARING_RATE,
      numThreads: 1,
      provider: 'cpu',
      debug: false
    },
    // Room for the longest utterance, the silence that ends it, and some to spare.
    LONGEST_SPEECH_SECONDS + silence + 10
  )

  let resampler: PieceResampler | undefined
  /** Samples not yet given to the model: less than one window. */
  let waiting = new Float32Array(0)
  /** How many samples the model was given since the sound began. */
  let heard = 0
  let speaking = false

  /** Give the model every whole window of `samples`, and collect what it noticed after each. */
  function hear(detector: NativeDetector, samples: Float32Array, events: SpeechEvent[]): void {
    const all = new Float32Array(waiting.length + samples.length)
    all.set(waiting)
    all.set(samples, waiting.length)

    let at = 0
    // One window at a time: the library decides once per call whether speech is going on.
    for (; at + WINDOW <= all.length; at += WINDOW) {
      detector.acceptWaveform(all.subarray(at, at + WINDOW))
      heard += WINDOW
      notice(detector, events)
    }
    waiting = all.slice(at)
  }

  function notice(detector: NativeDetector, events: SpeechEvent[]): void {
    const now = detector.isDetected()
    if (now && !speaking) events.push({ type: 'started', at: Math.max(0, heard - LEAD) / HEARING_RATE })
    speaking = now

    while (!detector.isEmpty()) {
      const segment = detector.front(false)
      detector.pop()
      events.push({
        type: 'ended',
        start: segment.start / HEARING_RATE,
        end: (segment.start + segment.samples.length) / HEARING_RATE,
        speech: { sampleRate: HEARING_RATE, samples: segment.samples }
      })
    }
  }

  function open(): NativeDetector {
    if (!native) throw new SpeechError('failed', 'The speech detector was closed.')
    return native
  }

  return {
    async feed(sound) {
      const detector = open()
      checkSound(sound)
      // A microphone does not change its rate while it records. If the rate changes, another sound has begun.
      if (resampler?.from !== sound.sampleRate) resampler = createPieceResampler(sound.sampleRate)
      const events: SpeechEvent[] = []
      hear(detector, resampler.next(sound.samples), events)
      return events
    },

    async end() {
      const detector = open()
      const events: SpeechEvent[] = []
      // What the resampler held back, then silence up to the end of the last window, so that nothing said is left out.
      if (resampler) hear(detector, resampler.last(), events)
      if (waiting.length > 0) hear(detector, new Float32Array(WINDOW - waiting.length), events)
      detector.flush()
      notice(detector, events)

      detector.reset()
      waiting = new Float32Array(0)
      heard = 0
      speaking = false
      return events
    },

    // The library frees the model when nothing refers to it any more.
    close() {
      native = undefined
    }
  }
}
