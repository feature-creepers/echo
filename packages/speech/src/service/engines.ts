import { type InstallOptions, installModelSet, isInstalled, type ModelSet, SPEECH_SETS, type SpeechSet } from '@repo/models'
import { openSpeechDetector } from '../detection/silero.ts'
import type { Listening, Recognizer, SpeechDetector, Voice, VoiceStyle } from '../ports.ts'
import { openRecognizer } from '../recognizers/parakeet.ts'
import { describeVoice, openVoice } from '../voices/supertonic.ts'

/**
 * Everything the speech service needs from the outside: the model sets and how to get them, and how to
 * open each engine. The service is written against this, so that it can be tested with engines that
 * need no model, and so that another choice of engines changes nothing in it.
 */
export interface SpeechEngines {
  /** The sets the engines need, in the order to download them. */
  sets: readonly SpeechSet[]
  isInstalled(set: ModelSet): boolean
  install(set: ModelSet, options: InstallOptions): Promise<void>
  openRecognizer(): Promise<Recognizer>
  openVoice(): Promise<Voice>
  openDetector(listening: Listening): Promise<SpeechDetector>
  /** What the voice offers, known without loading it. */
  describeVoice(): { styles: VoiceStyle[]; languages: string[] }
}

/** The engines that run on this machine's processor, with their models in `folder`. */
export function localEngines({ folder, threads }: { folder: string; threads: number }): SpeechEngines {
  return {
    sets: SPEECH_SETS,
    isInstalled: (set) => isInstalled(folder, set),
    install: (set, options) => installModelSet(folder, set, options),
    openRecognizer: () => openRecognizer({ folder, threads }),
    openVoice: () => openVoice({ folder, threads }),
    openDetector: (listening) => openSpeechDetector({ folder, ...listening }),
    describeVoice
  }
}
