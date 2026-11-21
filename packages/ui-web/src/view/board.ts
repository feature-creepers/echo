/**
 * The board of views on the main screen: as many columns as its width holds, the newest view at the top left and the
 * others in reading order across the columns. A card's column is its place in the list, never its height or another
 * card's, so a card that grows moves only the cards under it. Plain numbers, so it is tested without a page.
 */

/** The narrowest a column may be, the most columns, and the room between two cards, in pixels. */
export const BOARD = { least: 320, most: 4, gap: 8 } as const

/** The board's columns: how many, and how wide each is, in whole pixels so text in them stays sharp. */
export interface Columns {
  count: number
  width: number
}

/** The columns a board this wide holds: one at least, four at most, each at least `BOARD.least` wide when it can be. */
export function columnsOf(width: number): Columns {
  const count = Math.min(BOARD.most, Math.max(1, Math.floor((width + BOARD.gap) / (BOARD.least + BOARD.gap))))
  return { count, width: Math.max(0, Math.floor((width - BOARD.gap * (count - 1)) / count)) }
}

/** Where a card's top left corner goes, from the board's own. */
export interface Place {
  x: number
  y: number
}

/**
 * Where each card goes, from the cards' heights, newest first: card n at the foot of column n mod the count, each
 * column a stack. And how tall the board is then.
 */
export function boardOf(heights: readonly number[], columns: Columns): { places: Place[]; height: number } {
  const feet = Array.from({ length: columns.count }, () => 0)
  const places = heights.map((height, index) => {
    const column = index % columns.count
    const y = feet[column] ?? 0
    feet[column] = y + height + BOARD.gap
    return { x: column * (columns.width + BOARD.gap), y }
  })
  return { places, height: heights.length === 0 ? 0 : Math.max(...feet) - BOARD.gap }
}

/** A card on the board: its view, and whether it was closed and fades where it stands. */
export interface Kept<View> {
  view: View
  leaving: boolean
}

/**
 * The cards on the board once the views change: the views as they now are, and the cards just closed kept among
 * them, leaving, before the card that followed them, so the others close the gap only once a closed card has faded.
 */
export function keptOf<View extends { id: string }>(was: readonly Kept<View>[], views: readonly View[]): Kept<View>[] {
  const open = new Set(views.map((view) => view.id))
  const kept = views.map((view) => ({ view, leaving: false }))
  for (const [index, card] of was.entries()) {
    if (open.has(card.view.id)) continue
    const next = was.slice(index + 1).find((later) => open.has(later.view.id))
    const at = next === undefined ? kept.length : kept.findIndex((one) => one.view.id === next.view.id)
    kept.splice(at, 0, { view: card.view, leaving: true })
  }
  return kept
}
