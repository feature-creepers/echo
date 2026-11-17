/** Sound as numbers: one channel, each sample between -1 and 1. */
export interface Sound {
  sampleRate: number
  samples: Float32Array
}

/** One set of models speech needs, and whether it is on this device. */
export interface SpeechModel {
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
  /** Turn one utterance into text. */
  transcribe(sound: Sound): Promise<{ text: string; language?: string }>
  /** Turn one sentence into sound, in the language and the voice given. */
  speak(text: string, how: { language: string; style: string }): Promise<Sound>
  /** The voice's styles, to pick from. */
  styles(): Promise<{ id: string; name: string }[]>
}
