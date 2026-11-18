/**
 * The clipboard of the computer the core runs on (docs/SPEC.md, section 12.4, more of the device): its text, read
 * and written. The adapter only carries out; whether reading is asked first is the core's to decide.
 *
 * A method rejects with an `Error` whose message is written for a model to act on.
 */
export interface Clipboard {
  /** The text the clipboard holds now: empty when it holds none, or something that is not text. */
  read(): Promise<string>
  /** Put text on the clipboard, in place of what it held. */
  write(text: string): Promise<void>
}
