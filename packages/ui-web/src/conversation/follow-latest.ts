import { createStickToBottom } from '@ui-sdk/core'
import { type RefCallback, useCallback, useState, useSyncExternalStore } from 'react'

/** How near its end, in pixels, a scroll area still counts as at its end: a nudge of the wheel does not leave it. */
const AT_END = 32

export interface FollowLatest {
  /** Give it to the scroll area. Its first child holds the content, and stays the same element. */
  ref: RefCallback<HTMLElement>
  /** The scroll area, once given. */
  area: HTMLElement | null
  /** Whether the person has scrolled away from the end, so wants a way back. */
  away: boolean
  /** Go back to the end, and follow it again. */
  toLatest(): void
  /** Say that earlier lines are about to be added above, so what the person reads stays where it is. */
  prepend(): void
}

/**
 * A scroll area read from its end, as a conversation is: it opens at its latest line and stays there as what it
 * holds grows, as long as the person has not scrolled away; once they have, nothing moves under their eyes, and
 * what is added above them, earlier lines read as they scroll up, leaves what they read where it was.
 */
export function useFollowLatest(): FollowLatest {
  const [log] = useState(() => createStickToBottom({ threshold: AT_END }))
  const [area, setArea] = useState<HTMLElement | null>(null)
  const following = useSyncExternalStore(log.subscribe, () => log.get().following)

  // Connected while the area is there; React gives the cleanup back rather than null once it goes.
  const ref = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      if (!element) return
      setArea(element)
      const disconnect = log.connect(element)
      return () => {
        disconnect()
        setArea(null)
      }
    },
    [log]
  )
  const toLatest = useCallback(() => {
    log.scrollToBottom({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [log])

  return { ref, area, away: !following, toLatest, prepend: log.prepend }
}
