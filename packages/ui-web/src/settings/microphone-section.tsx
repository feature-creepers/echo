import { PAUSES, type Pause } from '@repo/client'
import { useAudioDevices } from '../audio/use-devices.ts'
import { type Hearing, useLevel } from '../audio/use-level.ts'
import { useDevice } from '../device/device.tsx'
import { Choice } from '../primitives/choice.tsx'
import { cn } from '../primitives/cn.ts'
import { Select } from '../primitives/select.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'

const PAUSE_LABELS: Record<Pause, string> = { short: 'Short', normal: 'Normal', long: 'Long', never: 'Never' }
const PAUSE_DETAILS: Record<Pause, string> = {
  short: 'It sends what you said after a short pause. Quick, but a hesitation can cut you off.',
  normal: 'It sends what you said after a natural pause.',
  long: 'It waits longer before sending, for when you think as you speak.',
  never: 'It listens until you press the shortcut again.'
}

/** The value of the list that stands for the system's own choice. */
const SYSTEM = ''

/** The microphone this computer listens with, what it hears right now, and how listening ends. */
export function MicrophoneSection() {
  const { settings, change } = useDevice()
  const found = useAudioDevices('audioinput')
  const chosen = settings.microphone
  const hearing = useLevel(chosen)
  // Found by its identifier, or by its name when the identifier changed: the same rule as when it is opened.
  const present =
    found?.devices.find((device) => device.id === chosen.id) ?? (chosen.label ? found?.devices.find((device) => device.label === chosen.label) : undefined)
  const missing = chosen.id !== '' && found !== undefined && present === undefined

  const options = [
    { value: SYSTEM, label: found?.system ? `System default · ${found.system}` : 'System default' },
    ...(found?.devices ?? []).map((device) => ({ value: device.id, label: device.label || 'Microphone' })),
    ...(missing ? [{ value: chosen.id, label: `${chosen.label || 'Microphone'} · not connected` }] : [])
  ]

  return (
    <div className="grid gap-10">
      <SettingGroup title="Microphone">
        <SettingRow
          title="Listen with"
          detail={
            missing
              ? 'This microphone is not connected. Until it is, the system default is used.'
              : 'The system default follows the microphone your computer uses. Pick one to keep to it.'
          }
          stacked
        >
          <Select
            label="Microphone"
            value={present?.id ?? (missing ? chosen.id : SYSTEM)}
            options={options}
            onChange={(id) => {
              const device = found?.devices.find((one) => one.id === id)
              change({ microphone: device ? { id: device.id, label: device.label } : { id: '', label: '' } })
            }}
          />
        </SettingRow>
        <div className="px-5 pt-1 pb-5">
          <LevelMeter hearing={hearing} />
        </div>
      </SettingGroup>

      <SettingGroup title="Listening">
        <SettingRow title="End after a pause" detail={PAUSE_DETAILS[settings.listening.pause]} stacked>
          <Choice
            label="End after a pause"
            value={settings.listening.pause}
            options={PAUSES.map((pause) => ({ value: pause, label: PAUSE_LABELS[pause] }))}
            onChange={(pause) => change({ listening: { pause } })}
          />
        </SettingRow>
        <SettingRow title="Sounds" detail="A soft tone when it starts listening, and another when it stops.">
          <Switch label="Sounds" on={settings.listening.sounds} onChange={(sounds) => change({ listening: { sounds } })} />
        </SettingRow>
      </SettingGroup>
    </div>
  )
}

/** How many bars the meter has: enough to move smoothly, few enough to read at a glance. */
const BARS = 36

/** What the microphone hears, as a row of bars, and in words when something is wrong. */
function LevelMeter({ hearing }: { hearing: Hearing }) {
  const level = hearing.is === 'open' ? hearing.level : 0
  const lit = Math.round(level * BARS)
  const words =
    hearing.is === 'opening'
      ? { tone: 'faint', text: 'Opening the microphone…' }
      : hearing.is === 'failed'
        ? { tone: 'danger', text: hearing.problem }
        : hearing.silent
          ? { tone: 'warn', text: 'No sound at all. The microphone may be muted, or held by another app.' }
          : hearing.heard
            ? { tone: 'ok', text: 'It hears you.' }
            : { tone: 'faint', text: 'Say something to see the level.' }

  return (
    <div className="grid gap-3">
      <meter className="sr-only" aria-label="Microphone level" min={0} max={1} value={level} />
      <div aria-hidden="true" className="flex h-9 items-end gap-[3px]">
        {Array.from({ length: BARS }, (_, index) => {
          const on = index < lit
          // The bars rise in height left to right, as a level grows.
          const height = 30 + (70 * index) / (BARS - 1)
          return (
            <span
              key={index}
              style={{ height: `${height}%` }}
              className={cn(
                'flex-1 rounded-[1.5px] transition-colors duration-75',
                on ? (index > BARS * 0.86 ? 'bg-warn' : 'bg-accent shadow-[0_0_8px_-1px_var(--accent)]') : 'bg-raised'
              )}
            />
          )
        })}
      </div>
      <p
        className={cn(
          'flex items-center gap-2 text-xs',
          words.tone === 'danger' ? 'text-danger' : words.tone === 'warn' ? 'text-warn' : words.tone === 'ok' ? 'text-ok' : 'text-text-faint'
        )}
        aria-live="polite"
      >
        {words.tone === 'ok' && <span className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" />}
        {words.text}
      </p>
    </div>
  )
}
