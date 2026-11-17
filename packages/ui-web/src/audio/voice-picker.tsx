import type { Persona } from '@repo/protocol'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Select } from '../primitives/select.tsx'
import { accentStyle } from '../styles/accent.ts'
import type { DeviceSpeech } from './use-speech.ts'

/** Each persona's voice, picked from the voice's styles, with a sentence to hear it first. */
export function VoicePicker({ speech, personas }: { speech: DeviceSpeech; personas: readonly Persona[] }) {
  if (!speech.ready || speech.styles.length === 0) return null
  return (
    <div className="grid gap-3">
      <Eyebrow className="px-0.5 font-semibold text-text-soft">Voices</Eyebrow>
      <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-white/[0.035] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
        {personas.map((persona) => (
          <li key={persona.id} style={accentStyle(persona.accent)} className="flex items-center gap-4 px-4 py-2.5">
            <span className="size-2 shrink-0 rounded-full bg-accent" />
            <span className="w-32 shrink-0 truncate text-[0.8125rem]">{persona.name}</span>
            <Select
              label={`The voice of ${persona.name}`}
              value={speech.styleOf(persona)}
              options={speech.styles.map((style) => ({ value: style.id, label: style.name }))}
              onChange={(style) => speech.pick(persona.id, style)}
              className="flex-1"
            />
            <Button size="sm" onClick={() => speech.preview(speech.styleOf(persona), `Hello, I am ${persona.name}. This is how I sound.`)}>
              Listen
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
