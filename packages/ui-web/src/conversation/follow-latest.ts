import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** How near its end, in pixels, a scroll area still counts as at its end: a nudge of the wheel does not leave it. */
const AT_END = 32

export interface FollowLatest {
  /** Give it to the scroll area. Its first child holds the content, and stays the same element. */
  ref: (element: HTMLElement | null) => void
  /** The scroll area, once given. */
  area: HTMLElement | null
  /** Whether the person has scrolled away from the end, far enough to want a way back. */
  away: boolean
  /** Go back to the end, and follow it again. */
  toLatest(): void
}

/**
 * A scroll area read from its end, as a conversation is: it opens at its latest line and stays there as what it
 * holds grows, as long as the person has not scrolled away; once they have, nothing moves under their eyes, and
 * what is added above them, earlier lines read as they scroll up, leaves what they read where it was.
 *
 * `first` names the first thing the area holds: when it changes for an earlier one, lines were added above.
 */
export function useFollowLatest(first: string | undefined): FollowLatest {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [away, setAway] = useState(false)
  // Whether the area follows its end, and what it held at the last look: kept outside the render, read on each change.
  const follow = useRef(true)
  const seen = useRef<{ first: string | undefined; height: number }>({ first: undefined, height: 0 })
  // On its way back to the end: what it passes on the way does not count as the person scrolling away.
  const returning = useRef(false)

  // After each change of what it holds, before it is painted: at the end if it follows it, else in place.
  useLayoutEffect(() => {
    if (!element) return
    const was = seen.current
    if (was.first !== undefined && first !== was.first && !follow.current) element.scrollTop += element.scrollHeight - was.height
    else if (follow.current) element.scrollTop = element.scrollHeight
    seen.current = { first, height: element.scrollHeight }
  })

  useEffect(() => {
    if (!element) return
    const look = () => {
      const fromEnd = element.scrollHeight - element.scrollTop - element.clientHeight
      follow.current = returning.current || fromEnd <= AT_END
      setAway(!returning.current && fromEnd > element.clientHeight / 2)
      seen.current = { ...seen.current, height: element.scrollHeight }
    }
    const arrived = () => {
      returning.current = false
      look()
    }
    // The person taking the wheel, the bar or the keys on the way back stops it there.
    const taken = () => {
      returning.current = false
    }
    // What grows without a render, a step opening or a picture arriving, keeps the end in sight if it was.
    const grown = () => {
      if (follow.current) element.scrollTop = element.scrollHeight
      look()
    }
    element.addEventListener('scroll', look, { passive: true })
    element.addEventListener('scrollend', arrived)
    element.addEventListener('wheel', taken, { passive: true })
    element.addEventListener('pointerdown', taken)
    element.addEventListener('keydown', taken)
    const observer = new ResizeObserver(grown)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => {
      element.removeEventListener('scroll', look)
      element.removeEventListener('scrollend', arrived)
      element.removeEventListener('wheel', taken)
      element.removeEventListener('pointerdown', taken)
      element.removeEventListener('keydown', taken)
      observer.disconnect()
    }
  }, [element])

  const toLatest = useCallback(() => {
    if (!element) return
    follow.current = true
    setAway(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.scrollTop = element.scrollHeight
      return
    }
    returning.current = true
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [element])

  return { ref: setElement, area: element, away, toLatest }
}
