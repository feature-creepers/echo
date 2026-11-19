import type { TurnId } from '@repo/protocol'

export const SHEET_TABS = ['transcript', 'threads', 'inspector'] as const
export type SheetTab = (typeof SHEET_TABS)[number]

/**
 * Where the side sheet stands: the tab it shows, if it is open, and where each tab is, kept while another tab
 * shows and while the sheet is closed, so it opens again where the person left it. It is held by the window,
 * not by the sheet, so that anything on the screen can open the sheet on a place: a thread at work under the
 * composer, a line's full answer, a line's thread in the transcript.
 */
export interface SheetPlace {
  /** The tab shown; undefined while the sheet is closed. */
  open: SheetTab | undefined
  /** The tab it opens on next. */
  last: SheetTab
  /** In the transcript, the line whose full answer is shown instead of the log. */
  answer: TurnId | undefined
  /** In the threads, the thread whose work is shown instead of the list. */
  thread: string | undefined
  /** In the threads, the thread opened last, marked in the list when the person comes back to it. */
  lastThread: string | undefined
  /** In the threads, the form that opens a project, shown over the list. */
  opening: boolean
}

export const FIRST_SHEET_PLACE: SheetPlace = {
  open: undefined,
  last: 'transcript',
  answer: undefined,
  thread: undefined,
  lastThread: undefined,
  opening: false
}

export type SheetMove =
  /** The title row's button and the transcript's key: open on a tab, or the last one, or close when it already shows. */
  | { to: 'toggle'; tab?: SheetTab | undefined }
  /** A tab chosen in the sheet. Chosen again, it goes back to its start: the log, or the list. */
  | { to: 'tab'; tab: SheetTab }
  | { to: 'close' }
  /** A line's full answer, or back to the log. */
  | { to: 'answer'; turn: TurnId | undefined }
  /** A thread's work, or the list of threads. */
  | { to: 'thread'; thread: string | undefined }
  /** The form that opens a project, or back from it. */
  | { to: 'opening'; opening: boolean }

/** Where the sheet goes on a move. Each move that names a place in a tab opens the sheet there. */
export function moveSheet(place: SheetPlace, move: SheetMove): SheetPlace {
  switch (move.to) {
    case 'toggle': {
      if (place.open !== undefined && (move.tab === undefined || move.tab === place.open)) return { ...place, open: undefined }
      const tab = move.tab ?? place.last
      return { ...place, open: tab, last: tab }
    }
    case 'tab':
      if (move.tab !== place.open) return { ...place, open: move.tab, last: move.tab }
      return move.tab === 'transcript' ? { ...place, answer: undefined } : move.tab === 'threads' ? { ...place, thread: undefined, opening: false } : place
    case 'close':
      return { ...place, open: undefined }
    case 'answer':
      return move.turn === undefined ? { ...place, answer: undefined } : { ...place, open: 'transcript', last: 'transcript', answer: move.turn }
    case 'thread':
      return { ...place, open: 'threads', last: 'threads', thread: move.thread, lastThread: move.thread ?? place.lastThread, opening: false }
    case 'opening':
      return move.opening ? { ...place, open: 'threads', last: 'threads', opening: true } : { ...place, opening: false }
  }
}
