import type { UpdateState } from '@repo/client'
import { useEffect, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import type { DeviceHost } from '../device/host.ts'
import { ago } from '../memory/words.ts'
import { Orb } from '../presence/orb.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Switch } from '../primitives/switch.tsx'
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

/** What the speech runs on, credited as their licences ask. */
const MODELS = [
  { name: 'NVIDIA Parakeet TDT 0.6B v3', role: 'Hears you', licence: 'CC BY 4.0' },
  { name: 'Supertonic 3', role: 'Speaks', licence: 'OpenRAIL-M' },
  { name: 'Silero VAD', role: 'Tells speech from silence', licence: 'MIT' },
  { name: 'sherpa-onnx', role: 'Runs them on this computer', licence: 'Apache 2.0' }
]

/** The version, its updates, and who made the app and what it is built on. */
export function AboutSection({ productName }: { productName: string }) {
  const { settings, change, host } = useDevice()
  const about = useAbout(host)
  const updates = useUpdates(host)

  return (
    <div className="grid gap-10">
      <div className="flex items-center gap-6 rounded-lg border border-line bg-raised/95 p-5">
        <Orb size={72} mood={updates?.is === 'checking' || updates?.is === 'downloading' ? 'thinking' : 'idle'} className="-m-2 shrink-0" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex items-baseline gap-3">
            <span className="font-medium text-2xl tracking-tight">{productName}</span>
            <span className="font-mono text-sm text-text-soft tabular-nums">{about ? `v${about.version}` : ''}</span>
          </div>
          {updates && host ? <UpdateLine state={updates} /> : <p className="text-sm text-text-soft">A personal assistant you talk to.</p>}
        </div>
        {updates && host && <UpdateAction state={updates} host={host} releases={about?.releases === true} />}
      </div>

      {updates?.is === 'downloading' && (
        <div className="-mt-7 h-1 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Download" aria-valuenow={updates.percent}>
          <div
            className="h-full origin-left bg-accent transition-transform duration-(--duration-slow) ease-soft"
            style={{ transform: `scaleX(${Math.max(3, updates.percent) / 100})` }}
          />
        </div>
      )}

      <SettingGroup title="Updates">
        <SettingRow
          title="Update automatically"
          detail={`New versions download in the background and install when ${productName} quits, so an update never cuts into a conversation. Off, you are told and choose when.`}
        >
          <Switch label="Update automatically" on={settings.updates.automatic} onChange={(automatic) => change({ updates: { automatic } })} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Made by">
        <div className="grid gap-4 px-5 py-5">
          <p className="text-sm leading-relaxed">
            <Author name="Rodolphe Barbanneau" page="https://github.com/rodolphebarbanneau" /> and{' '}
            <Author name="Tommy Sendra" page="https://github.com/doudandyx" />.
            <span className="text-text-soft"> Free and open source, under the MIT licence.</span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 font-mono text-xs">
            {about && (
              <>
                <dt className="text-text-faint">Version</dt>
                <dd className="text-text-soft tabular-nums">{about.version}</dd>
                <dt className="text-text-faint">System</dt>
                <dd className="text-text-soft">{SYSTEMS[about.system] ?? about.system}</dd>
                <dt className="text-text-faint">Electron</dt>
                <dd className="text-text-soft tabular-nums">{about.electron}</dd>
              </>
            )}
          </dl>
        </div>
      </SettingGroup>

      <SettingGroup title="Speech, on this computer">
        {MODELS.map((model) => (
          <div key={model.name} className="flex items-center justify-between gap-6 px-5 py-3">
            <div className="grid gap-0.5">
              <span className="text-sm">{model.name}</span>
              <span className="text-text-soft text-xs">{model.role}</span>
            </div>
            <Eyebrow>{model.licence}</Eyebrow>
          </div>
        ))}
      </SettingGroup>
    </div>
  )
}

/** An author's name, which opens their page in the person's browser. */
function Author({ name, page }: { name: string; page: string }) {
  return (
    <a
      href={page}
      target="_blank"
      rel="noreferrer"
      title={page.replace(/^https:\/\//, '')}
      className="rounded-xs underline decoration-white/25 underline-offset-4 transition-colors duration-(--duration-quick) ease-soft hover:decoration-white/70 focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      {name}
    </a>
  )
}

/** Where the updates stand, in a line. */
function UpdateLine({ state }: { state: UpdateState }) {
  const [text, tone] = ((): [string, 'soft' | 'ok' | 'accent' | 'danger'] => {
    switch (state.is) {
      case 'unavailable':
        return [state.reason, 'soft']
      case 'idle':
        return ['Looks for new versions by itself.', 'soft']
      case 'checking':
        return ['Looking for a new version…', 'accent']
      case 'latest':
        return [`Up to date · checked ${ago(state.checkedAt, new Date())}`, 'ok']
      case 'available':
        return [
          state.page
            ? `Version ${state.latest} is out. On a Mac, this build cannot install it by itself yet: download it from the releases page.`
            : `Version ${state.latest} is out.`,
          'accent'
        ]
      case 'downloading':
        return [`Downloading version ${state.latest} · ${state.percent}%`, 'accent']
      case 'ready':
        return [`Version ${state.latest} is ready. It installs when you quit, or restart now.`, 'accent']
      case 'failed':
        return [state.problem, 'danger']
    }
  })()
  return (
    <p
      aria-live="polite"
      className={cn('flex items-center gap-2 text-sm leading-relaxed', tone === 'accent' ? 'text-text' : tone === 'danger' ? 'text-danger' : 'text-text-soft')}
    >
      {tone === 'ok' && <span className="size-1.5 shrink-0 rounded-full bg-ok" />}
      {tone === 'accent' && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
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
