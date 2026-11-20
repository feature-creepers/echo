/**
 * A firm push of the wheel against an edge: what takes the stage home when the stream is at its top and the wheel
 * goes on up, and what leaves home when it goes down. A push is counted only where nothing else takes the wheel,
 * and only when it starts there: a quick scroll that reaches the edge and runs on is the end of that scroll, not a
 * push, however long it runs on.
 */
interface Push {
  /**
   * One turn of the wheel: how far it goes towards the edge, in CSS pixels, away from it when negative; when, in
   * milliseconds; and whether it is free, which is to say that the edge is reached and nothing under the pointer
   * would scroll with it. True once the push is firm enough.
   */
  wheel(travel: number, now: number, free: boolean): boolean
}

/**
 * A push that is firm once the wheel has gone this far, in CSS pixels, with no pause longer than this many
 * milliseconds; a longer pause starts it again.
 */
export function createPush(far: number, within: number): Push {
  let pushed = 0
  let last = Number.NEGATIVE_INFINITY
  // The scroll under way began before the edge was reached: what is left of it is not a push.
  let carried = false
  return {
    wheel(travel, now, free) {
      const fresh = now - last > within
      last = now
      if (travel <= 0 || !free) {
        pushed = 0
        carried = travel > 0
        return false
      }
      if (fresh) {
        pushed = 0
        carried = false
      }
      if (carried) return false
      pushed += travel
      if (pushed < far) return false
      pushed = 0
      return true
    }
  }
}

/** How far a wheel event goes down, in CSS pixels: a mouse that counts in lines goes sixteen pixels a line. */
export function wheelTravel(event: WheelEvent): number {
  return event.deltaY * (event.deltaMode === 1 ? 16 : 1)
}

/**
 * Whether something between where an event landed and the element that listens would scroll with a wheel going up
 * or down: a long block inside a view, a field of several lines. The wheel is its own then, and no push.
 */
export function scrollsUnder(target: EventTarget | null, within: Element, direction: 'up' | 'down', except?: Element | null): boolean {
  for (let element = target instanceof Element ? target : null; element && element !== within; element = element.parentElement) {
    if (element === except || element.scrollHeight <= element.clientHeight + 1) continue
    const overflow = getComputedStyle(element).overflowY
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    if (direction === 'up' ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true
  }
  return false
}
