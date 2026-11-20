import { type AssistantState, type Fact, type Meaning, type MemoryImport, RETENTION_CHOICES, type SleepMode, type SleepSettings } from '@repo/protocol'

/** The choices of when the assistant sleeps, as the person reads them, each with what it means. */
export const SLEEP_CHOICES: readonly { mode: SleepMode; label: string; description: string }[] = [
  { mode: 'quiet', label: 'After a quiet moment', description: 'Once nothing has been said for a while' },
  { mode: 'time', label: 'At a time of day', description: 'Every day, at the hour you set' },
  { mode: 'quiet-or-time', label: 'Both', description: 'After a quiet moment, or at the hour, whichever comes first' },
  { mode: 'asked', label: 'Only when told', description: 'When you say so, or press Sleep now' },
  { mode: 'never', label: 'Never', description: 'It keeps only what you ask it to remember' }
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
  const how =
    fact.origin === 'told'
      ? 'You asked it to remember'
      : fact.origin === 'edited'
        ? 'Corrected by you'
        : fact.origin === 'imported'
          ? 'Brought in from the proof of concept'
          : 'Learned'
  return `${how} · ${dayOf(fact.since)}`
}

/** What the latest import of the proof of concept brought in, in a sentence: "Brought in on 19 Nov 2026: 3 facts and 1,204 lines." */
export function importDetail(imported: MemoryImport | undefined): string {
  if (!imported) return 'Its notes, your context file and its history, from the folder it kept them in. Each is brought in once.'
  const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
  const what =
    imported.facts === 0 && imported.lines === 0
      ? 'nothing new'
      : `${count(imported.facts, 'fact', 'facts')} and ${count(imported.lines, 'line of its history', 'lines of its history')}`
  return `Brought in on ${dayOf(imported.at)}: ${what}.`
}

/** The periods offered for keeping what was said, as the person reads them. */
const PERIODS: Readonly<Record<number, string>> = { 30: 'A month', 90: 'Three months', 180: 'Six months', 365: 'A year', 730: 'Two years' }

/** How long what was said is kept, in a few words: "A year", "For good". */
export function keptFor(days: number | null): string {
  if (days === null) return 'For good'
  return PERIODS[days] ?? plural(days, 'day')
}

/** The choices of how long what was said is kept: for good first, then each period, and the period set if it is none of them. */
export function retentionChoices(current: number | null): { value: string; label: string; description: string }[] {
  const periods = [...RETENTION_CHOICES, ...(current === null || RETENTION_CHOICES.some((days) => days === current) ? [] : [current])].sort(
    (one, other) => one - other
  )
  return [
    { value: 'for-good', label: keptFor(null), description: 'Every word, searchable for as long as you use it' },
    ...periods.map((days) => ({ value: String(days), label: keptFor(days), description: 'Then the words are erased' }))
  ]
}

/** A choice of the list, as the period it stands for. */
export function retentionOf(value: string): number | null {
  return value === 'for-good' ? null : Number(value)
}

/** What the period means, as a sentence under the choice. */
export function retentionDetail(days: number | null): string {
  if (days === null) return 'Every word said is kept, and can be searched.'
  return `Words older than ${keptFor(days).toLowerCase()} are erased. What was learned from them stays.`
}

/**
 * What a new period would erase at once, said before it is set. Nothing when it erases nothing: the words are
 * kept for good, or longer than before.
 */
export function retentionWarning(from: number | null, to: number | null, now: Date): string | undefined {
  if (to === null || (from !== null && to >= from)) return undefined
  return `What was said before ${dayOf(new Date(now.getTime() - to * DAY).toISOString())} is erased now, for good.`
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000).toLocaleString('en-GB')} MB`
const counted = (n: number) => n.toLocaleString('en-GB')

/** The model of search by meaning, as the person is told of it: "multilingual-e5-small · 135 MB · from Hugging Face · MIT licence". */
export function aboutModel({ model }: Meaning): string {
  return `${model.name} · ${megabytes(model.bytes)} · from ${model.source} · ${model.licence} licence`
}

/** Where search by meaning stands, in a sentence. */
export function meaningDetail(meaning: Meaning): string {
  switch (meaning.state) {
    case 'absent':
      return 'Finds what was said in other words or another language. Its model runs on this computer, once downloaded.'
    case 'downloading':
      return `Downloading: ${megabytes(meaning.received)} of ${megabytes(meaning.total)}.`
    case 'unavailable':
      return meaning.why
    case 'ready': {
      const { lines, facts } = meaning
      const factsPart = facts.total === 0 ? '' : ` and ${counted(facts.done)} of ${counted(facts.total)} ${facts.total === 1 ? 'fact' : 'facts'}`
      if (lines.total === 0 && facts.total === 0) return 'Ready. What is said from now on is given its meaning while it sleeps.'
      if (lines.done === lines.total && facts.done === facts.total) return 'Everything said and known can be found by meaning.'
      return `${counted(lines.done)} of ${counted(lines.total)} ${lines.total === 1 ? 'line' : 'lines'}${factsPart} searchable by meaning. The rest follows while it sleeps.`
    }
  }
}
