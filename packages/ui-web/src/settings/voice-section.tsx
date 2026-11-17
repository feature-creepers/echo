import { SPEEDS } from '@repo/client'
import type { Persona } from '@repo/protocol'
import { playCue } from '../audio/cues.ts'
import { findDevice } from '../audio/devices.ts'
import { useAudioDevices } from '../audio/use-devices.ts'
import type { DeviceSpeech } from '../audio/use-speech.ts'
import { VoicePicker } from '../audio/voice-picker.tsx'
import { VoiceSetup } from '../audio/voice-setup.tsx'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { Choice } from '../primitives/choice.tsx'
import { Select } from '../primitives/select.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'

const PACES: Record<(typeof SPEEDS)[number], string> = { 0.85: 'Slower', 1: 'Natural', 1.15: 'Faster', 1.3: 'Fastest' }

/** The value of the list that stands for the system's own choice. */
const SYSTEM = ''

/**
 * The voice of this computer: the models it needs to hear and speak, each personality's voice, and how the
 * answers are heard: aloud or not, at what pace, on which speakers.
 */
export function VoiceSection({ speech, personas, active }: { speech: DeviceSpeech | undefined; personas: readonly Persona[]; active: Persona | undefined }) {
  const { settings, change } = useDevice()
  const outputs = useAudioDevices('audiooutput')
  const speaker = settings.speaker
  const present =
    outputs?.devices.find((device) => device.id === speaker.id) ??
    (speaker.label ? outputs?.devices.find((device) => device.label === speaker.label) : undefined)
  const missing = speaker.id !== '' && outputs !== undefined && present === undefined

  const test = () => {
    if (speech?.ready && active) speech.preview(active, `This is how ${active.name} sounds, on these speakers.`)
    else void findDevice(speaker, 'audiooutput').then((sink) => playCue('open', sink))
  }

  return (
    <div className="grid gap-10">
      {speech ? (
        <div className="grid gap-8">
          <VoiceSetup speech={speech} />
          <VoicePicker speech={speech} personas={personas} />
        </div>
      ) : (
        <p className="text-sm text-text-soft">This device cannot run speech models.</p>
      )}

      <SettingGroup title="Answers">
        <SettingRow title="Speak answers aloud" detail="Off, answers are only written under the assistant: for a quiet room, or a meeting.">
          <Switch label="Speak answers aloud" on={settings.voice.aloud} onChange={(aloud) => change({ voice: { aloud } })} />
        </SettingRow>
        <SettingRow title="Pace" detail="How fast the voice speaks." stacked>
          <div className="flex flex-wrap items-center gap-3">
            <Choice
              label="Pace"
              value={settings.voice.speed as (typeof SPEEDS)[number]}
              options={SPEEDS.map((speed) => ({ value: speed, label: PACES[speed] }))}
              onChange={(speed) => {
                change({ voice: { speed } })
                if (speech?.ready && active) speech.preview(active, 'This is the pace I will speak at.', speed)
              }}
            />
          </div>
        </SettingRow>
        <SettingRow
          title="Speakers"
          detail={
            missing
              ? 'These speakers are not connected. Until they are, the system default is used.'
              : 'Where the voice plays. The system default follows your computer.'
          }
          stacked
        >
          <div className="flex items-center gap-3">
            <Select
              label="Speakers"
              className="flex-1"
              value={present?.id ?? (missing ? speaker.id : SYSTEM)}
              options={[
                { value: SYSTEM, label: outputs?.system ? `System default · ${outputs.system}` : 'System default' },
                ...(outputs?.devices ?? []).map((device) => ({ value: device.id, label: device.label || 'Speakers' })),
                ...(missing ? [{ value: speaker.id, label: `${speaker.label || 'Speakers'} · not connected` }] : [])
              ]}
              onChange={(id) => {
                const device = outputs?.devices.find((one) => one.id === id)
                change({ speaker: device ? { id: device.id, label: device.label } : { id: '', label: '' } })
              }}
            />
            <Button size="md" onClick={test}>
              Play a test
            </Button>
          </div>
        </SettingRow>
      </SettingGroup>
    </div>
  )
}
