/**
 * Calls `frame` on every frame while the window is shown and the element is in view, and `resume` before the first
 * frame after a pause, so the time away is not lived through. Returns what stops it.
 */
export function whileSeen(element: Element, frame: (now: number) => void, resume?: () => void): () => void {
  let id = 0
  let onScreen = true
  const run = () => {
    if (!id && onScreen && document.visibilityState === 'visible') id = requestAnimationFrame(tick)
  }
  const tick = (now: number) => {
    id = 0
    frame(now)
    run()
  }
  const pause = () => {
    cancelAnimationFrame(id)
    id = 0
  }
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return pause()
    resume?.()
    run()
  }
  // Several records can come at once for the one element; the last says where it is now.
  const watch = new IntersectionObserver((entries) => {
    onScreen = entries.at(-1)?.isIntersecting ?? true
    if (!onScreen) return pause()
    resume?.()
    run()
  })
  document.addEventListener('visibilitychange', onVisibility)
  watch.observe(element)
  run()
  return () => {
    pause()
    document.removeEventListener('visibilitychange', onVisibility)
    watch.disconnect()
  }
}
