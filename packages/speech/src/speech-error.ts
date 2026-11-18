/**
 * Why speech could not do what was asked:
 * - `not-installed`: a model set has not been downloaded. Installing it is the remedy.
 * - `unavailable`: the engines cannot run on this system.
 * - `invalid`: what was asked makes no sense: an unknown style, a language the voice does not speak.
 * - `failed`: anything else.
 */
export type SpeechErrorCode = 'not-installed' | 'unavailable' | 'invalid' | 'failed'

/** Speech could not do what was asked. The message is written for the user. */
export class SpeechError extends Error {
  readonly code: SpeechErrorCode

  constructor(code: SpeechErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SpeechError'
    this.code = code
  }
}
