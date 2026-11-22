import type { TurnId } from '@repo/protocol'

/** What the side panel shows of what it is the back of: its story, the work behind it, and the raw events. */
export const SHEET_TABS = ['story', 'work', 'trace'] as const
export type SheetTab = (typeof SHEET_TABS)[number]

/** What the side panel is the back of: the topic in front of the person, or everything. */
export type SheetScope = 'topic' | 'everything'

/**
 * Where the side panel stands: the tab it shows, if it is open, what it is the back of, and where each tab is, kept
 * while another tab shows and while the panel is closed, so it opens again where the person left it. It is held by
 * the window, not by the panel, so that anything on the screen can open the panel on a place: a thread at work under
 * the composer, an answer's full text.
 */
export interface SheetPlace {
  /** The tab shown; undefined while the panel is closed. */
  open: SheetTab | undefined
  /** The tab it opens on next. */
  last: SheetTab
  scope: SheetScope
  /** In the story, the line whose full answer is shown instead. */
  answer: TurnId | undefined
  /** In the work, the thread whose work is shown whole instead. */
  thread: string | undefined
  /** In the work, the thread opened last, marked in the list when the person comes back to it. */
  lastThread: string | undefined
  /** In the work of everything, the form that opens a project, shown over the list. */
  opening: boolean
  /** In the work of everything, the topics put away, shown over the list. */
  away: boolean
}

export const FIRST_SHEET_PLACE: SheetPlace = {
  open: undefined,
  last: 'story',
  scope: 'topic',
  answer: undefined,
  thread: undefined,
  lastThread: undefined,
  opening: false,
  away: false
}

export type SheetMove =
  /** The title row's button and the story's key: open on a tab, or the last one, or close when it already shows. */
  | { to: 'toggle'; tab?: SheetTab | undefined }
  /** A tab chosen in the panel. Chosen again, it goes back to its start. */
  | { to: 'tab'; tab: SheetTab }
  | { to: 'close' }
  /** The topic in front, or everything. */
  | { to: 'scope'; scope: SheetScope }
  /** A line's full answer, or back to the story. */
  | { to: 'answer'; turn: TurnId | undefined }
  /** A thread's work, whole, or back to the work. */
  | { to: 'thread'; thread: string | undefined }
  /** The form that opens a project, or back from it. */
  | { to: 'opening'; opening: boolean }
  /** The topics put away, or back from them. */
  | { to: 'away'; away: boolean }

/** The work of everything, on one of the places only it has. */
const everythingsWork = (place: SheetPlace, more: Partial<SheetPlace>): SheetPlace => ({
  ...place,
  open: 'work',
  last: 'work',
  scope: 'everything',
  thread: undefined,
  opening: false,
  away: false,
  ...more
})

/** Where the panel goes on a move. Each move that names a place in a tab opens the panel there. */
export function moveSheet(place: SheetPlace, move: SheetMove): SheetPlace {
  switch (move.to) {
    case 'toggle': {
      if (place.open !== undefined && (move.tab === undefined || move.tab === place.open)) return { ...place, open: undefined }
      const tab = move.tab ?? place.last
      return { ...place, open: tab, last: tab }
    }
    case 'tab':
      if (move.tab !== place.open) return { ...place, open: move.tab, last: move.tab }
      return move.tab === 'story' ? { ...place, answer: undefined } : move.tab === 'work' ? { ...place, thread: undefined, opening: false, away: false } : place
    case 'close':
      return { ...place, open: undefined }
    case 'scope':
      return { ...place, scope: move.scope, answer: undefined, thread: undefined, opening: false, away: false }
    case 'answer':
      return move.turn === undefined ? { ...place, answer: undefined } : { ...place, open: 'story', last: 'story', answer: move.turn }
    case 'thread':
      return { ...place, open: 'work', last: 'work', thread: move.thread, lastThread: move.thread ?? place.lastThread, opening: false, away: false }
    case 'opening':
      return move.opening ? everythingsWork(place, { opening: true }) : { ...place, opening: false }
    case 'away':
      return move.away ? everythingsWork(place, { away: true }) : { ...place, away: false }
  }
}
