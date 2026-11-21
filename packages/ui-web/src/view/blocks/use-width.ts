import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The width an element is given, in pixels, kept current as the window changes. It is read before the first paint,
 * so what is drawn to it never shows at another size first; `until` stands in where nothing is laid out.
 */
export function useWidth(until = 0) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(until)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const read = (measured: number) => setWidth(Math.round(measured) || until)
    read(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => read(entry?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [until])
  return { ref, width }
}
