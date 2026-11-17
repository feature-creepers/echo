import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { cn } from '../primitives/cn.ts'
import { reachInWords } from './words.ts'

/** The event that asks the app to show the Access settings. */
export const OPEN_ACCESS_EVENT = 'echo:open-access'

/**
 * What the assistant may reach on this computer, in a few words, beside the name of the AI program in the
 * bottom bar. There to read at a glance; pressed, it opens the Access settings.
 */
export function AccessIndicator({ client }: { client: Client }) {
  const snapshot = useFollowed(client.settings)
  if (snapshot.state !== 'ready') return null
  const { access } = snapshot.settings
  const { reach, approvals } = reachInWords(access)
  const wide = access.computer !== 'off'
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_ACCESS_EVENT))}
      title="What the assistant may reach on this computer. Change it in Settings, Access."
      className="mr-4 flex h-4 items-center gap-1.5 font-mono text-[0.625rem] text-text-faint/70 uppercase tracking-[0.12em] transition-colors duration-(--duration-quick) hover:text-text-soft"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
      </svg>
      <span className={cn(wide && 'text-warn/80')}>{reach}</span>
      <span aria-hidden="true">·</span>
      <span>{approvals}</span>
    </button>
  )
}
