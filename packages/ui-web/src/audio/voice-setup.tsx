import { describeShortcut } from '@repo/client'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import type { DeviceSpeech } from './use-speech.ts'

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/**
 * The voice of this device: the models it needs to hear and speak, which run on this computer and send no
 * sound anywhere, and their download. Used at first launch and in settings.
 */
export function VoiceSetup({ speech }: { speech: DeviceSpeech }) {
  const { readiness, install } = speech
  const { settings, mac } = useDevice()
  const talkKey = settings.shortcuts.talkInWindow
  if (!readiness) return <p className="text-text-faint text-xs">Looking at the voice models on this computer…</p>

  const missing = readiness.models.filter((model) => !model.installed)
  const total = missing.reduce((sum, model) => sum + model.bytes, 0)
  const progress = install.is === 'running' && install.progress ? install.progress.received / Math.max(1, install.progress.total) : 0

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {readiness.models.map((model) => (
          <li key={model.id} className="flex items-center gap-4 rounded-md border border-line bg-raised/95 px-4 py-3.5">
            <span className={cn('size-2 shrink-0 rounded-full', model.installed ? 'bg-ok' : 'bg-text-faint/50')} />
            <span className="flex-1 text-sm">{model.name}</span>
            <span className="text-text-soft text-xs">{model.installed ? 'Installed' : megabytes(model.bytes)}</span>
          </li>
        ))}
      </ul>

      {readiness.ready ? (
        <p className="text-sm text-text-soft">Ready. Press {talkKey ? `${describeShortcut(talkKey, mac)}, or ` : ''}the microphone, to talk.</p>
      ) : install.is === 'running' ? (
        <div className="grid gap-2">
          <div
            role="progressbar"
            aria-label="The voice's download"
            aria-valuenow={Math.round(progress * 100)}
            className="h-1 overflow-hidden rounded-full bg-white/[0.06]"
          >
            <div
              className="h-full origin-left rounded-full bg-accent transition-transform duration-(--duration-calm) ease-soft"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <span className="text-text-soft text-xs tabular-nums">
            {install.progress ? `${megabytes(install.progress.received)} of ${megabytes(install.progress.total)}` : 'Starting the download…'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <Button kind="primary" onClick={speech.startInstall}>
            Download the voice · {megabytes(total)}
          </Button>
          {install.is === 'failed' && <span className="text-danger text-sm">{install.reason}</span>}
        </div>
      )}
    </div>
  )
}
