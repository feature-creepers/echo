import { DEFAULT_DEVICE_SETTINGS, shortcutClash } from '@repo/client'
import { useEffect, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import type { ShortcutName } from '../device/host.ts'
import { Button } from '../primitives/button.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'
import { ShortcutRecorder } from './shortcut-recorder.tsx'

const SHORTCUTS: { name: ShortcutName; title: string; detail: string }[] = [
  {
    name: 'talk',
    title: 'Talk from any app',
    detail:
      'Brings the assistant forward and starts listening, wherever you are. Press it again to send. Off until you record keys: other apps lose the keys you pick, so choose ones they do not use.'
  },
  { name: 'talkInWindow', title: 'Talk in the window', detail: 'Starts listening while the window is in front. Press it again to send.' },
  { name: 'transcript', title: 'Show the transcript', detail: 'Opens and closes the conversation, written out.' }
]

/** The keys that talk to the assistant and open the transcript, each recorded by pressing them. */
export function ShortcutsSection({ productName }: { productName: string }) {
  const { settings, change, mac, host } = useDevice()
  const [problems, setProblems] = useState<Partial<Record<ShortcutName, string>>>({})
  const linux = /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)

  // The shortcut from any app may have been refused when the app started.
  useEffect(() => {
    host?.settings
      .shortcutProblem()
      .then((problem) => problem && setProblems((before) => ({ ...before, talk: problem })))
      .catch(() => undefined)
  }, [host])

  const record = async (name: ShortcutName, accelerator: string): Promise<string | undefined> => {
    const clash = shortcutClash(settings.shortcuts, name, accelerator, mac)
    if (clash) return clash
    if (!host) {
      change({ shortcuts: { [name]: accelerator } })
      return undefined
    }
    const given = await host.settings.setShortcut(name, accelerator)
    return given.ok ? undefined : given.problem
  }

  return (
    <div className="grid gap-10">
      <SettingGroup title="Keys">
        {SHORTCUTS.map(({ name, title, detail }) => {
          const value = settings.shortcuts[name]
          const usual = DEFAULT_DEVICE_SETTINGS.shortcuts[name]
          const problem = problems[name]
          return (
            <SettingRow key={name} title={title} detail={detail} problem={problem}>
              <div className="flex items-center gap-2">
                {/* Back to the usual keys; for a shortcut that is off until set, the cross in the field does that. */}
                {value !== usual && usual !== '' && (
                  <Button
                    kind="quiet"
                    size="sm"
                    onClick={() => void record(name, usual).then((refused) => setProblems((before) => ({ ...before, [name]: refused })))}
                  >
                    Reset
                  </Button>
                )}
                <ShortcutRecorder
                  label={title}
                  value={value}
                  onRecord={(accelerator) => record(name, accelerator)}
                  onProblem={(found) => setProblems((before) => ({ ...before, [name]: found }))}
                  onClear={() => void record(name, '').then((refused) => setProblems((before) => ({ ...before, [name]: refused })))}
                />
              </div>
            </SettingRow>
          )
        })}
      </SettingGroup>

      {linux && (
        <p className="max-w-2xl border-line-strong border-l-2 pl-4 text-text-soft text-xs leading-relaxed">
          Some Linux desktops (Wayland) do not let an app take keys from other apps. If talking from any app does nothing, add a shortcut in your desktop’s
          settings that starts {productName} with the option{' '}
          <code className="rounded-sm bg-raised px-1.5 py-0.5 font-mono text-[0.6875rem] text-text">--talk</code>: it brings {productName} forward and starts
          listening.
        </p>
      )}
    </div>
  )
}
