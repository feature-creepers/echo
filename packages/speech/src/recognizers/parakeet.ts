import { detectEngineThreads, detectTier, PARAKEET } from '@repo/models'
import { atHearingRate, checkSound, HEARING_RATE } from '../audio/resample.ts'
import { type EngineOptions, installedFiles } from '../model-files.ts'
import { loadSherpa, type NativeRecognizer } from '../native/sherpa.ts'
import type { Recognizer } from '../ports.ts'
import { createSerial } from '../serial.ts'
import { SpeechError } from '../speech-error.ts'

/**
 * Recognition with NVIDIA's Parakeet TDT 0.6b v3, on the processor. It hears 25 European languages and
 * finds out which one is spoken without being told, but does not say which it was: what it returns has no
 * language. It writes punctuation and capitals itself.
 */

/** Nothing can be said in less than this, and the model fails on a sound with no samples. In seconds. */
const SHORTEST_SECONDS = 0.1

export async function openRecognizer({ folder, threads = detectEngineThreads(detectTier()) }: EngineOptions): Promise<Recognizer> {
  const file = installedFiles(folder, PARAKEET)
  let native: NativeRecognizer | undefined = await loadSherpa().OfflineRecognizer.createAsync({
    featConfig: { sampleRate: HEARING_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: file('encoder.int8.onnx'), decoder: file('decoder.int8.onnx'), joiner: file('joiner.int8.onnx') },
      tokens: file('tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: threads,
      provider: 'cpu',
      debug: false
    }
  })
  const serial = createSerial()

  return {
    transcribe: (sound) =>
      serial.run(async () => {
        if (!native) throw new SpeechError('failed', 'The recogniser was closed.')
        const samples = atHearingRate(checkSound(sound))
        if (samples.length < SHORTEST_SECONDS * HEARING_RATE) return { text: '' }

        const stream = native.createStream()
        stream.acceptWaveform({ sampleRate: HEARING_RATE, samples })
        const { text } = await native.decodeAsync(stream)
        return { text: text.trim() }
      }),
    // The library frees the model when nothing refers to it any more.
    close: () => {
      native = undefined
    }
  }
}
