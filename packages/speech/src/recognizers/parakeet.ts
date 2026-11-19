import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { detectEngineThreads, detectTier, PARAKEET } from '@repo/models'
import { atHearingRate, checkSound, HEARING_RATE } from '../audio/resample.ts'
import { type EngineOptions, installedFiles } from '../model-files.ts'
import { loadSherpa, type NativeRecognizer } from '../native/sherpa.ts'
import type { Recognizer } from '../ports.ts'
import { createSerial } from '../serial.ts'
import { SpeechError } from '../speech-error.ts'
import { hotwords, piecesVocabulary, writtenCharacters } from './words.ts'

/**
 * Recognition with NVIDIA's Parakeet TDT 0.6b v3, on the processor. It hears 25 European languages and
 * finds out which one is spoken without being told, but does not say which it was: what it returns has no
 * language. It writes punctuation and capitals itself.
 *
 * It hears the best way at once (greedy search) until the person gives words of their own: then it weighs a few
 * ways of hearing together, which takes about a third longer, so that it can favour their words (`words.ts`).
 * One model is open at a time, the one the words given ask for.
 */

/** Nothing can be said in less than this, and the model fails on a sound with no samples. In seconds. */
const SHORTEST_SECONDS = 0.1
/** How many ways of hearing are weighed together when the person's words are favoured. */
const WAYS = 4
/** The pieces the library cuts the person's words with, written beside the model's files. */
const PIECES_FILE = 'pieces.vocab'

export async function openRecognizer({ folder, threads = detectEngineThreads(detectTier()) }: EngineOptions): Promise<Recognizer> {
  const file = installedFiles(folder, PARAKEET)
  const tokens = await readFile(file('tokens.txt'), 'utf8')
  const characters = writtenCharacters(tokens)

  /** The vocabulary file, written once: it follows from the model's own list, which never changes for a set. */
  const pieces = async () => {
    const path = file(PIECES_FILE)
    if ((await stat(path).catch(() => undefined))?.isFile()) return path
    await writeFile(`${path}.part`, piecesVocabulary(tokens))
    await rename(`${path}.part`, path)
    return path
  }

  const open = async (favouring: boolean): Promise<NativeRecognizer> =>
    loadSherpa().OfflineRecognizer.createAsync({
      featConfig: { sampleRate: HEARING_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: file('encoder.int8.onnx'), decoder: file('decoder.int8.onnx'), joiner: file('joiner.int8.onnx') },
        tokens: file('tokens.txt'),
        modelType: 'nemo_transducer',
        numThreads: threads,
        provider: 'cpu',
        debug: false,
        ...(favouring ? { modelingUnit: 'bpe', bpeVocab: await pieces() } : {})
      },
      decodingMethod: favouring ? 'modified_beam_search' : 'greedy_search',
      maxActivePaths: WAYS
    })

  let native: NativeRecognizer | undefined = await open(false)
  let favouring = false
  let closed = false
  const serial = createSerial()

  return {
    transcribe: (sound, how = {}) =>
      serial.run(async () => {
        if (closed || !native) throw new SpeechError('failed', 'The recogniser was closed.')
        const samples = atHearingRate(checkSound(sound))
        if (samples.length < SHORTEST_SECONDS * HEARING_RATE) return { text: '' }

        const given = hotwords(how.words ?? [], characters)
        if ((given !== '') !== favouring) {
          // The model open is let go first, so that two are never held at once.
          native = undefined
          favouring = given !== ''
          native = await open(favouring)
          if (closed) native = undefined
        }
        if (!native) throw new SpeechError('failed', 'The recogniser was closed.')
        const stream = given === '' ? native.createStream() : native.createStream(given)
        stream.acceptWaveform({ sampleRate: HEARING_RATE, samples })
        const { text } = await native.decodeAsync(stream)
        return { text: text.trim() }
      }),
    // The library frees the model when nothing refers to it any more.
    close: () => {
      closed = true
      native = undefined
    }
  }
}
