import { type Client, SPEEDS } from '@repo/client'
import {
  type BackgroundResult,
  type CommandInput,
  cleanVocabulary,
  type Interruptions,
  LANGUAGES,
  type Languages,
  MAX_WORD_LENGTH,
  MAX_WORDS,
  type Persona,
  type Vocabulary
} from '@repo/protocol'
import { useEffect, useState } from 'react'
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
import { deviceChoice } from './device-choice.ts'
import { TEXT_AREA } from './field.ts'
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
  /** The languages of the conversation: the person's, not this computer's. */
  languages: Languages
  /** When the assistant speaks up by itself: the person's, not this computer's. */
  interruptions: Interruptions
  /** The person's own words for the recogniser: the person's, not this computer's. */
  vocabulary: Vocabulary
  speech: DeviceSpeech | undefined
  personas: readonly Persona[]
  active: Persona | undefined
}

/** What the person typed, as words: one a line, or a comma between them. */
const wordsIn = (text: string) => text.split(/[\n,]/)

/**
 * The person's own words, one a line, kept when they leave the field: the recogniser favours them from the next
 * thing said. Words changed on another device show here, unless the person is typing.
 */
function WordsRow({ client, words }: { client: Client; words: Vocabulary }) {
  const kept = words.join('\n')
  const [text, setText] = useState(kept)
  const [typing, setTyping] = useState(false)
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    if (!typing) setText(kept)
  }, [kept, typing])
  const typed = wordsIn(text)
  const count = cleanVocabulary(typed).length
  const keep = () => {
    setTyping(false)
    const next = cleanVocabulary(wordsIn(text))
    if (next.join('\n') === kept) return setText(kept)
    setProblem(undefined)
    client.session.run('vocabulary.set', { words: next }).catch((error: unknown) => {
      setProblem(error instanceof Error ? error.message : 'The words could not be saved.')
    })
  }
  return (
    <SettingRow
      title="Your words"
      detail="Names, places and terms it would not know, one a line, written as you want them written: it listens for them. With some, hearing you takes a little longer."
      problem={problem ?? (typed.filter((word) => word.trim() !== '').length > MAX_WORDS ? `Only the first ${MAX_WORDS} are kept.` : undefined)}
      stacked
    >
      <div className="grid gap-1.5">
        <textarea
          aria-label="Your words"
          value={text}
          rows={5}
          maxLength={MAX_WORDS * (MAX_WORD_LENGTH + 1)}
          spellCheck={false}
          placeholder={'Kerjean\nGrafana\njson-render'}
          onFocus={() => setTyping(true)}
          onChange={(event) => setText(event.target.value)}
          onBlur={keep}
          className={TEXT_AREA}
        />
        <span className="text-text-faint text-xs tabular-nums">{count === 0 ? 'None yet' : `${count} of ${MAX_WORDS}`}</span>
      </div>
    </SettingRow>
  )
}

/**
 * The voice of this computer: the models it needs to hear and speak, each personality's voice, the languages
 * spoken and answered in, and how the answers are heard: aloud or not, at what pace, on which speakers.
 */
export function VoiceSection({ client, languages, interruptions, vocabulary, speech, personas, active }: VoiceSectionProps) {
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
  const speaker = settings.speaker
  const speakers = deviceChoice(useAudioDevices('audiooutput'), speaker, 'Speakers')

  const test = () => {
    if (speech?.ready && active) speech.preview(active, `This is how ${active.name} sounds, on these speakers.`)
    else void findDevice(speaker, 'audiooutput').then((sink) => playCue('open', sink))
  }

  return (
    <div className="grid gap-10">
      {speech ? (
        <div className="grid gap-8">
          <VoiceSetup speech={speech} />
          <VoicePicker speech={speech} personas={personas} languages={languages} />
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
        <WordsRow client={client} words={vocabulary} />
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
                if (speech?.ready && active) speech.preview(active, 'This is the pace I will speak at.', { speed })
              }}
            />
          </div>
        </SettingRow>
        <SettingRow
          title="Speakers"
          detail={
            speakers.missing
              ? 'These speakers are not connected. Until they are, the system default is used.'
              : 'Where the voice plays. The system default follows your computer.'
          }
          stacked
        >
          <div className="flex items-center gap-3">
            <Select
              label="Speakers"
              className="flex-1"
              value={speakers.value}
              options={speakers.options}
              onChange={(id) => change({ speaker: speakers.pick(id) })}
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
