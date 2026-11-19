import { createRequire } from 'node:module'
import { arch, platform } from 'node:os'
import { SpeechError } from '../speech-error.ts'

/**
 * The one native library behind every engine of this package: sherpa-onnx, which runs ONNX models on the
 * processor and ships built for each system. Only what this package uses of it is described here, since
 * the library comes without type declarations.
 *
 * It is loaded when an engine is first opened, never when this package is imported: the app's main
 * process imports the package to talk to the speech service, and must not load native code for that.
 *
 * Every call that returns sound is asked for a buffer the JavaScript engine owns (`enableExternalBuffer:
 * false`). The library's default is a buffer it owns itself, which Electron refuses.
 */

interface NativeSound {
  sampleRate: number
  samples: Float32Array
}

interface NativeStream {
  acceptWaveform(sound: NativeSound): void
}

export interface NativeRecognizer {
  /** A stream for one utterance, favouring the words given, written as the library takes them (`recognizers/words.ts`). */
  createStream(hotwords?: string): NativeStream
  /** Decodes off the main thread. */
  decodeAsync(stream: NativeStream): Promise<{ text: string }>
}

interface RecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string }
    tokens: string
    modelType: string
    numThreads: number
    provider: 'cpu'
    debug: boolean
    /** How the words to favour are cut into the model's pieces: as BPE pieces, from this vocabulary file. */
    modelingUnit?: 'bpe'
    bpeVocab?: string
  }
  /** `modified_beam_search` weighs several ways of hearing at once, which favouring words needs. */
  decodingMethod: 'greedy_search' | 'modified_beam_search'
  maxActivePaths: number
}

export interface NativeVoice {
  readonly numSpeakers: number
  readonly sampleRate: number
  /** Generates off the main thread. Rejects when nothing was generated. */
  generateAsync(request: {
    text: string
    sid: number
    speed: number
    enableExternalBuffer: false
    /** The only place the engine reads its options from. `extra` holds the ones particular to a model. */
    generationConfig: { sid: number; speed: number; numSteps: number; extra: Record<string, string | number> }
  }): Promise<NativeSound>
}

interface VoiceConfig {
  model: {
    supertonic: {
      durationPredictor: string
      textEncoder: string
      vectorEstimator: string
      vocoder: string
      ttsJson: string
      unicodeIndexer: string
      voiceStyle: string
    }
    numThreads: number
    provider: 'cpu'
    debug: boolean
  }
  maxNumSentences: number
}

export interface NativeDetector {
  acceptWaveform(samples: Float32Array): void
  /** Whether speech is going on at the end of what was accepted. */
  isDetected(): boolean
  /** Whether no finished segment of speech is waiting. */
  isEmpty(): boolean
  /** The oldest finished segment: where it starts, in samples from the first one accepted, and its sound. */
  front(enableExternalBuffer: false): { start: number; samples: Float32Array }
  pop(): void
  /** End the segment going on, if any, as if silence had followed. */
  flush(): void
  reset(): void
}

interface DetectorConfig {
  sileroVad: { model: string; threshold: number; minSpeechDuration: number; minSilenceDuration: number; maxSpeechDuration: number; windowSize: number }
  sampleRate: number
  numThreads: number
  provider: 'cpu'
  debug: boolean
}

export interface NativeResampler {
  /** Resample the next piece of a sound. */
  resample(samples: Float32Array): Float32Array
  /** Resample the last piece of a sound, and give what was held back. */
  flush(samples: Float32Array): Float32Array
  reset(): void
}

export interface Sherpa {
  OfflineRecognizer: { createAsync(config: RecognizerConfig): Promise<NativeRecognizer> }
  OfflineTts: { createAsync(config: VoiceConfig): Promise<NativeVoice> }
  Vad: new (config: DetectorConfig, bufferSizeInSeconds: number) => NativeDetector
  LinearResampler: new (inputRate: number, outputRate: number) => NativeResampler
  version: string
}

let loaded: Sherpa | undefined

/** The library, loaded the first time it is asked for. Throws a `SpeechError` when this system cannot load it. */
export function loadSherpa(): Sherpa {
  if (loaded) return loaded
  try {
    // Required rather than imported, so that a bundler leaves it alone: the library finds its native part
    // by a path relative to its own files, which only works when they stay where the package manager put them.
    loaded = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa
  } catch (error) {
    throw new SpeechError('unavailable', `Speech cannot run on this computer: its engine has no build that loads here (${platform()}, ${arch()}).`, {
      cause: error
    })
  }
  return loaded
}
