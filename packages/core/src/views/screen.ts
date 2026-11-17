import { type ViewSpec, validateView } from '@repo/catalog'
import { type Event, onTop, type ShownView, type TurnId, viewSchema } from '@repo/protocol'
import { z } from 'zod'
import type { Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'

/** The types of the records written when a view is shown and when one is cleared. */
export const VIEW_SHOWN = 'view.shown'
export const VIEW_CLEARED = 'view.cleared'

/** How many aside cards the margin holds; an older one leaves when a new one comes. */
const MARGIN = 3

const request = z.object({ title: z.string().trim().min(1).max(120), view: z.unknown() })

export interface ScreenOptions {
  records: Records
  /** A new identifier, unique for good. */
  newId: () => string
}

/** Who asks to show something: a thread, the turn it is answering, and where its views go. */
export interface Showing {
  thread: string | undefined
  turn: TurnId | undefined
  slot: 'stage' | 'margin'
  /** Whether its topic is the one on the stage. A topic in the background keeps its view for when it comes back. */
  focused: boolean
}

/** A view already checked against the catalogue, to show as it is: a saved widget brought back. */
export interface Checked {
  title: string
  spec: ViewSpec
  /** The saved widget of the library it shows again. */
  widget?: string
}

/**
 * What the assistant shows: each thread's view, the one of the topic in focus on the stage, aside cards in the
 * margin, and the stream the main screen draws, every view still open, newest first.
 */
export interface Screen {
  /** What is on the stage now. */
  current(): ShownView | undefined
  /** The aside cards, the newest last. */
  margin(): ShownView[]
  /** Every view of the conversation still open, newest first, stage and asides together. */
  stream(): ShownView[]
  /** Show what a session asked to show. The answer says "shown", or lists what to correct. */
  show(asked: unknown, showing: Showing): ToolResult
  /** Show a view that was checked already, as it is. */
  present(view: Checked, showing: Showing): ToolResult
  /** A view shown now or earlier, by its identifier. */
  find(view: string): ShownView | undefined
  /** The latest view a thread showed, or, left out, the one on the stage. */
  latest(thread: string | undefined): ShownView | undefined
  /** Every view a thread showed, oldest first, from the records. */
  history(thread: string): ShownView[]
  /** Put an aside's latest card back in the margin. */
  recall(thread: string): void
  /** The focus moved to this thread: the stage shows its view, or nothing. */
  focus(thread: string | undefined): void
  /** Remove the view given, wherever it is in the stream, or, left out, what is on the stage. */
  clear(view?: string): void
  onEvent(listener: (event: Event) => void): () => void
}

/**
 * The screen checks a view against the catalogue before showing it. A view that does not pass is not shown,
 * and the answer lists every problem so it can be written again. Every view is recorded, so an earlier one
 * is never lost, and the screen is as it was after a restart.
 */
export function createScreen({ records, newId }: ScreenOptions): Screen {
  const listeners = new Set<(event: Event) => void>()
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }

  /** The latest view of each thread, by thread; views shown outside any thread are kept under ''. */
  const byThread = new Map<string, ShownView>()
  let stage: ShownView | undefined
  let margin: ShownView[] = []
  let stream: ShownView[] = []
  const place = (view: ShownView) => {
    byThread.set(view.thread ?? '', view)
    stream = onTop(stream, view)
    // An aside keeps one card in the margin: its latest.
    if (view.slot === 'margin')
      margin = [...margin.filter((card) => card.id !== view.id && (view.thread === undefined || card.thread !== view.thread)), view].slice(-MARGIN)
    else stage = view
  }
  const remove = (id: string | undefined) => {
    const target = id ?? stage?.id
    if (id === undefined || stage?.id === id) stage = undefined
    margin = margin.filter((card) => card.id !== id)
    stream = stream.filter((view) => view.id !== target)
    // A view removed from the stage does not come back when its topic does. An aside's card closed is only put
    // away: it comes back when its aside is opened again.
    for (const [thread, view] of byThread) if (view.id === target && view.slot === 'stage') byThread.delete(thread)
  }
  for (const record of records.read([VIEW_SHOWN, VIEW_CLEARED])) {
    if (record.type === VIEW_CLEARED) remove((record.payload as { view?: string }).view)
    else {
      const view = viewSchema.safeParse(record.payload)
      if (view.success) place(view.data)
    }
  }

  const present = (checked: Checked, showing: Showing): ToolResult => {
    const view: ShownView = {
      id: newId(),
      title: checked.title,
      slot: showing.slot,
      spec: checked.spec,
      ...(checked.widget === undefined ? {} : { widget: checked.widget }),
      ...(showing.turn === undefined ? {} : { turn: showing.turn }),
      ...(showing.thread === undefined ? {} : { thread: showing.thread })
    }
    records.append([{ type: VIEW_SHOWN, payload: view }])
    if (view.slot === 'stage' && !showing.focused && showing.thread !== undefined) {
      byThread.set(showing.thread, view)
      return { ok: true, text: 'Kept for when this topic is back on screen.' }
    }
    place(view)
    emit({ type: 'event', name: 'view.shown', view })
    return { ok: true, text: 'Shown.' }
  }

  return {
    current: () => stage,
    margin: () => [...margin],
    stream: () => [...stream],

    show(asked, showing) {
      const read = request.safeParse(asked)
      if (!read.success) return { ok: false, text: 'Give a title, in a few words, and a view.' }
      const checked = validateView(read.data.view)
      if (!checked.ok) return { ok: false, text: `The view was not shown. Correct this and show it again:\n- ${checked.problems.join('\n- ')}` }
      return present({ title: read.data.title, spec: checked.spec }, showing)
    },

    present,

    find(id) {
      for (const view of [stage, ...margin, ...byThread.values()]) if (view?.id === id) return view
      // An older view is in the records: they are read only for this, which is rare.
      for (const record of records.read([VIEW_SHOWN]).reverse()) {
        const view = viewSchema.safeParse(record.payload)
        if (view.success && view.data.id === id) return view.data
      }
      return undefined
    },

    latest: (thread) => (thread === undefined ? stage : byThread.get(thread)),

    history(thread) {
      const views: ShownView[] = []
      for (const record of records.read([VIEW_SHOWN])) {
        const view = viewSchema.safeParse(record.payload)
        // A card brought back is recorded again: it is still one view.
        if (view.success && view.data.thread === thread && !views.some((one) => one.id === view.data.id)) views.push(view.data)
      }
      return views
    },

    recall(thread) {
      const view = byThread.get(thread)
      if (view?.slot !== 'margin') return
      // Recorded again, so the card is still there after a restart.
      if (!margin.some((card) => card.id === view.id)) records.append([{ type: VIEW_SHOWN, payload: view }])
      place(view)
      emit({ type: 'event', name: 'view.shown', view })
    },

    focus(thread) {
      const view = byThread.get(thread ?? '')
      if (view && view.slot === 'stage') {
        if (stage?.id === view.id) return
        stage = view
        // A topic brought back puts its view on top of the stream again.
        stream = onTop(stream, view)
        emit({ type: 'event', name: 'view.shown', view })
      } else if (stage) {
        stage = undefined
        emit({ type: 'event', name: 'view.cleared' })
      }
    },

    clear(id) {
      const target = id ?? stage?.id
      if (target === undefined) return
      if (stage?.id !== target && !margin.some((card) => card.id === target) && !stream.some((view) => view.id === target)) return
      remove(target)
      records.append([{ type: VIEW_CLEARED, payload: { view: target } }])
      emit({ type: 'event', name: 'view.cleared', view: target })
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
