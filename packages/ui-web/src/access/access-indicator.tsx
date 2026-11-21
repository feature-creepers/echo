import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { CommandInput } from '@repo/protocol'
import { useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { Menu } from '../primitives/menu.tsx'
import { LEVELS, reachInWords } from './words.ts'

/** The look of the words under the composer that open a menu: quiet until pointed at, lit while their menu is open. */
export const BAR_LABEL =
  'flex h-5 items-center gap-1.5 px-1.5 text-[0.6875rem] text-text-faint transition-colors duration-(--duration-quick) hover:bg-text/[0.06] hover:text-text-soft aria-expanded:bg-text/[0.07] aria-expanded:text-text-soft'

/**
 * What the assistant may reach on this computer, in a few words, under the composer beside the name of the AI
 * program. Pressed, it opens a menu right there to change how far it reaches and whether it asks first, the same
 * choices as the Access settings, which its last entry opens for the rest: folders and files to give.
 */
export function AccessIndicator({ client, onOpenSettings }: { client: Client; onOpenSettings(): void }) {
  const snapshot = useFollowed(client.settings)
  const [failed, setFailed] = useState<string>()
  if (snapshot.state !== 'ready') return null
  const { access } = snapshot.settings
  const { reach, approvals } = reachInWords(access)
  /** What was given, whatever the reach beyond it: "Own folder, 2 folders". */
  const given = reachInWords({ ...access, computer: 'off' }).reach
  const wide = access.computer !== 'off'

  const change = (asked: CommandInput<'access.set'>) => {
    setFailed(undefined)
    client.session.run('access.set', asked).catch((error: unknown) => setFailed(error instanceof Error ? error.message : 'The change could not be saved.'))
  }

  return (
    <Menu
      side="top"
      align="end"
      label="What the assistant may reach"
      className="w-[17.5rem]"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          onClick={(event) => {
            setFailed(undefined)
            props.onClick?.(event)
          }}
          aria-label={`What the assistant may reach: ${reach}, ${approvals}`}
          title={failed}
          className={BAR_LABEL}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
          </svg>
          <span className={cn(wide && 'text-warn/80')}>{reach}</span>
          <span aria-hidden="true">·</span>
          {failed ? <span className="text-danger">not changed</span> : <span className={cn(access.approvals === 'auto' && 'text-warn/80')}>{approvals}</span>}
        </button>
      )}
      items={[
        { heading: 'Scope' },
        {
          label: 'Only what you gave',
          detail: given === 'No files' ? 'Nothing yet: add folders in the settings' : given,
          checked: access.computer === 'off',
          onSelect: () => change({ computer: 'off' })
        },
        {
          label: 'Read everything',
          detail: 'Every file you can read, private ones too',
          checked: access.computer === 'read',
          warn: access.computer === 'read',
          onSelect: () => change({ computer: 'read' })
        },
        {
          label: 'Read & change everything',
          detail: 'Every file, and any command',
          checked: access.computer === 'write',
          warn: access.computer === 'write',
          onSelect: () => change({ computer: 'write' })
        },
        { divider: true },
        { heading: 'Before acting' },
        {
          label: LEVELS.ask.label,
          detail: 'Changes and commands are asked',
          checked: access.approvals === 'ask',
          onSelect: () => change({ approvals: 'ask' })
        },
        {
          label: LEVELS.trust.label,
          detail: 'Changes within what you gave go ahead',
          checked: access.approvals === 'trust',
          onSelect: () => change({ approvals: 'trust' })
        },
        {
          label: LEVELS.auto.label,
          detail: 'Only deleting and publishing are still asked',
          checked: access.approvals === 'auto',
          warn: access.approvals === 'auto',
          onSelect: () => change({ approvals: 'auto' })
        },
        { divider: true },
        { label: 'Access settings…', onSelect: onOpenSettings }
      ]}
    />
  )
}
