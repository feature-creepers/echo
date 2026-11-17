import type { DeviceVoice } from '@repo/client'

/**
 * A voice with no sound: it holds each sentence for about the time it takes to read, so captions keep a
 * pace. Used while the device has no voice engine ready.
 */
export function silentVoice(msPerCharacter = 55, minimumMs = 1200): DeviceVoice {
  return {
    say(sentence) {
      let finish: () => void = () => undefined
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      const timer = window.setTimeout(finish, Math.max(minimumMs, sentence.text.length * msPerCharacter))
      return {
        done,
        cancel() {
          window.clearTimeout(timer)
          finish()
        }
      }
    }
  }
}
