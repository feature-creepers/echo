import { useEffect, useState } from 'react'

/** Whether a scroll area holds more than it shows, above and below. */
export interface ScrollEdges {
  above: boolean
  below: boolean
}

const NONE: ScrollEdges = { above: false, below: false }

/**
 * The edges where a scroll area cuts what it holds, kept current as it scrolls and as it or its content changes
 * size. Give the returned ref to the scroll area. A fade is then drawn only where something is cut: a mask costs
 * the compositor on every frame something moves over it, so none is left on an area that has nothing to fade.
 */
export function useScrollEdges(): [(element: HTMLElement | null) => void, ScrollEdges] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [edges, setEdges] = useState(NONE)

  useEffect(() => {
    if (!element) return setEdges(NONE)
    // The height of what it holds is read from the layout, not from scrollHeight: something gliding into place moves
    // by a transform, which adds to scrollHeight for as long as it moves, and nothing says when it stops.
    const measure = () => {
      const content = element.firstElementChild
      const padding = getComputedStyle(element)
      const height =
        content instanceof HTMLElement ? content.offsetHeight + Number.parseFloat(padding.paddingTop) + Number.parseFloat(padding.paddingBottom) : 0
      const above = element.scrollTop > 1
      const below = element.scrollTop + element.clientHeight < height - 1
      setEdges((was) => (was.above === above && was.below === below ? was : { above, below }))
    }
    measure()
    element.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => {
      element.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [element])

  return [setElement, edges]
}
