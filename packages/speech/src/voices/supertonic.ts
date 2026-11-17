import { detectEngineThreads, detectTier, SUPERTONIC } from '@repo/models'
import { type EngineOptions, installedFiles } from '../model-files.ts'
import { loadSherpa, type NativeVoice } from '../native/sherpa.ts'
import type { Sound, Voice, VoiceStyle } from '../ports.ts'
import { createSerial } from '../serial.ts'
import { SpeechError } from '../speech-error.ts'

/**
 * A voice with Supertone's Supertonic 3, on the processor. It reads plain text in 31 languages and ten
 * styles, and needs to be told the language of what it reads to pronounce it.
 */

/**
 * The ten styles, in the order the model file holds them: a style's place here is its number for the engine.
 * The identifiers are the names Supertone gives them, which is what stays true if the list grows.
 */
const STYLES: readonly VoiceStyle[] = [
  { id: 'f1', name: 'Woman, calm and composed' },
  { id: 'f2', name: 'Woman, bright and cheerful' },
  { id: 'f3', name: 'Woman, clear, like an announcer' },
  { id: 'f4', name: 'Woman, crisp and confident' },
  { id: 'f5', name: 'Woman, kind and gentle' },
  { id: 'm1', name: 'Man, lively and upbeat' },
  { id: 'm2', name: 'Man, deep and composed' },
  { id: 'm3', name: 'Man, polished and assured' },
  { id: 'm4', name: 'Man, soft and friendly' },
  { id: 'm5', name: 'Man, warm and soothing' }
]

// biome-ignore format: a list of codes reads better in rows than one per line.
const LANGUAGES: readonly string[] = [
  'en', 'fr', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'hi', 'hr', 'hu', 'id', 'it',
  'ja', 'ko', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'
]

/**
 * What this voice calls 1: a little quicker than the pace Supertone's own programs default to (1.05), which
 * sounds like a recording slowed down when heard in conversation.
 */
const NATURAL_PACE = 1.25

/** A speed beyond these no longer sounds like speech. */
const SLOWEST = 0.5
const FASTEST = 2

/** How many refining passes the model makes over a sentence. Supertone's default: more is slower for little gain. */
const STEPS = 5

/** Measured: this model gets no faster with more than four threads, and slower with many more. */
const MOST_THREADS = 4

/** What the voice offers, known without loading it: the settings screen needs it before anything is downloaded. */
export function describeVoice(): { styles: VoiceStyle[]; languages: string[] } {
  return { styles: STYLES.map((style) => ({ ...style })), languages: [...LANGUAGES] }
}

export async function openVoice({ folder, threads = detectEngineThreads(detectTier()) }: EngineOptions): Promise<Voice> {
  const file = installedFiles(folder, SUPERTONIC)
  let native: NativeVoice | undefined = await loadSherpa().OfflineTts.createAsync({
    model: {
      supertonic: {
        durationPredictor: file('duration_predictor.int8.onnx'),
        textEncoder: file('text_encoder.int8.onnx'),
        vectorEstimator: file('vector_estimator.int8.onnx'),
        vocoder: file('vocoder.int8.onnx'),
        ttsJson: file('tts.json'),
        unicodeIndexer: file('unicode_indexer.bin'),
        voiceStyle: file('voice.bin')
      },
      numThreads: Math.min(threads, MOST_THREADS),
      provider: 'cpu',
      debug: false
    },
    maxNumSentences: 1
  })
  if (native.numSpeakers !== STYLES.length) {
    throw new SpeechError('failed', `The voice model holds ${native.numSpeakers} styles where ${STYLES.length} are expected.`)
  }
  const serial = createSerial()

  return {
    styles: () => describeVoice().styles,
    languages: () => describeVoice().languages,
    speak: (text, how) =>
      serial.run(async (): Promise<Sound> => {
        if (!native) throw new SpeechError('failed', 'The voice was closed.')
        const speaker = STYLES.findIndex((style) => style.id === how.style)
        if (speaker < 0) throw new SpeechError('invalid', `The voice has no style called "${how.style}".`)
        // "fr-FR" and "FR" are French too.
        const language = how.language.toLowerCase().split(/[-_]/)[0] ?? ''
        if (!LANGUAGES.includes(language)) throw new SpeechError('invalid', `The voice does not speak the language "${how.language}".`)
        const pace = how.speed ?? 1
        if (!Number.isFinite(pace) || pace <= 0) throw new SpeechError('invalid', `${how.speed} is not a speed to speak at.`)
        const speed = NATURAL_PACE * Math.min(FASTEST, Math.max(SLOWEST, pace))

        const silent: Sound = { sampleRate: native.sampleRate, samples: new Float32Array(0) }
        if (text.trim() === '') return silent
        try {
          // The language is read from `extra.lang` and nowhere else; left out, the text is read as English.
          const sound = await native.generateAsync({
            text,
            sid: speaker,
            speed,
            enableExternalBuffer: false,
            generationConfig: { sid: speaker, speed, numSteps: STEPS, extra: { lang: language } }
          })
          return { sampleRate: sound.sampleRate, samples: sound.samples }
        } catch (error) {
          // A sentence with nothing to pronounce, such as "…", is not an error: it has no sound.
          if (error instanceof Error && /no audio/i.test(error.message)) return silent
          throw new SpeechError('failed', 'The voice could not say this sentence.', { cause: error })
        }
      }),
    // The library frees the model when nothing refers to it any more.
    close: () => {
      native = undefined
    }
  }
}
