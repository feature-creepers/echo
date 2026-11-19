import { type Client, SPEEDS } from '@repo/client'
import { type BackgroundResult, type CommandInput, type Interruptions, LANGUAGES, type Languages, type Persona } from '@repo/protocol'
import { useState } from 'react'
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

/** What the assistant does when an answer is done while the person is on another topic. */
const RESULTS: readonly { value: BackgroundResult; label: string }[] = [
  { value: 'mention', label: 'Mention it' },
  { value: 'chip', label: 'Chip only' },
  { value: 'speak', label: 'Say it' }
]

/** How many times an hour at most the assistant speaks up by itself; 0 stands for no cap. */
const CAPS: readonly { value: number; label: string }[] = [
  { value: 4, label: '4 an hour' },
  { value: 12, label: '12 an hour' },
  { value: 30, label: '30 an hour' },
  { value: 0, label: 'No limit' }
]

/** The value of the list that stands for the system's own choice. */
const SYSTEM = ''

/** The languages the person may speak in, those the speech recognition hears, after finding it by itself. */
const SPOKEN = [
  { value: 'auto', label: 'Auto-detect', description: 'Found from what you say' },
  ...LANGUAGES.filter((language) => language.heard).map((language) => ({ value: language.code, label: language.name }))
]
/** The languages the assistant may answer in, after the one the person speaks. */
const ANSWERS = [
  { value: 'spoken', label: 'As spoken', description: 'The language you speak to it in' },
  ...LANGUAGES.map((language) => ({ value: language.code, label: language.name }))
]

interface VoiceSectionProps {
  client: Client
  /** The languages of the conversation: the user's, not this computer's. */
  languages: Languages
  /** When the assistant speaks up by itself: the user's, not this computer's. */
  interruptions: Interruptions
  speech: DeviceSpeech | undefined
  personas: readonly Persona[]
  active: Persona | undefined
}

/**
 * The voice of this computer: the models it needs to hear and speak, each personality's voice, the languages
 * spoken and answered in, and how the answers are heard: aloud or not, at what pace, on which speakers.
 */
export function VoiceSection({ client, languages, interruptions, speech, personas, active }: VoiceSectionProps) {
  const { settings, change } = useDevice()
  const [problem, setProblem] = useState<string>()
  const setLanguages = (asked: CommandInput<'languages.set'>) => {
    setProblem(undefined)
    client.session.run('languages.set', asked).catch((error: unknown) => setProblem(error instanceof Error ? error.message : 'The change could not be saved.'))
  }
  const [interruptionProblem, setInterruptionProblem] = useState<string>()
  const setInterruptions = (asked: CommandInput<'interruptions.set'>) => {
    setInterruptionProblem(undefined)
    client.session
      .run('interruptions.set', asked)
      .catch((error: unknown) => setInterruptionProblem(error instanceof Error ? error.message : 'The change could not be saved.'))
  }
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

      <SettingGroup title="Languages" note="On every device">
        <SettingRow title="You speak" detail="The language you talk to it in. Auto-detect finds it from what you say.">
          <Select
            label="You speak"
            className="w-56"
            value={languages.spoken as string}
            options={SPOKEN}
            onChange={(spoken) => setLanguages({ spoken: spoken as Languages['spoken'] })}
          />
        </SettingRow>
        <SettingRow title="It answers in" detail="The language it answers and speaks in." problem={problem}>
          <Select
            label="It answers in"
            className="w-56"
            value={languages.answers as string}
            options={ANSWERS}
            onChange={(answers) => setLanguages({ answers: answers as Languages['answers'] })}
          />
        </SettingRow>
      </SettingGroup>

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

      <SettingGroup title="Speaking up by itself" note="On every device">
        <SettingRow
          title="An answer finished in the background"
          detail="Done while you were on another topic: a word at the next pause that it is ready, only its chip under the caption, or the answer itself at the next pause, with its view. In the quiet hours, or past the most below, only the chip."
          problem={interruptionProblem}
          stacked
        >
          <Choice
            label="An answer finished in the background"
            value={interruptions.results}
            options={RESULTS}
            onChange={(results) => setInterruptions({ results })}
          />
        </SettingRow>
        <SettingRow
          title="How often, at most"
          detail="Reminders said aloud, scheduled tasks' answers and answers finished in the background, together. Past it, they are shown with a silent notification, and not said."
          stacked
        >
          <Choice
            label="How often, at most"
            value={interruptions.perHour ?? 0}
            options={
              CAPS.some((cap) => cap.value === (interruptions.perHour ?? 0))
                ? CAPS
                : [...CAPS, { value: interruptions.perHour ?? 0, label: `${interruptions.perHour} an hour` }]
            }
            onChange={(cap) => setInterruptions({ perHour: cap === 0 ? null : cap })}
          />
        </SettingRow>
      </SettingGroup>
    </div>
  )
}
