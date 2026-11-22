import { z } from 'zod'
import { turnIdSchema } from './conversation.ts'
import { threadIdSchema } from './threads.ts'

/**
 * A view as it travels to a client: what the assistant shows for an answer. The core has already checked
 * it against the catalogue (`@repo/catalog`), which knows what each block and its properties mean; here it
 * is only given its shape, so a client built before a block existed can still receive it.
 */
export const viewSpecShape = z.object({
  root: z.string(),
  elements: z.record(z.string(), z.object({ type: z.string(), props: z.record(z.string(), z.unknown()), children: z.array(z.string()) }))
})

/**
 * How much of an answer's row a card takes, when the assistant says: an answer is laid out as a few cards side by
 * side, on twelve columns, and a row is filled before the next one starts.
 */
export const VIEW_WIDTHS = ['third', 'half', 'two-thirds', 'full'] as const

export const viewSchema = z.object({
  /** Identifies the view for good. */
  id: z.string().min(1).max(64),
  /** A few words saying what it is about. */
  title: z.string(),
  /** The turn it was shown in. */
  turn: turnIdSchema.optional(),
  /** The thread it belongs to. */
  thread: threadIdSchema.optional(),
  /**
   * Its name among the cards of one answer ("weather", "chart"), when the assistant composed it: an answer shows a few
   * cards side by side, and a card shown again under its name in the same turn takes the place of the one before.
   */
  card: z.string().min(1).max(40).optional(),
  /** How wide it is among the cards of its answer. Left out, the cards share the row evenly. */
  width: z.enum(VIEW_WIDTHS).optional(),
  /** The saved widget of the library this view shows again, when it is one. */
  widget: z.string().min(1).max(64).optional(),
  /** The reminder this card is of, when it is one's: it can be snoozed from it. */
  reminder: z.string().min(1).max(64).optional(),
  spec: viewSpecShape
})
export type ShownView = z.infer<typeof viewSchema>

/** Whether a view asks the person something: it holds a questionnaire, which is also how an approval is asked for. */
export const asksSomething = (view: Pick<ShownView, 'spec'>): boolean => Object.values(view.spec.elements).some((element) => element.type === 'Questions')

/**
 * The cards of one answer once a view is shown, in the order they were first shown, each once. The core and every
 * client keep them by this one rule, so they agree. A view shown again keeps its place; so does the card a view
 * replaces: the one of its name, or the earlier version of the same saved widget.
 */
export function withCard<Card extends Pick<ShownView, 'id' | 'card' | 'widget'>>(cards: readonly Card[], view: Card): Card[] {
  const replaced = (card: Card) =>
    card.id === view.id || (view.card !== undefined && card.card === view.card) || (view.widget !== undefined && card.widget === view.widget)
  const place = cards.findIndex(replaced)
  if (place < 0) return [...cards, view]
  return cards.flatMap((card, at) => (at === place ? [view] : replaced(card) ? [] : [card]))
}
