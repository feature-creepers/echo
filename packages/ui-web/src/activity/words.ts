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
  // A search names the folder it searches first.
  if (['Glob', 'Grep'].includes(use.tool)) return { text: `Searched ${named(use.paths[0])}`, code: false }
  const paths = [...new Set(use.paths)]
  const what = paths.length > 1 ? `${paths.length} files` : named(paths[0])
  const verb = { read: 'Read', create: 'Created', change: 'Changed', delete: 'Deleted' }[use.action]
  return { text: `${verb} ${what}`, code: false }
}

/** The decision, as the row shows it: a word, and why, in a few more. */
export function decisionInWords(use: AccessUse): { word: string; why: string; tone: 'ok' | 'accent' | 'danger' | 'soft' } {
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
  // Refused by the boundary is in the danger colour; refused by the person, or for want of an answer, is quiet.
  if (use.decision === 'refused')
    return { word: 'Refused', why: why[use.reason], tone: use.reason === 'outside' || use.reason === 'protected' ? 'danger' : 'soft' }
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
