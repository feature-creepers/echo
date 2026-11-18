import type { Client } from '@repo/client'
import type { Access, App, DesktopState } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Menu } from '../primitives/menu.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from '../settings/rows.tsx'

/** A window with a pointer over it, drawn as the system's symbols are. */
const AppMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.75" y="2.75" width="12.5" height="9.5" rx="1.5" />
    <path d="M1.75 5.25h12.5" />
    <path d="M8.5 8l4.5 1.6-2 .7-.7 2z" fill="currentColor" stroke="none" />
  </svg>
)

/**
 * The other apps of the computer (docs/SPEC.md, section 12.1, `device.screen`), in Settings, Access: whether the
 * assistant may see and operate them, the apps it may use without asking, and adding one of those open now. The apps
 * run where the core runs, so the core says whether it can reach them and which are open.
 */
export function AppsGroup({ client, access, productName }: { client: Client; access: Access; productName: string }) {
  const [desktop, setDesktop] = useState<DesktopState>()
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  const read = useCallback(async () => {
    try {
      setDesktop((await client.session.run('desktop.read', {})).desktop)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The other apps could not be checked.')
    }
  }, [client])

  useEffect(() => {
    void read()
  }, [read])

  const save = async (change: { desktop?: boolean; apps?: App[] }) => {
    setProblem(undefined)
    setBusy(true)
    try {
      await client.session.run('access.set', change)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const unlisted = (desktop?.open ?? []).filter((open) => !access.apps.some((app) => app.program === open.program))
  const usable = desktop?.available === true && access.desktop

  return (
    <SettingGroup title="Other apps" note="Or let one in when it asks: “Always allow”">
      <SettingRow
        title="Use other apps"
        detail={
          <span className="grid gap-1.5">
            <span>
              {`${productName} reads the windows of your apps and clicks, types and presses keys in them as “Before acting” says, with a frame around the window it holds. Using your mouse or keyboard stops it at once. Paying, sending and deleting always ask first; passwords are never typed.`}
            </span>
            {desktop === undefined && !problem && <span className="text-text-faint">Checking what this computer allows…</span>}
            {desktop !== undefined && !desktop.available && (
              <span className="text-warn">{desktop.problem ?? 'This computer does not let it use other apps.'}</span>
            )}
          </span>
        }
      >
        <Switch label="Use other apps" on={access.desktop} disabled={busy || desktop?.available === false} onChange={(on) => void save({ desktop: on })} />
      </SettingRow>

      {desktop?.available && (
        <div className={cn('transition-opacity duration-(--duration-calm) ease-soft', !access.desktop && 'opacity-45')}>
          {access.apps.length === 0 && (
            <SettingRow title="No app allowed yet" detail="Each app is asked for on a card the first time. Add the ones you use with it often." />
          )}
          {access.apps.map((app) => (
            <div key={app.program} className="flex items-center gap-4 px-5 py-3">
              <span className="shrink-0 text-text-faint">
                <AppMark />
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium text-sm">{app.name}</span>
                <span className="truncate font-mono text-text-faint text-xs">{app.program}</span>
              </div>
              <IconButton
                label={`Remove ${app.name}`}
                disabled={busy}
                onClick={() => void save({ apps: access.apps.filter((other) => other.program !== app.program) })}
              >
                <CloseGlyph />
              </IconButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 bg-raised/30 px-5 py-3">
            <Menu
              label="Apps open now"
              align="start"
              header={<span className="text-label text-text-faint">Open now</span>}
              trigger={(open, toggle, trigger) => (
                <Button size="sm" disabled={!usable || busy} onClick={() => (open ? toggle() : void read().then(toggle))} {...trigger.props}>
                  Add an app…
                </Button>
              )}
              items={
                unlisted.length > 0
                  ? unlisted.map((open) => ({ label: open.name, hint: open.program, onSelect: () => void save({ apps: [...access.apps, open] }) }))
                  : [{ label: 'Every app open is allowed', onSelect: () => undefined, disabled: true }]
              }
            />
          </div>
        </div>
      )}

      {problem && (
        <p role="alert" className="px-4 py-3 text-danger text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </SettingGroup>
  )
}
