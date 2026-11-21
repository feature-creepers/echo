import type { EnginesState } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { HarnessState } from '@repo/protocol'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'

/** Where a harness stands, in a few words and a colour. */
export function standing(harness: HarnessState): { tone: 'ok' | 'warn' | 'off'; text: string } {
  if (!harness.installed) return { tone: 'off', text: 'Not installed' }
  if (harness.problem) return { tone: 'warn', text: harness.problem }
  if (!harness.signedIn) return { tone: 'warn', text: 'Not signed in' }
  return { tone: 'ok', text: harness.account ? `Ready · ${harness.account}` : 'Ready' }
}

export const TONES = { ok: 'bg-ok', warn: 'bg-warn', off: 'bg-text-faint/50' }

/** Look for the AI programs again, and whether a look is under way. One that fails leaves what was last known. */
export function useLookAgain(engines: EnginesState): { looking: boolean; look(): void } {
  const [looking, setLooking] = useState(false)
  const look = () => {
    setLooking(true)
    engines
      .refresh()
      .catch(() => undefined)
      .finally(() => setLooking(false))
  }
  return { looking, look }
}

/**
 * The AI programs the assistant can run on, one row each: whether it is installed and signed in, with a way
 * to sign in and to look again. Used at first launch and in settings.
 */
export function EngineRows({ engines }: { engines: EnginesState }) {
  const known = useFollowed(engines)
  const { looking, look } = useLookAgain(engines)

  if (!known) return <p className="text-text-faint text-xs">Looking for the AI programs on this machine…</p>

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {known.harnesses.map((harness) => {
          const { tone, text } = standing(harness)
          return (
            <li key={harness.id} className="flex items-center gap-4 border border-line bg-raised/95 px-4 py-3.5">
              <span className={cn('size-2 shrink-0', TONES[tone])} />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium text-sm">
                  {harness.name}
                  {harness.id === known.active && <span className="ml-2 font-medium text-accent text-label">In use</span>}
                </span>
                <span className="truncate text-text-soft text-xs" title={text}>
                  {text}
                  {harness.version && tone === 'ok' ? ` · ${harness.version}` : ''}
                </span>
              </div>
              {harness.installed && !harness.signedIn && (
                <Button size="sm" onClick={() => void engines.signIn(harness.id).catch(() => undefined)}>
                  Sign in
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-3">
        <Button kind="quiet" size="sm" disabled={looking} onClick={look}>
          {looking ? 'Looking…' : 'Check again'}
        </Button>
        {known.active === undefined && <span className="text-text-soft text-xs">Install Claude Code or Codex and sign in with your own account.</span>}
      </div>
    </div>
  )
}
