import type { Persona } from '@repo/protocol'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { accentStyle } from '../styles/accent.ts'
import type { DeviceSpeech } from './use-speech.ts'

/** Each persona's voice, picked from the voice's styles, with a sentence to hear it first. */
export function VoicePicker({ speech, personas }: { speech: DeviceSpeech; personas: readonly Persona[] }) {
  if (!speech.ready || speech.styles.length === 0) return null
  return (
    <div className="grid gap-3">
      <Eyebrow>Voices</Eyebrow>
      <ul className="grid gap-2">
        {personas.map((persona) => (
          <li key={persona.id} style={accentStyle(persona.accent)} className="flex items-center gap-4 rounded-md border border-line bg-surface/80 px-4 py-3">
            <span className="size-2 shrink-0 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
            <span className="w-32 shrink-0 truncate font-medium text-sm">{persona.name}</span>
            <select
              aria-label={`The voice of ${persona.name}`}
              value={speech.styleOf(persona)}
              onChange={(event) => speech.pick(persona.id, event.target.value)}
              className="h-9 min-w-0 flex-1 cursor-pointer rounded-md border border-line-strong bg-ground px-3 text-sm outline-none transition focus-visible:border-accent"
            >
              {speech.styles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => speech.preview(speech.styleOf(persona), `Hello, I am ${persona.name}. This is how I sound.`)}>
              Listen
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
