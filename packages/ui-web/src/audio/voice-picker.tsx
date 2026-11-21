import { LANGUAGES, type LanguageCode, type Languages, type Persona } from '@repo/protocol'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Select } from '../primitives/select.tsx'
import { accentStyle } from '../styles/accent.ts'
import { introduction } from './introductions.ts'
import type { DeviceSpeech } from './use-speech.ts'

/** Every language the voice speaks, to pick the one whose voices are shown. */
const LANGUAGE_OPTIONS = LANGUAGES.map((language) => ({ value: language.code as LanguageCode, label: language.name }))

/** The language to show the voices of first: the one the assistant answers in, else the one the person speaks, else English. */
export function firstLanguage(languages: Languages): LanguageCode {
  if (languages.answers !== 'spoken') return languages.answers
  if (languages.spoken !== 'auto') return languages.spoken
  return 'en'
}

interface VoicePickerProps {
  speech: DeviceSpeech
  personas: readonly Persona[]
  /** The languages of the conversation, to show first the voices of the one the assistant speaks. */
  languages: Languages
}

/**
 * Each persona's voice in a language, picked from the voice's styles, with a sentence in that language to hear it
 * first: the same style does not sound the same in every language, so a persona's voice is picked language by language.
 */
export function VoicePicker({ speech, personas, languages }: VoicePickerProps) {
  const [language, setLanguage] = useState<LanguageCode>(() => firstLanguage(languages))
  if (!speech.ready || speech.styles.length === 0) return null
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <Eyebrow className="px-0.5 font-semibold text-text-soft">Voices</Eyebrow>
        <Select<LanguageCode> label="The language of the voices" value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} className="w-44" />
      </div>
      <ul className="divide-y divide-text/[0.06] overflow-hidden bg-raised/95 shadow-[inset_0_0_0_1px_rgb(235_230_218/0.06)]">
        {personas.map((persona) => (
          <li key={persona.id} style={accentStyle(persona.accent)} className="flex items-center gap-4 px-4 py-2.5">
            <span className="size-2 shrink-0 bg-accent" />
            <span className="w-32 shrink-0 truncate text-[0.8125rem]">{persona.name}</span>
            <Select
              label={`The voice of ${persona.name}`}
              value={speech.styleOf(persona, language)}
              options={speech.styles.map((style) => ({ value: style.id, label: style.name }))}
              onChange={(style) => speech.pick(persona, language, style)}
              className="flex-1"
            />
            <Button size="sm" onClick={() => speech.preview(persona, introduction(language, persona.name), { language })}>
              Listen
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
