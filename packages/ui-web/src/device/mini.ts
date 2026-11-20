import { matchesShortcut } from '@repo/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { keyPress, useDevice } from './device.tsx'

/** Mini, as the interface follows it: whether the window is Mini now, and the way to make it so or not. */
export interface MiniWindow {
  on: boolean
  set(on: boolean): void
}

/**
 * Whether the window is Mini (docs/SPEC.md, section 13.2), kept current whoever changes it, and its key, a setting of
 * this device, which makes it Mini or the full window again. With no app to make the window small, it never is.
 */
export function useMiniWindow(): MiniWindow {
  const { host, settings, mac } = useDevice()
  const mini = host?.mini
  const [on, setOn] = useState(false)
  const now = useRef(on)
  now.current = on

  useEffect(() => {
    if (!mini) return
    const stop = mini.onChange(setOn)
    mini
      .read()
      .then(setOn)
      .catch(() => undefined)
    return stop
  }, [mini])

  const key = settings.shortcuts.mini
  useEffect(() => {
    if (!mini || key === '') return
    const onKey = (event: KeyboardEvent) => {
      if (!matchesShortcut(keyPress(event), key, mac)) return
      event.preventDefault()
      mini.set(!now.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mini, key, mac])

  return useMemo(() => ({ on, set: (next: boolean) => mini?.set(next) }), [on, mini])
}
