import { validateView } from '@repo/catalog'
import { type Event, type ShownView, type TurnId, viewSchema } from '@repo/protocol'
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

/** What the assistant shows: each thread's view, the one of the topic in focus on the stage, and aside cards in the margin. */
export interface Screen {
  /** What is on the stage now. */
  current(): ShownView | undefined
  /** The aside cards, the newest last. */
  margin(): ShownView[]
  /** Show what a session asked to show. The answer says "shown", or lists what to correct. */
  show(asked: unknown, showing: Showing): ToolResult
  /** The focus moved to this thread: the stage shows its view, or nothing. */
  focus(thread: string | undefined): void
  /** Remove the view given, or, left out, what is on the stage. */
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
  const place = (view: ShownView) => {
    byThread.set(view.thread ?? '', view)
    if (view.slot === 'margin') margin = [...margin.filter((card) => card.id !== view.id), view].slice(-MARGIN)
    else stage = view
  }
  const remove = (id: string | undefined) => {
    if (id === undefined || stage?.id === id) stage = undefined
    margin = margin.filter((card) => card.id !== id)
  }
  for (const record of records.read([VIEW_SHOWN, VIEW_CLEARED])) {
    if (record.type === VIEW_CLEARED) remove((record.payload as { view?: string }).view)
    else {
      const view = viewSchema.safeParse(record.payload)
      if (view.success) place(view.data)
    }
  }

  return {
    current: () => stage,
    margin: () => [...margin],

    show(asked, showing) {
      const read = request.safeParse(asked)
      if (!read.success) return { ok: false, text: 'Give a title, in a few words, and a view.' }
      const checked = validateView(read.data.view)
      if (!checked.ok) return { ok: false, text: `The view was not shown. Correct this and show it again:\n- ${checked.problems.join('\n- ')}` }

      const view: ShownView = {
        id: newId(),
        title: read.data.title,
        slot: showing.slot,
        spec: checked.spec,
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
    },

    focus(thread) {
      const view = byThread.get(thread ?? '')
      if (view && view.slot === 'stage') {
        if (stage?.id === view.id) return
        stage = view
        emit({ type: 'event', name: 'view.shown', view })
      } else if (stage) {
        stage = undefined
        emit({ type: 'event', name: 'view.cleared' })
      }
    },

    clear(id) {
      const target = id ?? stage?.id
      if (target === undefined) return
      if (stage?.id !== target && !margin.some((card) => card.id === target)) return
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
