/** Sound as numbers: one channel, each sample between -1 and 1. */
export interface Sound {
  sampleRate: number
  samples: Float32Array
}

/**
 * What the window needs from the device's speech engines, which run outside it. The app supplies it; the
 * interface never knows which engines they are.
 */
export interface SpeechEngine {
  /** Turn one utterance into text. */
  transcribe(sound: Sound): Promise<{ text: string; language?: string }>
  /** Turn one sentence into sound, in the language given. */
  speak(text: string, language: string | undefined): Promise<Sound>
}
