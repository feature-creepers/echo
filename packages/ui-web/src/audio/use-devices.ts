import type { AudioDevice } from '@repo/client'
import { useEffect, useState } from 'react'
import { type AudioKind, listDevices } from './devices.ts'

/** The audio devices of a kind on this computer, kept current as they are plugged in and out. */
export function useAudioDevices(kind: AudioKind): { system: string; devices: AudioDevice[] } | undefined {
  const [found, setFound] = useState<{ system: string; devices: AudioDevice[] }>()
  useEffect(() => {
    let live = true
    const look = () => {
      listDevices(kind)
        .then((list) => {
          if (live) setFound(list)
        })
        .catch(() => {
          if (live) setFound({ system: '', devices: [] })
        })
    }
    look()
    navigator.mediaDevices?.addEventListener('devicechange', look)
    return () => {
      live = false
      navigator.mediaDevices?.removeEventListener('devicechange', look)
    }
  }, [kind])
  return found
}
