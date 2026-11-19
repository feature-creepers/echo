/**
 * The things a speech engine does, in the same shape wherever it runs: on a device now, on a server later.
 * An engine is an adapter behind one of these interfaces. Nothing outside this package names an engine.
 */

/** Sound as numbers: one channel, each sample between -1 and 1. */
export interface Sound {
  /** Samples per second. */
  sampleRate: number
  samples: Float32Array
}

/** What a recogniser heard. */
export interface Heard {
  text: string
  /** The language spoken, as a two-letter code ('en', 'fr'), when the engine can tell. */
  language?: string
}

/** How to hear one utterance. */
export interface Hearing {
  /** The person's own words, favoured when they are heard: names and terms the recogniser would not know. */
  words?: readonly string[] | undefined
}

export interface Recognizer {
  /** Turn one utterance, whole, into text. Any sample rate is accepted. */
  transcribe(sound: Sound, how?: Hearing): Promise<Heard>
  /** Let go of the model. */
  close(): void
}

/** One way a voice engine can sound. */
export interface VoiceStyle {
  /** Identifies the style for good, in settings. */
  id: string
  /** What the user reads when picking one. */
  name: string
}

export interface Speaking {
  /** The style to speak in: one of `styles()`. */
  style: string
  /** The language of the text, as a two-letter code. Engines that speak several languages need it to pronounce. */
  language: string
  /** 1 is the engine's natural pace. */
  speed?: number
}

export interface Voice {
  styles(): VoiceStyle[]
  /** The languages this engine speaks, as two-letter codes. */
  languages(): string[]
  /** Speak one sentence and resolve with its sound, whole. */
  speak(text: string, how: Speaking): Promise<Sound>
  /** Let go of the model. */
  close(): void
}

/** What a speech detector noticed. Times are in seconds, counted from the first sample it was fed. */
export type SpeechEvent =
  /** Someone started to speak, at about that time. */
  | { type: 'started'; at: number }
  /** They stopped: the silence that followed lasted long enough. `speech` is what was said, with the silence around it cut off. */
  | { type: 'ended'; start: number; end: number; speech: Sound }

export interface Listening {
  /** How long a silence must last for the speech before it to be over, in seconds. */
  silence?: number
}

export interface SpeechDetector {
  /**
   * Hear the next piece of sound, as it comes from a microphone, and say what happened in it.
   * Any sample rate is accepted, the same one for every piece.
   */
  feed(sound: Sound): Promise<SpeechEvent[]>
  /** The sound is over: speech still going on ends here. The detector is then ready for another sound. */
  end(): Promise<SpeechEvent[]>
  /** Let go of the model. */
  close(): void
}
