import type { Client } from '@repo/client'
import type { Access, BrowserState } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from '../settings/rows.tsx'
import { PathText } from './path-text.tsx'

/** A small globe, drawn as the system's symbols are: a circle, its meridian and two parallels. */
const GlobeMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="8" cy="8" r="5.75" />
    <ellipse cx="8" cy="8" rx="2.5" ry="5.75" />
    <path d="M2.6 6h10.8M2.6 10h10.8" />
  </svg>
)

/**
 * The web browser the assistant drives (docs/SPEC.md, section 12.1), in Settings, Access: whether it may use one,
 * which one this computer has, and a way to open its window, so the person signs in to their sites there once.
 * The browser runs where the core runs, so the core says which one it found.
 */
export function BrowserGroup({ client, access, productName }: { client: Client; access: Access; productName: string }) {
  const [browser, setBrowser] = useState<BrowserState>()
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState<'switch' | 'open'>()

  const read = useCallback(async () => {
    try {
      setBrowser((await client.session.run('browser.read', {})).browser)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The browser could not be checked.')
    }
  }, [client])

  // Whether its window is open changes when the person closes it, or when it closes unused: read again now and then.
  useEffect(() => {
    void read()
    const again = setInterval(() => void read(), 5_000)
    return () => clearInterval(again)
  }, [read])

  const turn = async (on: boolean) => {
    setProblem(undefined)
    setBusy('switch')
    try {
      await client.session.run('access.set', { browser: on })
      await read()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The change could not be saved.')
    } finally {
      setBusy(undefined)
    }
  }

  const open = async () => {
    setProblem(undefined)
    setBusy('open')
    try {
      setBrowser((await client.session.run('browser.show', {})).browser)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The browser could not be opened.')
    } finally {
      setBusy(undefined)
    }
  }

  const usable = browser?.found === true && access.browser

  return (
    <SettingGroup title="The browser" note="For sites that need you signed in, and for acting on pages">
      <SettingRow
        title="Use a web browser"
        detail={
          <span className="grid gap-1.5">
            <span>
              {`${productName} opens pages in a window you see, and clicks, types and chooses on them as “Before acting” says. Paying, sending, deleting and giving a page a file always ask first. Passwords and card details are never typed.`}
            </span>
            {browser === undefined && !problem && <span className="text-text-faint">Looking for a browser on this computer…</span>}
            {browser !== undefined && !browser.found && <span className="text-warn">{browser.problem ?? 'No browser was found on this computer.'}</span>}
          </span>
        }
      >
        <Switch label="Use a web browser" on={access.browser} disabled={busy !== undefined} onChange={(on) => void turn(on)} />
      </SettingRow>

      {browser?.found && (
        <div className={cn('flex items-center gap-4 px-4 py-3 transition-opacity duration-(--duration-calm) ease-soft', !access.browser && 'opacity-45')}>
          <span className="shrink-0 text-text-faint">
            <GlobeMark />
          </span>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex items-center gap-2 text-[0.8125rem]">
              {browser.name}
              {browser.running && (
                <span className="inline-flex items-center gap-1.5 text-text-faint text-xs">
                  <span aria-hidden="true" className="size-1.5 bg-ok" />
                  Open
                </span>
              )}
            </span>
            {browser.path && <PathText path={browser.path} className="text-text-faint" />}
          </div>
        </div>
      )}

      {browser?.found && (
        <SettingRow
          title="Sign in to your sites"
          detail={
            usable
              ? `Sign in, in its window, where you want ${productName} to act for you. The browser has a profile of its own, kept on this computer, and closes after fifteen minutes unused.`
              : 'Turn the browser on to open it.'
          }
        >
          <Button size="sm" disabled={!usable || busy !== undefined} onClick={() => void open()}>
            {busy === 'open' ? 'Opening…' : browser.running ? 'Bring it forward' : 'Open the browser'}
          </Button>
        </SettingRow>
      )}

      {problem && (
        <p role="alert" className="px-4 py-3 text-danger text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </SettingGroup>
  )
}
