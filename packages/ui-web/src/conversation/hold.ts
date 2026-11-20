/** How long the person holds the button that stops all work, in milliseconds: long enough never to happen by accident. */
export const HOLD_MS = 2_000

/** A press shorter than this is a tap: the button then says it must be held. */
const TAP_MS = 400

interface HoldOptions {
  /** Called once the press has lasted the whole time. */
  onDone(): void
  /** Called when holding starts or stops, so the fill can follow. */
  onChange?(held: boolean): void
}

interface Hold {
  /** The pointer or the key went down. */
  press(): void
  /** It came up, or went away. Says how it ended: done already, let go early, or a tap. */
  release(): 'done' | 'early' | 'tap' | 'idle'
  held(): boolean
}

/**
 * Press and hold: what is done only after a press that lasts. Letting go before the end does nothing, so a stray
 * click never stops a piece of work.
 */
export function createHold({ onDone, onChange }: HoldOptions): Hold {
  let timer: ReturnType<typeof setTimeout> | undefined
  let since: number | undefined
  let done = false

  return {
    press() {
      if (since !== undefined) return
      since = Date.now()
      done = false
      onChange?.(true)
      timer = setTimeout(() => {
        timer = undefined
        since = undefined
        done = true
        onChange?.(false)
        onDone()
      }, HOLD_MS)
    },
    release() {
      if (since === undefined) {
        const was = done
        done = false
        return was ? 'done' : 'idle'
      }
      const lasted = Date.now() - since
      clearTimeout(timer)
      timer = undefined
      since = undefined
      onChange?.(false)
      return lasted < TAP_MS ? 'tap' : 'early'
    },
    held: () => since !== undefined
  }
}
