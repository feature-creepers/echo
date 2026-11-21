import type { ShownView } from '@repo/protocol'

/** The widest an answer is, and the width under which its cards stand one under the other, in pixels. */
export const FEED = { most: 880, stacked: 560 } as const

/** How wide the assistant can make a card. */
export type ViewWidth = NonNullable<ShownView['width']>

/** An answer's row is twelve columns: how many each width takes. */
const COLUMNS = 12
const SPAN: Record<ViewWidth, number> = { third: 4, half: 6, 'two-thirds': 8, full: COLUMNS }

/** A card with the columns it takes in its row. */
export interface Placed<Card> {
  card: Card
  span: number
}

/** How many columns each card takes when the assistant gave none a width: they share a row evenly, four on two rows. */
const evenSpan = (cards: number) => (cards === 1 ? COLUMNS : cards === 2 || cards === 4 ? 6 : 4)

/**
 * The cards of one answer in rows of twelve columns, in the order they were shown (docs/SPEC.md, section 13.2). A
 * card takes the width the assistant gave it, or half a row when only others were given one; with none given, the
 * cards share a row evenly. A row is filled before the next starts, and its last card grows to fill what is left, so
 * no row has a hole. Stacked, in a narrow window, each card takes a row.
 */
export function inRows<Card extends { width?: ViewWidth | undefined }>(cards: readonly Card[], stacked: boolean): Placed<Card>[][] {
  if (stacked) return cards.map((card) => [{ card, span: COLUMNS }])
  const even = cards.every((card) => card.width === undefined) ? evenSpan(cards.length) : undefined
  const rows: Placed<Card>[][] = []
  let taken = COLUMNS
  for (const card of cards) {
    const span = even ?? (card.width === undefined ? SPAN.half : SPAN[card.width])
    if (taken + span > COLUMNS) {
      rows.push([])
      taken = 0
    }
    rows.at(-1)?.push({ card, span })
    taken += span
  }
  for (const row of rows) {
    const last = row.at(-1)
    if (last) last.span += COLUMNS - row.reduce((sum, placed) => sum + placed.span, 0)
  }
  return rows
}
