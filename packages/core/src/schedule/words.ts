import { type ViewSpec, validateView } from '@repo/catalog'
import { wallTimeAt } from './zoned.ts'

/**
 * The words a reminder is said and shown with. What it says at its time was written by the assistant when it was
 * set, in the language of the conversation; what the core adds itself is here: how a reminder that rings late says
 * so, and the card it shows in the stream.
 */

/** How a reminder that rings late begins, in the languages the core knows the words of. The others use English. */
const LATE: Record<string, (time: string) => string> = {
  en: (time) => `You asked me to remind you at ${time}`,
  fr: (time) => `Tu m'avais demandé de te le rappeler à ${time}`,
  es: (time) => `Me pediste que te lo recordara a las ${time}`,
  de: (time) => `Du wolltest um ${time} daran erinnert werden`,
  it: (time) => `Mi avevi chiesto di ricordartelo alle ${time}`,
  pt: (time) => `Pediste-me para te lembrar às ${time}`,
  nl: (time) => `Je vroeg me je om ${time} hieraan te herinneren`
}

/** A time of day as it is said: "8:00", "14:30". */
export function spokenClock(instant: number, zone: string): string {
  const wall = wallTimeAt(instant, zone)
  return `${wall.hour}:${String(wall.minute).padStart(2, '0')}`
}

/**
 * What a reminder says when it rings late, because the app was not running at its time: its time, then what it
 * was about, in its own language. "You asked me to remind you at 8:00: Feed the cat."
 */
export function lateSentence(title: string, due: number, zone: string, language: string | undefined): string {
  const lead = LATE[language ?? 'en'] ?? (LATE.en as (time: string) => string)
  const about = title.trim().replace(/[.!]+$/, '')
  return `${lead(spokenClock(due, zone))}: ${about}.`
}

/** The card a reminder shows in the stream: what it is about, large, and when it was due under it. */
export function reminderCard(title: string, when: string): { title: string; spec: ViewSpec } {
  const checked = validateView({
    root: 'card',
    elements: {
      card: { type: 'Stack', props: { gap: 'tight' }, children: ['what', 'when'] },
      what: { type: 'Text', props: { text: title, size: 'large', weight: 'medium' }, children: [] },
      when: { type: 'Text', props: { text: when, size: 'small', tone: 'faint' }, children: [] }
    }
  })
  if (!checked.ok) throw new Error(`The reminder's card is not a valid view: ${checked.problems.join(' ')}`)
  return { title: 'Reminder', spec: checked.spec }
}
