import { useEffect, useRef } from 'react'
import { useDevice } from './device.tsx'

/**
 * How hard this computer works, read when asked: the latest the app reported, from 0 to 1, or nothing where the
 * app does not say. The core's light follows it, so the machine's effort shows in the assistant's presence. The
 * function stays the same between renders, so it can be read on every frame.
 */
export function useLoad(): () => number | undefined {
  const { host } = useDevice()
  const latest = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!host?.load) return
    const stop = host.load((load) => {
      latest.current = load
    })
    return () => {
      stop()
      latest.current = undefined
    }
  }, [host])
  const read = useRef(() => latest.current)
  return read.current
}
