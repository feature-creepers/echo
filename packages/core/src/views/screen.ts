import { CARDS_PER_ANSWER, CLEAR_TOOL, type ViewSpec, validateView } from '@repo/catalog'
import { type Event, onTop, type ShownView, type TurnId, VIEW_WIDTHS, viewSchema } from '@repo/protocol'
import { z } from 'zod'
import type { Timers } from '../ports/clock.ts'
import type { Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'

/** The types of the records written when a view is shown and when one is cleared. */
export const VIEW_SHOWN = 'view.shown'
export const VIEW_CLEARED = 'view.cleared'

/** How long an aside's card stays once shown, before it leaves by itself: long enough to read it twice. */
export const ASIDE_STAYS_MS = 3 * 60_000

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
  /** Time passing, for aside cards to leave by themselves. Left out, they stay until closed. */
  timers?: Timers | undefined
  now?: () => Date
}

/** Who asks to show something: a thread, the turn it is answering, and how what it shows is placed. */
export interface Showing {
  thread: string | undefined
  turn: TurnId | undefined
  /** Whether its topic is the one on the stage. A topic in the background keeps its cards for when it comes back. */
  focused: boolean
  /** It answers a side question: what it shows is an aside card, on top of the stream, and the stage stays as it is. */
  aside?: boolean | undefined
}

/** A view already checked against the catalogue, to show as it is: a saved widget brought back. */
export interface Checked {
  /** The view this is a new version of, which it replaces wherever it is. Left out, it is a view of its own. */
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
 * What the assistant shows: the cards of each thread's latest answer, those of the topic in focus on the stage, and the
 * stream the main screen draws, every view still open, newest first, the side questions' cards among them.
 */
export interface Screen {
  /** The newest card on the stage now. */
  current(): ShownView | undefined
  /** Every view of the conversation still open, newest first, stage and aside cards together. */
  stream(): ShownView[]
  /** The aside cards still in the stream, newest first. */
  asides(): ShownView[]
  /** Show what a session asked to show. The answer says "shown", or lists what to correct. */
  show(asked: unknown, showing: Showing): ToolResult
  /** Show a view that was checked already, as it is. */
  present(view: Checked, showing: Showing): ToolResult
  /** A view shown now or earlier, by its identifier. */
  find(view: string): ShownView | undefined
  /** The cards of a thread's latest answer, newest first, or, left out, the cards on the stage. */
  cards(thread: string | undefined): ShownView[]
  /** Every view a thread showed, oldest first, from the records. */
  history(thread: string): ShownView[]
  /** When the latest view a thread showed is an aside card, put it back on top of the stream, for its full time again. */
  recall(thread: string): void
  /** The focus moved to this thread: the stage shows the cards of its latest answer, or nothing. */
  focus(thread: string | undefined): void
  /** Remove the view given, wherever it is, or, left out, every card on the stage. */
  clear(view?: string): void
  onEvent(listener: (event: Event) => void): () => void
}

/**
 * A view as it was recorded. The cards of side questions were once said to go in a margin beside the stage
 * (`slot: 'margin'`): they are read as the aside cards they are.
 */
const fromRecord = (payload: unknown): unknown => {
  if (typeof payload !== 'object' || payload === null || !('slot' in payload)) return payload
  const { slot, ...rest } = payload as { slot?: unknown }
  return slot === 'margin' ? { ...rest, aside: true } : rest
}

/** Whether two views are cards of one answer: shown by one thread in one turn, neither of them an aside's. */
const together = (one: ShownView, other: ShownView) =>
  one.turn !== undefined && one.turn === other.turn && one.thread === other.thread && one.aside !== true && other.aside !== true

/**
 * The screen checks a view against the catalogue before showing it. A view that does not pass is not shown,
 * and the answer lists every problem so it can be written again. Every view is recorded, so an earlier one
 * is never lost, and the screen is as it was after a restart.
 *
 * An answer is a few cards side by side (docs/SPEC.md, section 9.2): a card shown in the turn of the thread's cards
 * goes beside them, or in place of the one of its name, and the first one of a new turn takes the place of them all.
 * The core's own cards (an approval, a decision, the files written) have no name: they go beside the assistant's and
 * are never refused.
 */
export function createScreen({ records, newId, timers, now = () => new Date() }: ScreenOptions): Screen {
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  const recorded = (payload: unknown) => viewSchema.safeParse(fromRecord(payload))

  /** The cards of each thread's latest answer, newest first; views shown outside any thread are kept under ''. */
  const answers = new Map<string, ShownView[]>()
  let stage: ShownView[] = []
  let stream: ShownView[] = []
  /** A thread's cards once a view is shown: beside the cards of the same answer, else in place of them all. */
  const answered = (view: ShownView) =>
    onTop(
      (answers.get(view.thread ?? '') ?? []).filter((card) => together(card, view)),
      view
    )
  const place = (view: ShownView, cards = answered(view)) => {
    answers.set(view.thread ?? '', cards)
    stream = onTop(stream, view)
    // An aside card goes on top of the stream: the stage keeps the topic it was asked beside.
    if (view.aside !== true) stage = cards
  }
  const remove = (id: string) => {
    stage = stage.filter((card) => card.id !== id)
    stream = stream.filter((view) => view.id !== id)
    // A card removed does not come back when its topic does. An aside's card closed is only put away: it comes back
    // when its topic is brought back.
    for (const [thread, cards] of answers) {
      const kept = cards.filter((card) => card.id !== id || card.aside === true)
      if (kept.length === 0) answers.delete(thread)
      else if (kept.length < cards.length) answers.set(thread, kept)
    }
  }
  /** Whether a view is still there to see: on the stage, in the stream, or kept for when its topic comes back. */
  const stillThere = (id: string) =>
    stage.some((card) => card.id === id) ||
    stream.some((view) => view.id === id) ||
    [...answers.values()].some((cards) => cards.some((card) => card.id === id && card.aside !== true))

  /**
   * An aside's card leaves by itself a while after it was shown, unless it was shown again since: an aside answers
   * in passing, and its card should not stay on top of the stream for good. Each card has one timer, the latest.
   */
  const leaving = new Map<string, () => void>()
  const leaveLater = (view: ShownView, ms: number) => {
    if (!timers || view.aside !== true) return
    leaving.get(view.id)?.()
    leaving.set(
      view.id,
      timers.after(Math.max(ms, 0), () => {
        leaving.delete(view.id)
        clear(view.id)
      })
    )
  }

  /** When each aside card was last shown, from the records, for those still in the stream after a restart. */
  const shownAt = new Map<string, number>()
  for (const record of records.read([VIEW_SHOWN, VIEW_CLEARED])) {
    if (record.type === VIEW_CLEARED) {
      // The first records of a clearing named no view: they cleared the stage.
      const { view } = record.payload as { view?: string }
      for (const id of view === undefined ? stage.map((card) => card.id) : [view]) remove(id)
    } else {
      const view = recorded(record.payload)
      if (!view.success) continue
      place(view.data)
      if (view.data.aside === true) shownAt.set(view.data.id, Date.parse(record.at))
    }
  }

  function clear(id?: string) {
    if (id === undefined) {
      for (const card of stage) clear(card.id)
      return
    }
    if (!stillThere(id)) return
    leaving.get(id)?.()
    leaving.delete(id)
    remove(id)
    records.append([{ type: VIEW_CLEARED, payload: { view: id } }])
    emit({ type: 'event', name: 'view.cleared', view: id })
  }

  const asides = () => stream.filter((view) => view.aside === true)

  // The aside cards still in the stream after a restart leave when their time is up, or at once if it already was.
  for (const card of asides()) {
    const at = shownAt.get(card.id)
    if (at !== undefined && !Number.isNaN(at)) leaveLater(card, at + ASIDE_STAYS_MS - now().getTime())
  }

  const present = (checked: Checked, showing: Showing): ToolResult => {
    const view: ShownView = {
      id: checked.id ?? newId(),
      title: checked.title,
      ...(showing.aside === true ? { aside: true } : {}),
      ...(checked.card === undefined ? {} : { card: checked.card }),
      ...(checked.width === undefined ? {} : { width: checked.width }),
      spec: checked.spec,
      ...(checked.widget === undefined ? {} : { widget: checked.widget }),
      ...(checked.reminder === undefined ? {} : { reminder: checked.reminder }),
      ...(showing.turn === undefined ? {} : { turn: showing.turn }),
      ...(showing.thread === undefined ? {} : { thread: showing.thread })
    }
    const cards = answered(view)
    const named = cards.flatMap((card) => (card.card === undefined ? [] : [card.card]))
    if (view.card !== undefined && named.length > CARDS_PER_ANSWER)
      return {
        ok: false,
        text: `Not shown: an answer shows ${CARDS_PER_ANSWER} cards at most, and yours shows ${named.slice(1).join(', ')}. Show it under one of these names to replace that card, or remove one with ${CLEAR_TOOL} first.`
      }
    records.append([{ type: VIEW_SHOWN, payload: view }])
    if (view.aside !== true && !showing.focused && showing.thread !== undefined) {
      answers.set(showing.thread, cards)
      return { ok: true, text: 'Kept for when this topic is back on screen.' }
    }
    place(view, cards)
    emit({ type: 'event', name: 'view.shown', view })
    leaveLater(view, ASIDE_STAYS_MS)
    return { ok: true, text: 'Shown.' }
  }

  return {
    current: () => stage[0],
    stream: () => [...stream],
    asides,

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
      for (const view of [...stage, ...stream, ...[...answers.values()].flat()]) if (view.id === id) return view
      // An older view is in the records: they are read only for this, which is rare.
      for (const record of records.read([VIEW_SHOWN]).reverse()) {
        const view = recorded(record.payload)
        if (view.success && view.data.id === id) return view.data
      }
      return undefined
    },

    cards: (thread) => [...(thread === undefined ? stage : (answers.get(thread) ?? []))],

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

    recall(thread) {
      const [view] = answers.get(thread) ?? []
      if (view?.aside !== true) return
      // Recorded again, so the card is still there after a restart, and leaves its full time after now.
      records.append([{ type: VIEW_SHOWN, payload: view }])
      place(view)
      emit({ type: 'event', name: 'view.shown', view })
      leaveLater(view, ASIDE_STAYS_MS)
    },

    focus(thread) {
      const cards = answers.get(thread ?? '') ?? []
      if (cards.length > 0 && cards.every((card) => card.aside !== true)) {
        if (cards.length === stage.length && cards.every((card, index) => card.id === stage[index]?.id)) return
        stage = cards
        // A topic brought back puts its cards on top of the stream again, together, in the order they were shown.
        for (const view of cards.toReversed()) {
          stream = onTop(stream, view)
          emit({ type: 'event', name: 'view.shown', view })
        }
      } else if (stage.length > 0) {
        stage = []
        emit({ type: 'event', name: 'view.cleared' })
      }
    },

    clear,

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
