import { DEFAULT_DEVICE_SETTINGS, shortcutClash } from '@repo/client'
import { useEffect, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import type { ShortcutName } from '../device/host.ts'
import { Button } from '../primitives/button.tsx'
import { SettingGroup } from './rows.tsx'
import { ShortcutRecorder } from './shortcut-recorder.tsx'

const SHORTCUTS: { name: ShortcutName; title: string; detail: string }[] = [
  {
    name: 'talk',
    title: 'Talk from any app',
    detail: 'Brings the assistant forward and starts listening, wherever you are. Press it again to send.'
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
            <div key={name} className="grid gap-2.5 px-5 py-4">
              <div className="flex items-center justify-between gap-8">
                <div className="grid min-w-0 gap-1">
                  <span className="font-medium text-sm">{title}</span>
                  <span className="max-w-md text-text-soft text-xs leading-relaxed">{detail}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {value !== usual && (
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
                  />
                </div>
              </div>
              {problem && (
                <p role="alert" className="text-danger text-xs">
                  {problem}
                </p>
              )}
            </div>
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
