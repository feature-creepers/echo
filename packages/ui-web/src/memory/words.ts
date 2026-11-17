import type { AssistantState, Fact, SleepMode, SleepSettings } from '@repo/protocol'

/** The choices of when the assistant sleeps, as the user reads them. */
export const SLEEP_CHOICES: readonly { mode: SleepMode; label: string }[] = [
  { mode: 'quiet', label: 'After a quiet moment' },
  { mode: 'time', label: 'At a time of day' },
  { mode: 'quiet-or-time', label: 'Both' },
  { mode: 'asked', label: 'Only when told' },
  { mode: 'never', label: 'Never' }
]

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A day as people say it: 17 Nov 2026. */
export function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** How long ago something happened, in the words of a person. */
export function ago(iso: string, now: Date): string {
  const passed = now.getTime() - new Date(iso).getTime()
  if (passed < MINUTE) return 'just now'
  if (passed < HOUR) return plural(Math.floor(passed / MINUTE), 'minute', 'ago')
  if (passed < DAY) return plural(Math.floor(passed / HOUR), 'hour', 'ago')
  if (passed < 2 * DAY) return 'yesterday'
  if (passed < 7 * DAY) return plural(Math.floor(passed / DAY), 'day', 'ago')
  return `on ${dayOf(iso)}`
}

const plural = (count: number, unit: string, after = '') => `${count} ${unit}${count === 1 ? '' : 's'}${after ? ` ${after}` : ''}`

/** When it sleeps, as a sentence. */
export function whenItSleeps(sleep: SleepSettings): string {
  const quiet = `after ${plural(sleep.quietMinutes, 'quiet minute')}`
  switch (sleep.when) {
    case 'quiet':
      return `Sleeps ${quiet}.`
    case 'time':
      return `Sleeps at ${sleep.time} every day.`
    case 'quiet-or-time':
      return `Sleeps ${quiet}, or at ${sleep.time}.`
    case 'asked':
      return 'Sleeps only when you tell it to.'
    case 'never':
      return 'Never sleeps: it keeps as facts only what you ask it to remember.'
  }
}

/** Where the assistant stands, in a title and a line. */
export function sleepStatus(state: AssistantState, sleep: SleepSettings, now: Date): { title: string; detail: string } {
  if (state.asleep && state.work && state.work.total > 0) {
    return { title: 'Asleep', detail: `Making sense of what was said: ${state.work.done} of ${plural(state.work.total, 'exchange')}.` }
  }
  if (state.asleep) return { title: 'Asleep', detail: 'Resting. Say anything and it wakes at once.' }
  const slept = state.lastSlept === undefined ? 'Has not slept yet.' : `Last slept ${ago(state.lastSlept, now)}.`
  return { title: 'Awake', detail: `${slept} ${whenItSleeps(sleep)}` }
}

/** Where a fact comes from, in a few words. */
export function learnedFrom(fact: Fact): string {
  const how = fact.origin === 'told' ? 'You asked it to remember' : fact.origin === 'edited' ? 'Corrected by you' : 'Learned'
  return `${how} · ${dayOf(fact.since)}`
}
