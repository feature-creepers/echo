/** Sound as numbers: one channel, each sample between -1 and 1. */
export interface Sound {
  sampleRate: number
  samples: Float32Array
}

/** One set of models speech needs, and whether it is on this device. */
interface SpeechModel {
  id: string
  name: string
  /** The size of its download, in bytes. */
  bytes: number
  installed: boolean
}

export interface SpeechReadiness {
  /** Every model is installed: the device can hear and speak. */
  ready: boolean
  models: SpeechModel[]
}

export interface InstallProgress {
  received: number
  total: number
}

/**
 * What the window needs from the device's speech engines, which run outside it. The app supplies it; the
 * interface never knows which engines they are.
 */
export interface SpeechEngine {
  status(): Promise<SpeechReadiness>
  /** Download the models that are missing. */
  install(onProgress: (progress: InstallProgress) => void): Promise<void>
  /** Turn one utterance into text, favouring the person's own words when given: names and terms it would not know. */
  transcribe(sound: Sound, words?: readonly string[]): Promise<{ text: string; language?: string }>
  /** Turn one sentence into sound, in the language and the voice given, at a pace (1 is the voice's own). */
  speak(text: string, how: { language: string; style: string; speed?: number }): Promise<Sound>
  /** The voice's styles, to pick from. */
  styles(): Promise<{ id: string; name: string }[]>
}

/**
 * The engines, hearing every utterance with the person's own words as they stand when it is heard, unless words are
 * given: the recogniser favours them (docs/SPEC.md, section 8.2).
 */
export function favouring(engine: SpeechEngine, words: () => readonly string[]): SpeechEngine {
  return {
    status: () => engine.status(),
    install: (onProgress) => engine.install(onProgress),
    transcribe: (sound, given) => engine.transcribe(sound, given ?? words()),
    speak: (text, how) => engine.speak(text, how),
    styles: () => engine.styles()
  }
}
