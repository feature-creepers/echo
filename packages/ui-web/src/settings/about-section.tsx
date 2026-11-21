import type { UpdateState } from '@repo/client'
import { useEffect, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import type { DeviceHost } from '../device/host.ts'
import { ago } from '../memory/words.ts'
import { Eye } from '../presence/eye.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Switch } from '../primitives/switch.tsx'
import { TextLink } from '../primitives/text-link.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'
import { useAbout } from './use-about.ts'

/** Where the app stands with its updates, kept current. */
function useUpdates(host: DeviceHost | undefined): UpdateState | undefined {
  const [state, setState] = useState<UpdateState>()
  useEffect(() => {
    if (!host) return
    const stop = host.updates.onState(setState)
    host.updates
      .state()
      .then(setState)
      .catch(() => undefined)
    return stop
  }, [host])
  return state
}

const SYSTEMS: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

/** The version, its updates, and who made the app. */
export function AboutSection({ productName }: { productName: string }) {
  const { settings, change, host } = useDevice()
  const about = useAbout(host)
  const updates = useUpdates(host)

  return (
    <div className="grid gap-10">
      <div className="grid gap-3">
        <div className="flex items-center gap-5">
          <Eye size={64} mood={updates?.is === 'checking' || updates?.is === 'downloading' ? 'thinking' : 'idle'} className="shrink-0" />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <div className="flex items-baseline gap-3">
              <span className="display text-[2rem] leading-7">{productName}</span>
              <span className="font-mono text-text-soft text-xs tabular-nums">{about ? `v${about.version}` : ''}</span>
            </div>
            {updates && host ? <UpdateLine state={updates} /> : <p className="text-[0.8125rem] text-text-soft">A personal assistant you talk to.</p>}
          </div>
          {updates && host && <UpdateAction state={updates} host={host} releases={about?.releases === true} />}
        </div>

        {updates?.is === 'downloading' && (
          <div
            className="h-1.5 overflow-hidden shadow-[inset_0_-1px_0_var(--color-line-strong)]"
            role="progressbar"
            aria-label="Download"
            aria-valuenow={updates.percent}
          >
            <div
              className="h-full origin-left bg-text transition-transform duration-(--duration-slow) ease-soft"
              style={{ transform: `scaleX(${Math.max(3, updates.percent) / 100})` }}
            />
          </div>
        )}
      </div>

      <SettingGroup title="Updates">
        <SettingRow
          title="Update automatically"
          detail={`New versions download in the background and install when ${productName} quits, so an update never cuts into a conversation. Off, you are told and choose when.`}
        >
          <Switch label="Update automatically" on={settings.updates.automatic} onChange={(automatic) => change({ updates: { automatic } })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Made by">
        <p className="py-3 text-[0.8125rem] leading-relaxed">
          <TextLink href="https://github.com/rodolphebarbanneau">Rodolphe Barbanneau</TextLink> and{' '}
          <TextLink href="https://github.com/doudandyx">Tommy Sendra</TextLink>.
          <span className="text-text-soft"> Free and open source, under the MIT licence.</span>
        </p>
        {about && (
          <dl className="divide-y divide-line">
            {[
              ['Version', about.version],
              ['System', SYSTEMS[about.system] ?? about.system],
              ['Electron', about.electron]
            ].map(([term, value]) => (
              <div key={term} className="flex items-baseline gap-4 py-2">
                <dt className="caps w-32 shrink-0 text-text-faint">{term}</dt>
                <dd className="font-mono text-text-soft text-xs tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </SettingGroup>
    </div>
  )
}

/** Where the updates stand, in a line. */
function UpdateLine({ state }: { state: UpdateState }) {
  const [text, tone] = ((): [string, 'soft' | 'ok' | 'pending' | 'danger'] => {
    switch (state.is) {
      case 'unavailable':
        return [state.reason, 'soft']
      case 'idle':
        return ['Looks for new versions by itself.', 'soft']
      case 'checking':
        return ['Looking for a new version…', 'pending']
      case 'latest':
        return [`Up to date · checked ${ago(state.checkedAt, new Date())}`, 'ok']
      case 'available':
        return [
          state.page
            ? `Version ${state.latest} is out. On a Mac, this build cannot install it by itself yet: download it from the releases page.`
            : `Version ${state.latest} is out.`,
          'pending'
        ]
      case 'downloading':
        return [`Downloading version ${state.latest} · ${state.percent}%`, 'pending']
      case 'ready':
        return [`Version ${state.latest} is ready. It installs when you quit, or restart now.`, 'pending']
      case 'failed':
        return [state.problem, 'danger']
    }
  })()
  return (
    <p
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 text-[0.8125rem] leading-relaxed',
        tone === 'soft' ? 'text-text-soft' : tone === 'danger' ? 'text-danger' : 'text-text'
      )}
    >
      {tone === 'ok' && <span className="size-2 shrink-0 bg-ok" />}
      {tone === 'pending' && <span className="hatch size-2 shrink-0 border border-line-strong text-text" />}
      {text}
    </p>
  )
}

/** The one thing to do about the updates now. */
function UpdateAction({ state, host, releases }: { state: UpdateState; host: DeviceHost; releases: boolean }) {
  if (state.is === 'ready') {
    return (
      <Button kind="primary" onClick={() => void host.updates.install()}>
        Restart to update
      </Button>
    )
  }
  if (state.is === 'available') {
    return state.page ? (
      <Button kind="primary" onClick={() => void host.openReleases()}>
        Open the releases page
      </Button>
    ) : (
      <Button kind="primary" onClick={() => void host.updates.download()}>
        Download
      </Button>
    )
  }
  if (state.is === 'unavailable') {
    return releases ? <Button onClick={() => void host.openReleases()}>Releases</Button> : null
  }
  return (
    <Button disabled={state.is === 'checking' || state.is === 'downloading'} onClick={() => void host.updates.check()}>
      {state.is === 'checking' ? 'Checking…' : 'Check for updates'}
    </Button>
  )
}
