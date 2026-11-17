import type { ModelFile, ModelSet } from './model-set.ts'

/**
 * Every model set the product can download. Each file is fetched on its own from a Hugging Face repository,
 * at one commit of that repository, so the address always serves the bytes whose size and SHA-256 are
 * recorded here. Changing a model means a new commit, new sizes and new hashes, together.
 */

/** The files of one repository, at one commit. */
function hosted(repository: string, commit: string, files: Array<[path: string, bytes: number, sha256: string]>): ModelFile[] {
  return files.map(([path, bytes, sha256]) => ({ path, url: `https://huggingface.co/${repository}/resolve/${commit}/${path}`, bytes, sha256 }))
}

/**
 * Recognition: NVIDIA's Parakeet TDT 0.6b v3, with weights reduced to 8 bits. It hears 25 European languages
 * and finds out by itself which one is spoken. The encoder is nearly all of the download.
 */
export const PARAKEET: ModelSet = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  purpose: 'recognition',
  name: 'Speech recognition',
  licence: 'CC BY 4.0',
  files: hosted('csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', 'ed5d745623472f97cfc2e6c2916ee248798fc5a8', [
    ['encoder.int8.onnx', 652_282_294, '1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479'],
    ['decoder.int8.onnx', 11_845_274, '0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5'],
    ['joiner.int8.onnx', 6_355_277, 'cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98'],
    ['tokens.txt', 93_939, 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d']
  ])
}

/**
 * Voice: Supertone's Supertonic 3, with weights reduced to 8 bits. It speaks 31 languages in 10 styles and
 * reads plain text, so it needs no pronunciation data beside the model.
 */
export const SUPERTONIC: ModelSet = {
  id: 'supertonic-3-int8',
  purpose: 'voice',
  name: 'Voice',
  licence: 'OpenRAIL-M',
  files: hosted('csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11', 'cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4', [
    ['vector_estimator.int8.onnx', 78_400_833, '20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd'],
    ['text_encoder.int8.onnx', 36_416_150, 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff'],
    ['vocoder.int8.onnx', 25_991_073, 'e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152'],
    ['duration_predictor.int8.onnx', 3_700_147, 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db'],
    ['voice.bin', 517_168, '67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8'],
    ['unicode_indexer.bin', 262_144, '8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30'],
    ['tts.json', 8_253, '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09']
  ])
}

/** Speech detection: Silero VAD, version 5. The file is the one its authors publish, byte for byte. */
export const SILERO: ModelSet = {
  id: 'silero-vad-v5',
  purpose: 'speech-detection',
  name: 'Speech detection',
  licence: 'MIT',
  files: hosted('csukuangfj/vad', 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc', [
    ['silero_vad_v5.onnx', 2_313_101, '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396']
  ])
}

/** Every set, smallest first, so that the first one to finish downloading comes quickly. */
export const CATALOGUE: readonly ModelSet[] = [SILERO, SUPERTONIC, PARAKEET]

/** The size of a whole set, in bytes. */
export function bytesOf(set: ModelSet): number {
  return set.files.reduce((sum, file) => sum + file.bytes, 0)
}
