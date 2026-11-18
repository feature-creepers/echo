import type { AccessUse } from '@repo/protocol'

/** The filters of the activity: everything, what the person was asked, what was refused, and what changed something. */
export const FILTERS = ['all', 'asked', 'refused', 'changes'] as const
export type Filter = (typeof FILTERS)[number]

export const FILTER_LABELS: Record<Filter, string> = { all: 'All', asked: 'Asked', refused: 'Refused', changes: 'Changes' }

/** Whether a use belongs under a filter. */
export function shownUnder(use: AccessUse, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'asked':
      return use.decision === 'approved' || (use.decision === 'refused' && ['declined', 'unanswered', 'stopped'].includes(use.reason))
    case 'refused':
      return use.decision === 'refused'
    case 'changes':
      return use.action === 'create' || use.action === 'change' || use.action === 'delete' || (use.action === 'run' && use.reason !== 'read-only')
  }
}

/** The last part of a path, whatever the system's separator. */
const named = (path: string | undefined) => path?.split(/[\\/]/).filter(Boolean).at(-1) ?? path ?? ''

/** What a use did, in a few words: "Created notes.txt", "Read 3 files", or its command. */
export function summary(use: AccessUse): { text: string; code: boolean } {
  if (use.action === 'run') return { text: use.command?.trim().split('\n')[0] ?? 'A command', code: true }
  const what = use.paths.length > 1 ? `${use.paths.length} files` : named(use.paths[0])
  const verb = {
    read: ['Glob', 'Grep'].includes(use.tool) ? 'Searched' : 'Read',
    create: 'Created',
    change: 'Changed',
    delete: 'Deleted'
  }[use.action]
  return { text: `${verb} ${what}`, code: false }
}

/** The decision, as the row shows it: a word, and why, in a few more. */
export function decisionInWords(use: AccessUse): { word: string; why: string; tone: 'ok' | 'accent' | 'danger' } {
  const why: Record<AccessUse['reason'], string> = {
    'read-only': 'only reads',
    level: 'your level allows it',
    session: 'allowed for this session',
    pressed: 'you pressed allow',
    said: 'you said yes',
    outside: 'outside what you gave',
    protected: 'never reached',
    declined: 'you said no',
    unanswered: 'no answer',
    stopped: 'stopped'
  }
  if (use.decision === 'refused') return { word: 'Refused', why: why[use.reason], tone: 'danger' }
  if (use.decision === 'approved') return { word: 'Approved', why: why[use.reason], tone: 'accent' }
  return { word: 'Ran', why: why[use.reason], tone: 'ok' }
}

/** The day a use belongs to, as a heading: "Today", "Yesterday", "Monday 16 November". */
export function dayOf(at: string, now: Date): string {
  const date = new Date(at)
  const start = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const days = Math.round((start(now) - start(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

/** The time of a use, as a clock shows it: "14:05". */
export const timeOf = (at: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
