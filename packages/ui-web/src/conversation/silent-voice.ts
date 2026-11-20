import type { DeviceVoice } from '@repo/client'

/** How long a sentence is held for each of its characters, and at least, in milliseconds: about the time it takes to read. */
const MS_PER_CHARACTER = 55
const LEAST_MS = 1200

/**
 * A voice with no sound: it holds each sentence for about the time it takes to read, so captions keep a
 * pace. Used while the device has no voice engine ready.
 */
export function silentVoice(): DeviceVoice {
  return {
    say(sentence) {
      let finish: () => void = () => undefined
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      const ms = Math.max(LEAST_MS, sentence.text.length * MS_PER_CHARACTER)
      const timer = window.setTimeout(finish, ms)
      return {
        done,
        // Shown at once, for the time it takes to read.
        heard: Promise.resolve(ms / 1000),
        cancel() {
          window.clearTimeout(timer)
          finish()
        }
      }
    }
  }
}
