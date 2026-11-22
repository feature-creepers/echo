import { CARDS_PER_ANSWER, CLEAR_TOOL, type ViewSpec, validateView } from '@repo/catalog'
import { answerIdOf, asksSomething, type Event, type ShownView, type TurnId, VIEW_WIDTHS, viewSchema, withCard } from '@repo/protocol'
import { z } from 'zod'
import type { Records, StoredRecord } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'

/** The types of the records written when a view is shown and when one is cleared. */
export const VIEW_SHOWN = 'view.shown'
export const VIEW_CLEARED = 'view.cleared'

/** A card's name among the cards of its answer, as a session gives it: names that differ only in case are one. */
export const cardNameSchema = z.string().trim().toLowerCase().min(1).max(40)

/** The name of the card a session shows without naming one: an answer that names none is this one card. */
const UNNAMED_CARD = 'main'

const request = z.object({
  title: z.string().trim().min(1).max(120),
  card: cardNameSchema.optional(),
  width: z.enum(VIEW_WIDTHS).optional(),
  view: z.unknown()
})

export interface ScreenOptions {
  records: Records
  /** A new identifier, unique for good. */
  newId: () => string
}

/** Who asks to show something: a thread, and the turn it is answering. */
export interface Showing {
  thread: string | undefined
  turn: TurnId | undefined
}

/** A view already checked against the catalogue, to show as it is: a saved widget brought back. */
export interface Checked {
  /** The view this is a new version of, which it replaces where it is. Left out, it is a view of its own. */
  id?: string
  title: string
  spec: ViewSpec
  /** Its name among the cards of its answer, when a session composed it. The core's own cards have none. */
  card?: string
  /** How much of its answer's row it takes, when the session said. */
  width?: ShownView['width']
  /** The saved widget of the library it shows again. */
  widget?: string
  /** The reminder it is the card of: it can be snoozed from it. */
  reminder?: string
}

/**
 * What the assistant shows: the cards of every answer, kept for good. An answer is a few cards side by side
 * (docs/SPEC.md, section 9.2); which topic an answer belongs to is the topics' business (`topics/topics.ts`).
 */
export interface Screen {
  /** Show what a session asked to show. The answer says "shown", or lists what to correct. */
  show(asked: unknown, showing: Showing): ToolResult
  /** Show a view that was checked already, as it is. */
  present(view: Checked, showing: Showing): ToolResult
  /** A view shown now or earlier, by its identifier. */
  find(view: string): ShownView | undefined
  /** The cards of the answer a thread last showed something in, in the order they were shown. */
  cards(thread: string | undefined): ShownView[]
  /** The cards of each answer given that has some, in the order they were shown. */
  of(answers: readonly string[]): Map<string, ShownView[]>
  /** Whether an answer has a card. */
  has(answer: string): boolean
  /** Whether an answer has a card that asks the person something: a question to answer, an approval to give. */
  asks(answer: string): boolean
  /** Every view a thread showed, oldest first, from the records. */
  history(thread: string): ShownView[]
  /** Remove a card from its answer, for good. */
  clear(view: string): void
  onEvent(listener: (event: Event) => void): () => void
}

/** A card of an answer, as the screen remembers it: where its view is in the records, and what it takes the place of. */
interface Slot {
  id: string
  record: string
  card: string | undefined
  widget: string | undefined
  /** It asks the person something. */
  asks: boolean
}

/**
 * Whether a clearing recorded before answers were kept for good is one to forget: the cards of side questions left by
 * themselves after a while, only put away, and a clearing that named no view emptied the stage of the time.
 */
const putAwayOnly = (shown: unknown) =>
  typeof shown === 'object' && shown !== null && ((shown as { aside?: unknown }).aside === true || (shown as { slot?: unknown }).slot === 'margin')

/**
 * The screen checks a view against the catalogue before showing it. A view that does not pass is not shown, and the
 * answer lists every problem so it can be written again. Every view is recorded, so an earlier one is never lost.
 *
 * It remembers where each answer's cards are in the records, not the cards: they are read when asked for, so years
 * of answers weigh nothing until someone scrolls back to them.
 *
 * A card shown in the turn of other cards goes beside them, or in place of the one of its name. The core's own cards
 * (an approval, a decision, the files written) have no name: they go beside the assistant's and are never refused.
 */
export function createScreen({ records, newId }: ScreenOptions): Screen {
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  const recorded = (payload: unknown) => viewSchema.safeParse(payload)

  /** The cards of each answer, in the order they were first shown. */
  const slots = new Map<string, Slot[]>()
  /** The answer each view is a card of. */
  const answerOf = new Map<string, string>()
  /** The answer each thread last showed something in; what was shown outside any thread is kept under ''. */
  const lastOf = new Map<string, string>()

  const drop = (view: string) => {
    const answer = answerOf.get(view)
    if (answer === undefined) return
    answerOf.delete(view)
    const left = (slots.get(answer) ?? []).filter((slot) => slot.id !== view)
    if (left.length === 0) slots.delete(answer)
    else slots.set(answer, left)
  }
  const keep = (view: ShownView, record: string) => {
    const answer = answerIdOf(view)
    // A card brought up to date in a later turn is a card of that turn's answer.
    if (answerOf.get(view.id) !== answer) drop(view.id)
    const before = slots.get(answer) ?? []
    const after = withCard(before, { id: view.id, record, card: view.card, widget: view.widget, asks: asksSomething(view) })
    for (const slot of before) if (!after.includes(slot) && slot.id !== view.id) answerOf.delete(slot.id)
    slots.set(answer, after)
    answerOf.set(view.id, answer)
    lastOf.set(view.thread ?? '', answer)
  }

  const asides = new Set<string>()
  for (const record of records.read([VIEW_SHOWN, VIEW_CLEARED])) {
    if (record.type === VIEW_CLEARED) {
      const { view } = record.payload as { view?: string }
      if (view !== undefined && !asides.has(view)) drop(view)
      continue
    }
    const view = recorded(record.payload)
    if (!view.success) continue
    if (putAwayOnly(record.payload)) asides.add(view.data.id)
    keep(view.data, record.id)
  }

  /** The views of some records, by record. */
  const read = (ids: readonly string[]): Map<string, ShownView> => {
    const views = new Map<string, ShownView>()
    for (const record of ids.length === 0 ? [] : records.get(ids)) {
      const view = recorded(record.payload)
      if (view.success) views.set(record.id, view.data)
    }
    return views
  }
  const of = (answers: readonly string[]): Map<string, ShownView[]> => {
    const asked = answers.flatMap((answer) => (slots.has(answer) ? [[answer, slots.get(answer) ?? []] as const] : []))
    const views = read(asked.flatMap(([, cards]) => cards.map((slot) => slot.record)))
    return new Map(asked.map(([answer, cards]) => [answer, cards.flatMap((slot) => views.get(slot.record) ?? [])]))
  }

  const present = (checked: Checked, showing: Showing): ToolResult => {
    const view: ShownView = {
      id: checked.id ?? newId(),
      title: checked.title,
      ...(checked.card === undefined ? {} : { card: checked.card }),
      ...(checked.width === undefined ? {} : { width: checked.width }),
      spec: checked.spec,
      ...(checked.widget === undefined ? {} : { widget: checked.widget }),
      ...(checked.reminder === undefined ? {} : { reminder: checked.reminder }),
      ...(showing.turn === undefined ? {} : { turn: showing.turn }),
      ...(showing.thread === undefined ? {} : { thread: showing.thread })
    }
    const others = (slots.get(answerIdOf(view)) ?? []).flatMap((slot) =>
      slot.card === undefined || slot.card === view.card || slot.id === view.id ? [] : [slot.card]
    )
    if (view.card !== undefined && others.length >= CARDS_PER_ANSWER)
      return {
        ok: false,
        text: `Not shown: an answer shows ${CARDS_PER_ANSWER} cards at most, and yours shows ${others.join(', ')}. Show it under one of these names to replace that card, or remove one with ${CLEAR_TOOL} first.`
      }
    const [written] = records.append([{ type: VIEW_SHOWN, payload: view }]) as [StoredRecord]
    keep(view, written.id)
    emit({ type: 'event', name: 'view.shown', view })
    return { ok: true, text: 'Shown.' }
  }

  return {
    show(asked, showing) {
      const read = request.safeParse(asked)
      if (!read.success)
        return { ok: false, text: `Give a title, in a few words, and a view; a card's name is a word or two, its width one of ${VIEW_WIDTHS.join(', ')}.` }
      const checked = validateView(read.data.view)
      if (!checked.ok) return { ok: false, text: `The view was not shown. Correct this and show it again:\n- ${checked.problems.join('\n- ')}` }
      const { title, card = UNNAMED_CARD, width } = read.data
      return present({ title, card, ...(width === undefined ? {} : { width }), spec: checked.spec }, showing)
    },

    present,

    find(id) {
      const answer = answerOf.get(id)
      const slot = answer === undefined ? undefined : slots.get(answer)?.find((one) => one.id === id)
      if (slot) return read([slot.record]).get(slot.record)
      // A view removed from its answer is still in the records: they are read whole only for this, which is rare.
      for (const record of records.read([VIEW_SHOWN]).reverse()) {
        const view = recorded(record.payload)
        if (view.success && view.data.id === id) return view.data
      }
      return undefined
    },

    cards(thread) {
      const answer = lastOf.get(thread ?? '')
      return answer === undefined ? [] : (of([answer]).get(answer) ?? [])
    },

    of,

    has: (answer) => slots.has(answer),

    asks: (answer) => slots.get(answer)?.some((slot) => slot.asks) === true,

    history(thread) {
      const views: ShownView[] = []
      for (const record of records.read([VIEW_SHOWN])) {
        const view = recorded(record.payload)
        // A card brought back, or brought up to date, is recorded again: it is still one view, as it was last shown.
        if (!view.success || view.data.thread !== thread) continue
        const at = views.findIndex((one) => one.id === view.data.id)
        if (at < 0) views.push(view.data)
        else views[at] = view.data
      }
      return views
    },

    clear(id) {
      if (!answerOf.has(id)) return
      drop(id)
      records.append([{ type: VIEW_CLEARED, payload: { view: id } }])
      emit({ type: 'event', name: 'view.cleared', view: id })
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
