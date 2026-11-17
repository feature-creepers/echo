import type { Accent } from '@repo/protocol'
import { useEffect } from 'react'
import type { Mood } from '../presence/painter.ts'
import { useDevice } from './device.tsx'

/**
 * Tell the app how the assistant is: the accent of the persona that answers, and its mood. The desktop app
 * shows it in its tray's mark, so the assistant can be seen listening or asleep with the window closed.
 */
export function useShownPresence(accent: Accent | undefined, mood: Mood): void {
  const { host } = useDevice()
  useEffect(() => host?.showPresence?.({ accent, mood }), [host, accent, mood])
}
