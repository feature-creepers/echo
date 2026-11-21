import type { ShownView } from '@repo/protocol'

/** What one answer showed: its cards, in the order they were shown. */
export interface GroupVersion {
  /** The turn the cards were shown in, or the view's own identifier for one shown outside a turn. */
  key: string
  turn: string | undefined
  views: ShownView[]
}

/**
 * What one topic shows on the board (docs/SPEC.md, section 13.2): the cards of its latest answer, with those of its
 * earlier answers behind them as versions, so an answer that updates another takes its place instead of standing
 * beside it.
 */
export interface ViewGroup {
  /** The thread the cards belong to, or the view's own identifier for one that belongs to none. */
  key: string
  thread: string | undefined
  /** The latest first. */
  versions: GroupVersion[]
}

/** What a view is grouped by: its thread, a saved widget shown by the person, or itself. */
const groupKey = (view: ShownView) =>
  view.thread !== undefined ? `thread:${view.thread}` : view.widget !== undefined ? `widget:${view.widget}` : `view:${view.id}`

/**
 * The stream as groups, the group shown last first. The stream is newest first, so a group stands where its newest
 * card does, its versions likewise, and the cards of one version are read back in the order they were shown.
 */
export function groupStream(stream: readonly ShownView[]): ViewGroup[] {
  const groups = new Map<string, ViewGroup>()
  for (const view of stream) {
    const key = groupKey(view)
    const group = groups.get(key) ?? { key, thread: view.thread, versions: [] }
    groups.set(key, group)
    const versionKey = view.turn ?? `view:${view.id}`
    const version = group.versions.find((one) => one.key === versionKey)
    if (version) version.views.unshift(view)
    else group.versions.push({ key: versionKey, turn: view.turn, views: [view] })
  }
  return [...groups.values()]
}

/** The widest the board is, how many cards stand side by side at most, the least room one takes and the room between two, in pixels. */
export const BOARD = { most: 880, columns: 2, least: 320, gap: 8 } as const

/** How many columns a board this wide holds: one at least, two at most, each at least `BOARD.least` wide. */
export function columnsFor(width: number): number {
  return Math.max(1, Math.min(BOARD.columns, Math.floor((width + BOARD.gap) / (BOARD.least + BOARD.gap))))
}

/**
 * The cards of one answer in columns, in reading order: card n in column n mod N, each column a stack, so a card
 * never changes column when another's height changes. One card takes the whole width.
 */
export function inColumns<Card>(cards: readonly Card[], columns: number): Card[][] {
  const count = Math.max(1, Math.min(columns, cards.length))
  const stacks: Card[][] = Array.from({ length: count }, () => [])
  cards.forEach((card, index) => void stacks[index % count]?.push(card))
  return stacks
}
